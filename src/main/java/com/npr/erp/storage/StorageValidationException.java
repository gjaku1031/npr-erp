package com.npr.erp.storage;

/**
 * 이름이나 검색어가 규칙에 어긋남
 */
public final class StorageValidationException extends StorageException {
    /**
     * 오류 코드와 설명으로 예외 생성
     *
     * @param code 고정 오류 코드
     * @param message 설명
     */
    public StorageValidationException(String code, String message) {
        super(code, message);
    }
}
