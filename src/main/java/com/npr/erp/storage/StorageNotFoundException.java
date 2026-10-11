package com.npr.erp.storage;

/**
 * 노드나 작업을 찾을 수 없음
 */
public final class StorageNotFoundException extends StorageException {
    /**
     * 오류 코드와 설명으로 예외 생성
     *
     * @param code 고정 오류 코드
     * @param message 설명
     */
    public StorageNotFoundException(String code, String message) {
        super(code, message);
    }
}
