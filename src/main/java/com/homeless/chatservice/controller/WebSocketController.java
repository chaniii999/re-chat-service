package com.homeless.chatservice.controller;

import com.homeless.chatservice.common.auth.JwtUtils;
import com.homeless.chatservice.common.exception.TokenValidationException;
import com.homeless.chatservice.dto.*;
import com.homeless.chatservice.entity.ChatMessage;
import com.homeless.chatservice.dto.MessageDto;
import com.homeless.chatservice.service.ChatHttpService;
import com.homeless.chatservice.service.DtoBuilder;
import com.homeless.chatservice.service.StompMessageService;
import io.swagger.v3.oas.annotations.Operation;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@Controller
@RequiredArgsConstructor
@Slf4j
public class WebSocketController {
    private final StompMessageService messageService;
    private final ChatHttpService chatHttpService;
    private final SimpMessagingTemplate simpMessagingTemplate;
    private final JwtUtils jwtUtils;
    private final DtoBuilder dtoBuilder;

    private final String CHAT_DESTINATION = "/topic/chat.channel.";

    @MessageMapping("chat.message.{channelId}")
    @Operation(summary = "메시지 전송", description = "메시지를 전송합니다.")
    @Transactional
    public void sendMessage(@DestinationVariable String channelId,
                          @Payload ChatMessageRequest chatReqDto,
                          @Header("Authorization") String authorizationHeader) {
        try {
            log.info("Received message for channel: {}, content: {}", channelId, chatReqDto);
            
            if (chatReqDto.content() == null && chatReqDto.fileUrl() == null) {
                throw new IllegalArgumentException("Message content cannot be empty");
            }

            // 토큰 검증
            String tokenWithoutBearer = jwtUtils.validateToken(authorizationHeader);
            String userEmail = jwtUtils.getEmailFromToken(tokenWithoutBearer);
            log.info("Authenticated user: {} for channel: {}", userEmail, channelId);

            // 메시지 저장 및 DTO 변환
            String chatId = dtoBuilder.saveChatMessage(channelId, chatReqDto);
            MessageDto messageDto = dtoBuilder.buildMessageDto(chatId, channelId, chatReqDto);
            log.info("Message saved with ID: {} for channel: {}", chatId, channelId);

            // 메시지 전송
            messageService.sendMessageFromRabbitMQ(messageDto);
            log.info("Message sent to RabbitMQ for channel: {}", channelId);

            // 메시지 브로드캐스트 (중복 제거: Controller에서는 제거)
            // simpMessagingTemplate.convertAndSend("/topic/chat.channel." + channelId, messageDto);
            // log.info("Broadcasted messageDto to /topic/chat.channel.{}", channelId);

        } catch (IllegalArgumentException e) {
            log.error("Invalid message content for channel: {}. Error: {}", channelId, e.getMessage());
            Map<String, Object> errorResult = new HashMap<>();
            errorResult.put("status", "error");
            errorResult.put("message", "Invalid message content");
            simpMessagingTemplate.convertAndSend("/topic/chat.channel." + channelId, errorResult);
        } catch (Exception e) {
            log.error("Error while sending message for channel: {}. Error: {}", channelId, e.getMessage(), e);
            Map<String, Object> errorResult = new HashMap<>();
            errorResult.put("status", "error");
            errorResult.put("message", "Failed to send message");
            simpMessagingTemplate.convertAndSend("/topic/chat.channel." + channelId, errorResult);
        }
    }

