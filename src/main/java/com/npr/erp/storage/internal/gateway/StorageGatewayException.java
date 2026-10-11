package com.npr.erp.storage.internal.gateway;

import lombok.Getter;

/**
 * 외부 저장소 호출 실패
 */
@Getter
public final class StorageGatewayException extends RuntimeException {
    /**
     * 고정 오류 코드
     */
    private final String code;

    /**
     * 같은 요청을 다시 보내도 되는 실패인지. false이면 사람이 확인해야 함
     */
    private final boolean retryable;

    /**
     * 실패 정보로 예외 생성
     *
     * @param code 고정 오류 코드
     * @param retryable 다시 시도할 수 있는지
     * @param message 설명
     * @param cause 원인 예외. 없으면 null
     */
    public StorageGatewayException(String code, boolean retryable, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
        this.retryable = retryable;
    }
}
