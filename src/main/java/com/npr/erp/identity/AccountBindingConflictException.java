package com.npr.erp.identity;

/**
 * 계정 ID나 로그인 아이디가 이미 다른 계정에 쓰이고 있음
 */
public final class AccountBindingConflictException extends IdentityException {
    /**
     * 충돌 설명으로 예외 생성
     *
     * @param message 어떤 값이 충돌했는지에 대한 설명
     */
    public AccountBindingConflictException(String message) {
        super("ACCOUNT_BINDING_CONFLICT", message);
    }
}
