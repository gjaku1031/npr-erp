package com.npr.erp.bootstrap.security;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

/**
 * 로그인한 계정
 *
 * Spring Security의 권한 목록은 비워 둠. 무엇을 할 수 있는지는 요청마다 권한 엔진이 판단함
 */
@Getter
@RequiredArgsConstructor
public final class AccountPrincipal implements UserDetails {
    /**
     * 계정 ID
     */
    private final UUID accountId;

    /**
     * 로그인 아이디
     */
    private final String username;

    /**
     * 비밀번호 해시
     */
    private final String passwordHash;

    /**
     * 활성 계정인지
     */
    private final boolean active;

    /**
     * 권한 목록은 쓰지 않음
     */
    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return List.of();
    }

    /**
     * 비밀번호 검증에 쓰는 해시
     */
    @Override
    public String getPassword() {
        return passwordHash;
    }

    /**
     * 비활성 계정은 로그인할 수 없음
     */
    @Override
    public boolean isEnabled() {
        return active;
    }
}
