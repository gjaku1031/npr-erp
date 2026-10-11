package com.npr.erp.storage;

/**
 * 작업 상태
 */
public enum StorageOperationStatus {
    /**
     * 기록만 하고 아직 외부 저장소를 호출하지 않음
     */
    PENDING,

    /**
     * 외부 저장소를 호출하는 중
     */
    PROCESSING,

    /**
     * 호출 도중 프로세스가 끝나 결과를 알 수 없음. 다시 확인해야 함
     */
    VERIFY,

    /**
     * 끝남
     */
    COMPLETED,

    /**
     * 실패했지만 다시 시도할 수 있음
     */
    RETRYABLE_FAILED,

    /**
     * 자동으로 판정할 수 없어 사람이 확인해야 함
     */
    MANUAL_REVIEW;

    /**
     * 끝나지 않아 다시 확인할 대상인지
     *
     * @return VERIFY, RETRYABLE_FAILED, MANUAL_REVIEW이면 true
     */
    public boolean unsettled() {
        return this == VERIFY || this == RETRYABLE_FAILED || this == MANUAL_REVIEW;
    }
}
