package com.npr.erp.worklog;

/**
 * 대상의 현재 상태가 요청과 충돌함
 */
public final class WorklogConflictException extends WorklogException {
    /**
     * 오류 코드와 설명으로 예외 생성
     *
     * @param code 고정 오류 코드
     * @param message 설명
     */
    public WorklogConflictException(String code, String message) {
        super(code, message);
    }
}
