package com.npr.erp.tng;

import lombok.Getter;

/**
 * 외부 시스템 호출 실패
 *
 * 쓰기 요청이 실패했을 때 호출자가 알아야 하는 것은 "외부에 기록되지 않은 것이 확실한가"임. 확실하면 되돌릴 수 있고,
 * 응답을 받지 못해 모르는 경우에는 다시 보내기 전에 외부의 기록을 확인해야 함
 */
@Getter
public final class TngGatewayException extends RuntimeException {
    /**
     * 외부 시스템이 요청을 처리하지 않은 것이 확실한지. 응답 없이 끊겼거나 시간 안에 답이 없었으면 false
     */
    private final boolean rejected;

    /**
     * 결과를 알 수 없는 실패로 예외 생성
     *
     * @param message 실패 설명
     */
    public TngGatewayException(String message) {
        this(message, false);
    }

    /**
     * 실패의 종류를 밝혀 예외 생성
     *
     * @param message 실패 설명
     * @param rejected 외부 시스템이 처리하지 않은 것이 확실한지
     */
    public TngGatewayException(String message, boolean rejected) {
        super(message);
        this.rejected = rejected;
    }
}
