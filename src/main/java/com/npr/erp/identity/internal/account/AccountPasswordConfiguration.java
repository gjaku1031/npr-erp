package com.npr.erp.identity.internal.account;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * 비밀번호 해시 설정
 */
@Configuration(proxyBeanMethods = false)
public class AccountPasswordConfiguration {
    /**
     * BCrypt 인코더 등록
     *
     * 로그인 검증과 계정 생성이 같은 인코더를 씀
     *
     * @return 기본 강도의 BCrypt 인코더
     */
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
