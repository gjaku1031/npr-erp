package com.npr.erp.storage;

/**
 * 노드나 작업의 현재 상태가 요청과 충돌함
 */
public final class StorageConflictException extends StorageException {
    /**
     * 오류 코드와 설명으로 예외 생성
     *
     * @param code 고정 오류 코드
     * @param message 설명
     */
    public StorageConflictException(String code, String message) {
        super(code, message);
    }
}
