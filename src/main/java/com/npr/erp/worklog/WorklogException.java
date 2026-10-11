package com.npr.erp.worklog;

import lombok.Getter;

/**
 * worklog 모듈의 업무 예외
 */
@Getter
public abstract sealed class WorklogException extends RuntimeException
        permits WorklogNotFoundException,
                WorklogValidationException,
                WorklogConflictException,
                WorklogForbiddenException {
    /**
     * 화면과 로그에서 쓰는 고정 오류 코드
     */
    private final String code;

    /**
     * 오류 코드와 설명으로 예외 생성
     *
     * @param code 고정 오류 코드
     * @param message 사용자에게 보여 줄 수 있는 설명
     */
    protected WorklogException(String code, String message) {
        super(message);
        this.code = code;
    }
}
