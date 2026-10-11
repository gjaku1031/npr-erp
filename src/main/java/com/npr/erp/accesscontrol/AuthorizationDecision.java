package com.npr.erp.accesscontrol;

/**
 * 인가 판단의 공개 결과
 *
 * 어떤 ACL이 맞았는지 같은 내부 정보는 감사 기록에만 남기고 여기에는 담지 않음
 *
 * @param allowed 요청을 실행해도 되는지
 * @param reason 허용 또는 거부 사유
 * @param policy 판단에 쓴 정책 경로
 */
public record AuthorizationDecision(boolean allowed, AuthorizationReason reason, AuthorizationPolicy policy) {
    /**
     * 허용 결정 생성
     *
     * @param reason 허용 사유
     * @param policy 정책 경로
     * @return 허용 결정
     */
    public static AuthorizationDecision allow(AuthorizationReason reason, AuthorizationPolicy policy) {
        return new AuthorizationDecision(true, reason, policy);
    }

    /**
     * 거부 결정 생성
     *
     * @param reason 거부 사유
     * @param policy 정책 경로
     * @return 거부 결정
     */
    public static AuthorizationDecision deny(AuthorizationReason reason, AuthorizationPolicy policy) {
        return new AuthorizationDecision(false, reason, policy);
    }
}