    @MessageMapping("chat.message.delete.{channelId}")
    @SendTo("/exchange/chat.exchange/chat.channel.{channelId}")
    @Transactional
    public void deleteMessage(@DestinationVariable String channelId,
                              String chatId,
                              @Header("Authorization") String authorizationHeader) {

        try {
            // 1. 토큰 검사 (Bearer 떼고 검사)
            String tokenWithoutBearer = jwtUtils.validateToken(authorizationHeader);

            // 2. 토큰에서 이메일 가져오기
            String userEmail = jwtUtils.getEmailFromToken(tokenWithoutBearer);

            // 3. chatId로 메시지 가져오기
            Optional<ChatMessage> chatMessageOpt = chatHttpService.getChatMessage(chatId);
            // 4. 메시지가 존재하는지 확인
            if (chatMessageOpt.isPresent()) {
                ChatMessage chatMessage = chatMessageOpt.get();

                // 5. 작성자 또는 관리자 권한 확인
                if (chatMessage.getEmail().equals(userEmail)) {
                    // 메시지 삭제
                    chatHttpService.deleteMessage(chatId);

                    // 삭제된 메시지를 클라이언트에게 전송
                    Map<String, Object> result = new HashMap<>();
                    result.put("status", "success");
                    result.put("message", "Message deleted: 메시지 삭제됨.");
                    result.put("deletedChatId", chatId);
                    simpMessagingTemplate.convertAndSend(CHAT_DESTINATION + channelId, result);
                } else {
                    log.warn("User does not have permission to delete message: {}", chatId);
                    Map<String, Object> errorResult = new HashMap<>();
                    errorResult.put("status", "error");
                    errorResult.put("message", "Permission denied");
                    simpMessagingTemplate.convertAndSend(CHAT_DESTINATION + channelId, errorResult);
                }
            } else {
                log.error("Chat message not found: {} : 메시지 객체 찾지못함.", chatId);
                Map<String, Object> errorResult = new HashMap<>();
                errorResult.put("status", "error");
                errorResult.put("message", "Chat message not found");
                simpMessagingTemplate.convertAndSend(CHAT_DESTINATION + channelId, errorResult);
            }
        } catch (TokenValidationException e) {
            log.error("Token validation failed: {}", e.getMessage(), e);
            Map<String, Object> errorResult = new HashMap<>();
            errorResult.put("status", "error");
            errorResult.put("message", "Token validation failed");
            simpMessagingTemplate.convertAndSend(CHAT_DESTINATION + channelId, errorResult);
        } catch (Exception e) {
            log.error("Error while deleting message: {}", e.getMessage(), e);
            Map<String, Object> errorResult = new HashMap<>();
            errorResult.put("status", "error");
            errorResult.put("message", "Failed to delete message");
            simpMessagingTemplate.convertAndSend(CHAT_DESTINATION + channelId, errorResult);
        }
    }

    @MessageMapping("chat.message.update.{channelId}")
    @SendTo("/exchange/chat.exchange/chat.channel.{channelId}")
    @Transactional
    public void updateMessage(@DestinationVariable String channelId,
                              MessageModifyDto dto,
                              @Header("Authorization") String authorizationHeader) {


        try {
            String tokenWithoutBearer = jwtUtils.validateToken(authorizationHeader);

            String userEmail = jwtUtils.getEmailFromToken(tokenWithoutBearer);

            Optional<ChatMessage> chatMessageOpt = chatHttpService.getChatMessage(dto.getChatId());

            if (chatMessageOpt.isPresent()) {
                ChatMessage chatMessage = chatMessageOpt.get();

                if (chatMessage.getEmail().equals(userEmail)) {
                    // 메시지 내용 수정
                    chatMessage.setContent(dto.getReqMessage());
                    chatHttpService.updateMessage(dto.getChatId(), dto.getReqMessage()); // 메시지 수정 후 저장

                    // 수정된 메시지를 클라이언트에게 전송
                    Map<String, Object> result = new HashMap<>();
                    result.put("chatId", dto.getChatId());
                    result.put("reqMessage", dto.getReqMessage());

                    CommonResDto<Object> commonResDto = new CommonResDto<>(HttpStatus.OK, "Message updated successfully", result);

                    simpMessagingTemplate.convertAndSend(CHAT_DESTINATION + channelId, commonResDto);
                } else {
                    log.warn("User does not have permission to update message: {}", dto.getChatId());
                    // 권한 없을 때 에러 응답
                    Map<String, Object> errorResult = new HashMap<>();
                    CommonResDto<Object> errorResDto = new CommonResDto<>(HttpStatus.FORBIDDEN, "Permission denied", errorResult);
                    simpMessagingTemplate.convertAndSend(CHAT_DESTINATION + channelId, errorResDto);
                }
            } else {
                log.error("Chat message not found: {}", dto.getChatId());
                // 메시지 없을 때 에러 응답
                Map<String, Object> errorResult = new HashMap<>();
                CommonResDto<Object> errorResDto = new CommonResDto<>(HttpStatus.NOT_FOUND, "Chat message not found", errorResult);
                simpMessagingTemplate.convertAndSend(CHAT_DESTINATION + channelId, errorResDto);
            }
        } catch (TokenValidationException e) {
            log.error("Token validation failed: {}", e.getMessage(), e);
            // 토큰 검증 실패 에러 응답
            Map<String, Object> errorResult = new HashMap<>();
            CommonResDto<Object> errorResDto = new CommonResDto<>(HttpStatus.UNAUTHORIZED, "Token validation failed", errorResult);
            simpMessagingTemplate.convertAndSend(CHAT_DESTINATION + channelId, errorResDto);
        } catch (Exception e) {
            log.error("Error while updating message: {}", e.getMessage(), e);
            // 일반적인 오류 에러 응답
            Map<String, Object> errorResult = new HashMap<>();
            CommonResDto<Object> errorResDto = new CommonResDto<>(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to update message", errorResult);
            simpMessagingTemplate.convertAndSend(CHAT_DESTINATION + channelId, errorResDto);
        }
    }

}
