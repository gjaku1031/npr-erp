package com.npr.erp.worklog;

/**
 * 담당자가 표시한 처리 상태
 */
public enum TaskProgress {
    /**
     * 완료
     */
    DONE,

    /**
     * 미완료로 표시함
     */
    UNDONE,

    /**
     * 아직 표시하지 않음
     */
    NONE
}
