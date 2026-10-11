package com.npr.erp.worklog;

/**
 * 상담 한 건의 전송 상태
 */
public enum CounselDelivery {
    /**
     * 보내기 전
     */
    IDLE,

    /**
     * 보내는 중이거나, 보냈지만 결과를 확인하지 못함. 같은 상담이 두 번 기록되지 않도록 다시 보내기 전에 확인이 필요함
     */
    PENDING,

    /**
     * 외부 시스템에 기록된 것을 확인함
     */
    SENT
}
