package com.npr.erp.accesscontrol.internal.authorization;

import com.npr.erp.accesscontrol.AuthorizationDecision;
import com.npr.erp.accesscontrol.AuthorizationPolicy;
import com.npr.erp.accesscontrol.AuthorizationReason;
import java.util.UUID;

/**
 * 정책 엔진의 내부 평가 결과
 *
 * 공개 결정에 더해 감사 기록에 남길 ACL ID를 가짐
 *
 * @param decision 공개 결정
 * @param matchedAclId 허용 근거가 된 ACL ID. ACL을 쓰지 않았거나 거부면 null
 */
public record AuthorizationEvaluation(AuthorizationDecision decision, UUID matchedAclId) {
    /**
     * 허용 평가 생성
     *
     * @param policy 정책 경로
     * @param matchedAclId 허용 근거가 된 ACL ID. 없으면 null
     * @return 허용 평가
     */
    public static AuthorizationEvaluation allow(AuthorizationPolicy policy, UUID matchedAclId) {
        return new AuthorizationEvaluation(
                AuthorizationDecision.allow(AuthorizationReason.ALLOWED, policy), matchedAclId);
    }

    /**
     * 거부 평가 생성
     *
     * @param reason 거부 사유
     * @param policy 정책 경로
     * @return 거부 평가
     */
    public static AuthorizationEvaluation deny(AuthorizationReason reason, AuthorizationPolicy policy) {
        return new AuthorizationEvaluation(AuthorizationDecision.deny(reason, policy), null);
    }
}
