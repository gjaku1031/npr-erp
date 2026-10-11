package com.npr.erp.worklog;

/**
 * 업무·보고·일정 같은 대상을 찾을 수 없음
 */
public final class WorklogNotFoundException extends WorklogException {
    /**
     * 오류 코드와 설명으로 예외 생성
     *
     * @param code 고정 오류 코드
     * @param message 설명
     */
    public WorklogNotFoundException(String code, String message) {
        super(code, message);
    }
}
