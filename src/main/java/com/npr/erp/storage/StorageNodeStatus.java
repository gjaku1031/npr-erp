package com.npr.erp.storage;

/**
 * 노드 상태
 *
 * 외부 저장소 작업이 끝나기 전의 중간 상태를 따로 두어, 처리 중인 항목에 다른 변경이 겹치지 않게 함
 */
public enum StorageNodeStatus {
    /**
     * 만드는 중. 외부 저장소에 아직 확정되지 않음
     */
    PROVISIONING,

    /**
     * 정상
     */
    ACTIVE,

    /**
     * 이름 변경이나 이동을 처리하는 중
     */
    MUTATING,

    /**
     * 휴지통에 있음
     */
    TRASHED,

    /**
     * 영구 삭제를 처리하는 중
     */
    DELETING,

    /**
     * 영구 삭제됨. 행은 흔적으로 남김
     */
    DELETED,

    /**
     * 만들다 실패함
     */
    FAILED
}
