package com.npr.erp.storage;

/**
 * 외부 저장소 작업을 끝내지 못함
 */
public final class StorageUnavailableException extends StorageException {
    /**
     * 오류 코드와 설명으로 예외 생성
     *
     * @param code 고정 오류 코드
     * @param message 설명
     */
    public StorageUnavailableException(String code, String message) {
        super(code, message);
    }
}
