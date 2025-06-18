package com.homeless.chatservice.common.config;

import com.homeless.chatservice.common.interceptor.StompInterceptor;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;
import org.springframework.context.annotation.Bean;

@Configuration
@EnableWebSocketMessageBroker
@Slf4j
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final StompInterceptor stompInterceptor;
    @Value("${spring.rabbitmq.host}")
    private String RABBITMQ_HOST;

    @Bean
    public CorsFilter corsFilter() {
        log.info("Configuring CORS filter...");
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        CorsConfiguration config = new CorsConfiguration();
        config.addAllowedOriginPattern("*");
        config.addAllowedHeader("*");
        config.addAllowedMethod("*");
        config.setAllowCredentials(true);
        source.registerCorsConfiguration("/**", config);
        return new CorsFilter(source);
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        log.info("Configuring client inbound channel...");
        registration.interceptors(stompInterceptor);
        registration.taskExecutor()
            .corePoolSize(10)
            .maxPoolSize(20)
            .queueCapacity(100);
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        log.info("Registering STOMP endpoints...");
        registry.addEndpoint("/ws")
                .setAllowedOriginPatterns("*");
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        log.info("Configuring message broker with RabbitMQ host: {}", RABBITMQ_HOST);
        
        registry.enableStompBrokerRelay("/queue", "/topic", "/exchange", "/amq/queue")
                .setAutoStartup(true)
                .setRelayHost(RABBITMQ_HOST)
                .setRelayPort(61613)
                .setSystemLogin("guest")
                .setSystemPasscode("guest")
                .setClientLogin("guest")
                .setClientPasscode("guest")
                .setVirtualHost("/");

        registry.setPathMatcher(new AntPathMatcher("."));
        registry.setApplicationDestinationPrefixes("/pub", "/exchange");
        
        log.info("Message broker configured with RabbitMQ");
    }

    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registration) {
        log.info("Configuring WebSocket transport...");
        registration.setMessageSizeLimit(128 * 1024)
                   .setSendBufferSizeLimit(512 * 1024)
                   .setSendTimeLimit(20000);
    }
}