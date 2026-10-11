package com.npr.erp.accesscontrol.internal.audit;

import com.npr.erp.accesscontrol.AuthorizationDecision;
import com.npr.erp.accesscontrol.AuthorizationRequest;
import com.npr.erp.accesscontrol.AuthorizationTarget;
import java.util.UUID;
import lombok.Builder;

/**
 * 감사 기록으로 남길 사건
 *
 * 필요한 필드만 빌더로 채우고 나머지는 null로 둠
 *
 * @param eventType 사건 종류
 * @param requestId 요청 추적 ID. null이면 기록할 때 로그 문맥의 값을 씀
 * @param actorAccountId 실행한 계정
 * @param targetAccountId 대상 계정
 * @param academyId 학원 ID
 * @param permissionKey 판단한 권한 키
 * @param resourceType 리소스 종류
 * @param resourceId 리소스 ID
 * @param decision ALLOW 또는 DENY
 * @param reasonCode 사유 코드. 반드시 있어야 함
 * @param policyVersion 정책 버전
 * @param matchedAclId 관련 ACL ID
 * @param beforeState 변경 전 상태. JSON으로 저장
 * @param afterState 변경 후 상태. JSON으로 저장
 * @param details 그 밖의 정보. JSON으로 저장
 */
@Builder
public record AuthorizationAuditEvent(
        String eventType,
        String requestId,
        UUID actorAccountId,
        UUID targetAccountId,
        UUID academyId,
        String permissionKey,
        String resourceType,
        UUID resourceId,
        String decision,
        String reasonCode,
        Long policyVersion,
        UUID matchedAclId,
        Object beforeState,
        Object afterState,
        Object details) {
    /**
     * 인가 판단 결과를 사건으로 변환
     *
     * @param request 인가 요청
     * @param decision 판단 결과
     * @param policyVersion 판단 시점의 정책 버전. 읽기 전이면 null
     * @param matchedAclId 허용 근거가 된 ACL ID. 없으면 null
     * @return 판단 사건
     */
    public static AuthorizationAuditEvent decision(
            AuthorizationRequest request, AuthorizationDecision decision, Long policyVersion, UUID matchedAclId) {
        var builder = builder()
                .eventType(decision.allowed() ? "AUTHORIZATION_ALLOWED" : "AUTHORIZATION_DENIED")
                .requestId(request.requestId())
                .actorAccountId(request.subject().accountId())
                .academyId(request.target().academyId())
                .permissionKey(request.permission().value())
                .decision(decision.allowed() ? "ALLOW" : "DENY")
                .reasonCode(decision.reason().name())
                .policyVersion(policyVersion)
                .matchedAclId(matchedAclId);
        if (request.target() instanceof AuthorizationTarget.Resource resource) {
            builder.resourceType(resource.context().resourceType().name())
                    .resourceId(resource.context().resourceId());
        }
        return builder.build();
    }
}
