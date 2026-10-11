package com.npr.erp.worklog;

/**
 * 오늘을 기준으로 본 일일보고 날짜의 시기
 */
public enum JournalPhase {
    /**
     * 아직 오지 않은 날짜
     */
    UPCOMING,

    /**
     * 오늘
     */
    TODAY,

    /**
     * 지난 날짜. 항목을 더 고칠 수 없음
     */
    PAST
}
