package com.npr.erp.worklog;

/**
 * 입력값이 규칙에 어긋남
 */
public final class WorklogValidationException extends WorklogException {
    /**
     * 오류 코드와 설명으로 예외 생성
     *
     * @param code 고정 오류 코드
     * @param message 설명
     */
    public WorklogValidationException(String code, String message) {
        super(code, message);
    }
}
