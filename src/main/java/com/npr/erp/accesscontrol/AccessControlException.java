package com.npr.erp.accesscontrol;

import lombok.Getter;

/**
 * accesscontrol 모듈의 업무 예외
 */
@Getter
public abstract sealed class AccessControlException extends RuntimeException
        permits AuthorizationDeniedException,
                AccessControlNotFoundException,
                AccessControlConflictException,
                AccessControlValidationException {
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
    protected AccessControlException(String code, String message) {
        super(message);
        this.code = code;
    }
}
