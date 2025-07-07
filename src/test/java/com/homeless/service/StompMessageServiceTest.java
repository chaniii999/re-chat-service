package com.homeless.service;

import com.homeless.chatservice.dto.MessageDto;
import com.homeless.chatservice.dto.ChannelType;
import com.homeless.chatservice.dto.MessageType;
import com.homeless.chatservice.service.StompMessageService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class StompMessageServiceTest {

    @Mock
    private RabbitTemplate rabbitTemplate;

    @Mock
    private SimpMessagingTemplate messagingTemplate;

    @Mock
    private RedisTemplate<String, String> redisTemplate;

    @Mock
    private ValueOperations<String, String> valueOperations;

    @InjectMocks
    private StompMessageService stompMessageService;

    private MessageDto testMessage;

    @BeforeEach
    void setUp() {
        testMessage = MessageDto.builder()
                .chatId("test-chat-id")
                .channelId("test-channel")
                .email("test@example.com")
                .writer("Test User")
                .content("Test message content")
                .channelType(ChannelType.TEXT)
                .messageType(MessageType.MESSAGE)
                .build();

        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
    }

    @Test
    void sendMessageFromRabbitMQ_Success() {
        // Given
        when(valueOperations.get(anyString())).thenReturn(null);

        // When
        stompMessageService.sendMessageFromRabbitMQ(testMessage);

        // Then
        verify(rabbitTemplate).convertAndSend(anyString(), anyString(), eq(testMessage));
        verify(valueOperations).set(anyString(), anyString(), any());
    }

    @Test
    void sendMessageFromRabbitMQ_DuplicateMessage_ShouldNotSend() {
        // Given
        String messageHash = "test-hash";
        when(valueOperations.get(anyString())).thenReturn(messageHash);

        // When
        stompMessageService.sendMessageFromRabbitMQ(testMessage);

        // Then
        verify(rabbitTemplate, never()).convertAndSend(anyString(), anyString(), any());
    }

    @Test
    void isDuplicateMessageEnhanced_NewMessage_ReturnsFalse() {
        // Given
        when(valueOperations.get(anyString())).thenReturn(null);

        // When
        boolean result = stompMessageService.isDuplicateMessageEnhanced("test-channel", "test-hash", "test@example.com");

        // Then
        assert !result;
        verify(valueOperations).set(anyString(), eq("test-hash"), any());
    }

    @Test
    void isDuplicateMessageEnhanced_DuplicateMessage_ReturnsTrue() {
        // Given
        when(valueOperations.get(anyString())).thenReturn("test-hash");

        // When
        boolean result = stompMessageService.isDuplicateMessageEnhanced("test-channel", "test-hash", "test@example.com");

        // Then
        assert result;
        verify(valueOperations, never()).set(anyString(), anyString(), any());
    }
} 