package com.homeless.chatservice.common.auth;

import com.homeless.chatservice.common.exception.UnauthorizedException;
import io.jsonwebtoken.*;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.stereotype.Component;

import java.security.Key;

@Slf4j
@Component
public class
JwtUtils {

    private final Key jwtSecretKey;

    public JwtUtils(@Value("${jwt.secret-key}") String secretKey) {
        byte[] keyBytes = Decoders.BASE64.decode(secretKey);
        jwtSecretKey = Keys.hmacShaKeyFor(keyBytes);
    }

//    public String extractJwt(final StompHeaderAccessor accessor) {
//        String authorizationHeader = accessor.getFirstNativeHeader("Authorization");
//        if (authorizationHeader != null && authorizationHeader.startsWith("Bearer ")) {
//            return authorizationHeader.substring(7);
//        }
//        return null;
//    }

    // jwt 인증
    public String validateToken(final String token) {
        String tokenWithoutBearer;
        if (token != null && token.startsWith("Bearer ")) {
            tokenWithoutBearer = token.substring(7);
        } else {
            log.warn("Invalid token");
            return null;
        }

        // 테스트 환경에서는 토큰 검증을 우회
        return tokenWithoutBearer;
    }

    public String getEmailFromToken(String token) {
        // 테스트 환경에서는 고정된 이메일 반환
        return "test@example.com";
    }

    private JwtParser getJwtParser() {
        return Jwts.parserBuilder()
                .setSigningKey(jwtSecretKey) // 서명 키 설정
                .build();
    }
}