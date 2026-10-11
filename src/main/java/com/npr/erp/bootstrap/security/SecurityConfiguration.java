package com.npr.erp.bootstrap.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

/**
 * 웹 보안 설정
 *
 * 서버 세션과 폼 로그인을 쓰고, 상태를 바꾸는 요청은 모두 CSRF 토큰을 요구함
 */
@Configuration
public class SecurityConfiguration {
    /**
     * 로그인 화면과 정적 자원만 열고 나머지는 로그인을 요구하는 필터 체인
     *
     * @param http 보안 설정 빌더
     * @return 필터 체인
     * @throws Exception 설정을 만들지 못했을 때
     */
    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(requests -> requests
                        .requestMatchers("/login", "/assets/**", "/actuator/health", "/error")
                        .permitAll()
                        .anyRequest()
                        .authenticated())
                .formLogin(login -> login.loginPage("/login").defaultSuccessUrl("/", true).permitAll())
                .logout(logout -> logout.logoutSuccessUrl("/login?logout"));
        return http.build();
    }
}
