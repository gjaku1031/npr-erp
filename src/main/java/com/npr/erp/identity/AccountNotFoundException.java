package com.npr.erp.identity;

import java.util.UUID;

/**
 * 계정이 없음
 */
public final class AccountNotFoundException extends IdentityException {
    /**
     * 찾지 못한 계정 ID로 예외 생성
     *
     * @param accountId 계정 ID
     */
    public AccountNotFoundException(UUID accountId) {
        super("ACCOUNT_NOT_FOUND", "계정을 찾을 수 없습니다: " + accountId);
    }
}
