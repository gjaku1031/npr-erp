package com.npr.erp.storage;

import lombok.Getter;

/**
 * storage 모듈의 업무 예외
 */
@Getter
public abstract sealed class StorageException extends RuntimeException
        permits StorageNotFoundException,
                StorageValidationException,
                StorageConflictException,
                StorageUnavailableException {
    /**
     * 화면과 로그에서 쓰는 고정 오류 코드
     */
    private final String code;

    /**
     * 오류 코드와 설명으로 예외 생성
     *
     * @param code 고정 오류 코드
     * @param message 사용자에게 보여 줄 수 있는 설명
     */
    protected StorageException(String code, String message) {
        super(message);
        this.code = code;
    }
}
