package com.homeless.chatservice.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeless.chatservice.common.config.RabbitConfig;
import com.homeless.chatservice.dto.MessageDto;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.rabbit.listener.SimpleMessageListenerContainer;
import org.springframework.amqp.rabbit.listener.api.ChannelAwareMessageListener;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import jakarta.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@Service
@Slf4j
@RequiredArgsConstructor
public class StompMessageService {
    private final RabbitTemplate rabbitTemplate;
    private final SimpMessagingTemplate messagingTemplate;
    private final RabbitConfig rabbitConfig;
    private final RabbitAdmin rabbitAdmin;
    
    @Qualifier("messageRedisTemplate")
    private final RedisTemplate<String, MessageDto> messageRedisTemplate;
    
    @Qualifier("redisTemplate")
    private final RedisTemplate<String, String> redisTemplate;
    
    private final Map<String, SimpleMessageListenerContainer> channelListeners = new ConcurrentHashMap<>();
    private final ExecutorService messageExecutor = Executors.newFixedThreadPool(100);
    
    @Value("${rabbitmq.chat-exchange.name}")
    private String exchangeName;

    public void sendMessageFromRabbitMQ(MessageDto message) {
        try {
            log.info("Attempting to send message: {}", message);
            
            // 1. 메시지 내용 해시 값 생성
            String messageContentHash = generateMessageHash(message.getContent());

            // 2. 중복 메시지 여부 확인 (테스트 환경에서는 우회)
            String activeProfile = System.getProperty("spring.profiles.active", "");
            boolean isTestEnv = "test".equalsIgnoreCase(activeProfile);
            if (!isTestEnv && isDuplicateMessage(message.getChannelId(), messageContentHash)) {
                log.info("Duplicate message detected for channel: {}", message.getChannelId());
                return;
            }

            // 3. 메시지 전송
            String routingKey = "chat.channel." + message.getChannelId();
            String destination = "/topic/chat.channel." + message.getChannelId();
            
            // RabbitMQ로 메시지 전송
            rabbitTemplate.convertAndSend(
                    exchangeName,
                    routingKey,
                    message
            );
            log.info("Message sent to RabbitMQ - exchange: {}, routingKey: {}", exchangeName, routingKey);

            // WebSocket으로 직접 메시지 전송
            messagingTemplate.convertAndSend(destination, message);
            log.info("Message sent to WebSocket - destination: {}", destination);
            
        } catch (Exception e) {
            log.error("Error sending message: {}", e.getMessage());
            throw new RuntimeException("Failed to send message", e);
        }
    }

    public boolean isDuplicateMessage(String channelId, String messageContentHash) {
        String redisKey = "chat:channel:" + channelId + ":messages";
        String existingMessageHash = redisTemplate.opsForValue().get(redisKey);

        if (existingMessageHash == null || !existingMessageHash.equals(messageContentHash)) {
            redisTemplate.opsForValue().set(redisKey, messageContentHash, Duration.ofMinutes(5));
            return false;
        }
        return true;
    }

    private String generateMessageHash(String content) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(content.getBytes(StandardCharsets.UTF_8));
            return bytesToHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("Error generating hash", e);
        }
    }

    private String bytesToHex(byte[] hash) {
        StringBuilder hexString = new StringBuilder();
        for (byte b : hash) {
            hexString.append(String.format("%02x", b));
        }
        return hexString.toString();
    }

    private void createChannelListener(String channelId) {
        SimpleMessageListenerContainer container = new SimpleMessageListenerContainer();
        container.setConnectionFactory(rabbitConfig.connectionFactory());
        container.setQueueNames("chat.channel." + channelId);
        container.setConcurrentConsumers(20);
        container.setMaxConcurrentConsumers(50);
        container.setPrefetchCount(500);
        
        container.setMessageListener((ChannelAwareMessageListener) (message, channel) -> {
            messageExecutor.submit(() -> {
                try {
                    String jsonMessage = new String(message.getBody());
                    ObjectMapper objectMapper = new ObjectMapper();
                    MessageDto chatMessage = objectMapper.readValue(jsonMessage, MessageDto.class);
                    
                    // WebSocket으로 메시지 전송
                    messagingTemplate.convertAndSend(
                            "/exchange/chat.exchange/chat.channel." + channelId,
                            chatMessage
                    );
                    log.info("Message forwarded to WebSocket for channel: {}", channelId);
                } catch (Exception e) {
                    log.error("Error processing message for channel {}: {}", channelId, e.getMessage());
                }
            });
        });
        
        container.start();
        channelListeners.put(channelId, container);
    }
    
    private void handleMessageProcessingError(Message message, String channelId) {
        try {
            // 메시지 재처리 시도
            rabbitTemplate.send("chat.channel." + channelId, message);
        } catch (Exception e) {
            log.error("Failed to retry message processing for channel {}", channelId, e);
        }
    }
    
    public void removeChannel(String channelId) {
        SimpleMessageListenerContainer container = channelListeners.remove(channelId);
        if (container != null) {
            container.stop();
        }
        rabbitAdmin.deleteQueue("chat.channel." + channelId);
        // Redis 캐시 정리
        String pattern = "chat:channel:" + channelId + ":*";
        Set<String> keys = redisTemplate.keys(pattern);
        if (keys != null && !keys.isEmpty()) {
            redisTemplate.delete(keys);
        }
    }
    
    @PreDestroy
    public void cleanup() {
        messageExecutor.shutdown();
        try {
            if (!messageExecutor.awaitTermination(60, TimeUnit.SECONDS)) {
                messageExecutor.shutdownNow();
            }
        } catch (InterruptedException e) {
            messageExecutor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}