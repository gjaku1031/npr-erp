package com.npr.erp.storage;

/**
 * 작업 종류
 */
public enum StorageOperationType {
    /**
     * 학원 루트 폴더 생성
     */
    INITIALIZE_ROOT,

    /**
     * 폴더 생성
     */
    CREATE_FOLDER,

    /**
     * 이름 변경
     */
    RENAME,

    /**
     * 이동
     */
    MOVE,

    /**
     * 휴지통으로 보내기. 외부 저장소는 건드리지 않음
     */
    TRASH,

    /**
     * 휴지통에서 복원. 외부 저장소는 건드리지 않음
     */
    RESTORE,

    /**
     * 영구 삭제
     */
    DELETE_PERMANENTLY,

    /**
     * 파일 올리기
     */
    UPLOAD
}
