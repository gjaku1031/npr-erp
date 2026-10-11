package com.npr.erp.identity;

import java.util.UUID;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * 로그인 검증에만 쓰는 계정 자격 정보
 *
 * 비밀번호 해시가 로그에 남지 않도록 record 대신 일반 클래스로 두고 toString을 만들지 않음
 */
@Getter
@RequiredArgsConstructor
public final class AccountCredentials {
    /**
     * 계정 ID
     */
    private final UUID accountId;

    /**
     * 로그인 아이디
     */
    private final String username;

    /**
     * BCrypt 해시. 비밀번호를 아직 설정하지 않은 계정은 null
     */
    private final String passwordHash;

    /**
     * 계정 상태
     */
    private final AccountStatus status;
}
