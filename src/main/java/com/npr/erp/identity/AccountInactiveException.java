package com.npr.erp.identity;

import java.util.UUID;

/**
 * 계정이 활성 상태가 아님
 */
public final class AccountInactiveException extends IdentityException {
    /**
     * 정지된 계정 ID로 예외 생성
     *
     * @param accountId 계정 ID
     */
    public AccountInactiveException(UUID accountId) {
        super("ACCOUNT_INACTIVE", "계정이 활성 상태가 아닙니다: " + accountId);
    }
}
