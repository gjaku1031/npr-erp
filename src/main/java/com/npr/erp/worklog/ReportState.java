package com.npr.erp.worklog;

/**
 * 제출 현황판에 보이는 한 사람의 상태
 */
public enum ReportState {
    /**
     * 아직 제출하지 않음. 작성 중인 것도 여기에 들어감
     */
    NOT_SUBMITTED,

    /**
     * 제출했고 확인을 기다림
     */
    WAITING,

    /**
     * 확인까지 끝남
     */
    CONFIRMED
}
