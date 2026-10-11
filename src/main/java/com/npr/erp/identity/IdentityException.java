package com.npr.erp.identity;

import lombok.Getter;

/**
 * identity 모듈의 업무 예외
 */
@Getter
public abstract sealed class IdentityException extends RuntimeException
        permits AccountNotFoundException, AccountInactiveException, AccountBindingConflictException {
    /**
     * 화면과 로그에서 쓰는 고정 오류 코드
     */
    private final String code;

    /**
     * 오류 코드와 설명으로 예외 생성
     *
     * @param code 고정 오류 코드
     * @param message 진단용 설명
     */
    protected IdentityException(String code, String message) {
        super(message);
        this.code = code;
    }
}
