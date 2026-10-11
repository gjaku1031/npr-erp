package com.npr.erp.accesscontrol;

import lombok.Getter;

/**
 * 거부된 요청을 중단할 때 쓰는 예외
 */
@Getter
public final class AuthorizationDeniedException extends AccessControlException {
    /**
     * 거부 사유와 정책 경로
     */
    private final AuthorizationDecision decision;

    /**
     * 거부 결정으로 예외 생성
     *
     * @param decision 거부 결정
     */
    public AuthorizationDeniedException(AuthorizationDecision decision) {
        super("ACCESS_DENIED", "요청한 작업을 수행할 권한이 없습니다: " + decision.reason());
        this.decision = decision;
    }
}
