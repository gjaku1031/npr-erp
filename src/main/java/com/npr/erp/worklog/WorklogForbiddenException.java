package com.npr.erp.worklog;

/**
 * 본인의 것이 아닌 대상을 다루려 함
 *
 * 기능 권한은 호출자가 확인하고, 이 예외는 그 뒤의 소유 조건이 맞지 않을 때 던짐
 */
public final class WorklogForbiddenException extends WorklogException {
    /**
     * 설명으로 예외 생성
     *
     * @param message 설명
     */
    public WorklogForbiddenException(String message) {
        super("WORKLOG_NOT_OWNER", message);
    }
}
