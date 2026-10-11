package com.npr.erp.accesscontrol.internal.authorization;

import com.npr.erp.accesscontrol.AuthorizationPolicy;
import com.npr.erp.accesscontrol.AuthorizationReason;
import com.npr.erp.accesscontrol.AuthorizationRequest;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.AuthorizationTarget;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.PermissionKey;
import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.accesscontrol.ResourceContext;
import com.npr.erp.accesscontrol.internal.acl.AclSubjectType;
import com.npr.erp.accesscontrol.internal.acl.ResourceAclGrant;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * 읽어 온 값만으로 허용 여부를 계산하는 순수 정책 엔진
 *
 * DB나 시각에 의존하지 않으므로 같은 입력에는 항상 같은 결과를 냄. 조회와 감사 기록은
 * {@link DefaultAuthorizer}가 맡음
 */
@Component
public final class AuthorizationPolicyEngine {
    /**
     * 단건 요청 평가
     *
     * 권한 계약 → 활성 소속 → 학원 일치 → 기능 권한 → (리소스 대상이면) ACL 순으로 확인하고 처음 실패한 사유를 돌려줌
     *
     * @param request 주체, 권한, 대상
     * @param access 주체의 현재 권한
     * @param aclGrants 대상 리소스와 조상에 걸린 ACL 후보. 학원 대상이면 빈 목록
     * @return 평가 결과
     */
    public AuthorizationEvaluation evaluate(
            AuthorizationRequest request, EffectiveAccess access, Collection<ResourceAclGrant> aclGrants) {
        var target = request.target();
        var policy = policyOf(target);

        // 권한 계약 확인: 모르는 키이거나 대상 종류·작업이 계약과 다르면 권한 보유와 무관하게 거부
        var definition = PermissionCatalog.find(request.permission()).orElse(null);
        if (definition == null) {
            return AuthorizationEvaluation.deny(AuthorizationReason.UNKNOWN_PERMISSION, policy);
        }
        if (!definition.supports(target)) {
            return AuthorizationEvaluation.deny(AuthorizationReason.PERMISSION_TARGET_MISMATCH, policy);
        }

        // 소속·학원·기능 권한 확인
        var baseFailure = baseAccessFailure(target.academyId(), request.permission(), access, policy);
        if (baseFailure.isPresent()) {
            return baseFailure.get();
        }

        // 리소스 대상은 기능 권한에 더해 맞는 ACL이 있어야 함
        return switch (target) {
            case AuthorizationTarget.Academy ignored -> AuthorizationEvaluation.allow(policy, null);
            case AuthorizationTarget.Resource resource -> matchingAcl(
                            request.subject(), resource.context(), resource.action(), access.roleIds(), aclGrants)
                    .map(grant -> AuthorizationEvaluation.allow(policy, grant.id()))
                    .orElseGet(() -> AuthorizationEvaluation.deny(AuthorizationReason.ACL_NOT_GRANTED, policy));
        };
    }

    /**
     * 여러 리소스 중 접근할 수 있는 것만 남김
     *
     * @param subject 목록을 조회하는 주체
     * @param permission 목록 기능에 필요한 리소스 권한
     * @param action 항목마다 요구할 ACL 작업
     * @param resources 리소스 문맥 목록
     * @param access 주체의 현재 권한
     * @param aclGrants 전체 리소스와 조상에 걸린 ACL 후보
     * @return 접근할 수 있는 리소스 ID. 입력 순서 유지
     */
    public Set<UUID> filterPermitted(
            AuthorizationSubject subject,
            PermissionKey permission,
            ResourceAction action,
            Collection<ResourceContext> resources,
            EffectiveAccess access,
            Collection<ResourceAclGrant> aclGrants) {
        var permitted = new LinkedHashSet<UUID>();
        for (var context : resources) {
            var request = new AuthorizationRequest(
                    subject, permission, new AuthorizationTarget.Resource(context, action));
            if (evaluate(request, access, aclGrants).decision().allowed()) {
                permitted.add(context.resourceId());
            }
        }
        return permitted;
    }

    /**
     * ACL을 보기 전에 확인하는 소속·학원·기능 권한 조건
     *
     * 여기서 실패하면 ACL을 읽을 필요가 없어 조회 전에 따로 호출할 수 있게 공개함
     *
     * @param academyId 요청 대상의 학원 ID
     * @param permission 필요한 기능 권한
     * @param access 주체의 현재 권한
     * @param policy 결과에 담을 정책 경로
     * @return 실패하면 거부 평가, 통과하면 빈 값
     */
    public Optional<AuthorizationEvaluation> baseAccessFailure(
            UUID academyId, PermissionKey permission, EffectiveAccess access, AuthorizationPolicy policy) {
        if (!access.membershipActive()) {
            return Optional.of(AuthorizationEvaluation.deny(AuthorizationReason.MEMBERSHIP_INACTIVE, policy));
        }
        if (!academyId.equals(access.academyId())) {
            return Optional.of(AuthorizationEvaluation.deny(AuthorizationReason.ACADEMY_SCOPE_MISMATCH, policy));
        }
        if (!access.permissions().contains(permission)) {
            return Optional.of(AuthorizationEvaluation.deny(AuthorizationReason.MISSING_PERMISSION, policy));
        }
        return Optional.empty();
    }

    /**
     * 요청에 맞는 ACL 중 리소스에 가장 가까운 것을 고름
     *
     * 명시적 거부 항목이 없으므로 이 선택은 허용 근거를 고르는 규칙이며, 가까운 ACL이 먼 허용을 취소하지는 않음
     *
     * @param subject 요청 주체
     * @param context 리소스 문맥
     * @param action 요구하는 ACL 작업
     * @param roleIds 주체의 유효한 역할 ID
     * @param grants ACL 후보
     * @return 직접 ACL, 없으면 가장 가까운 상속 가능 조상의 ACL
     */
    private static Optional<ResourceAclGrant> matchingAcl(
            AuthorizationSubject subject,
            ResourceContext context,
            ResourceAction action,
            Set<UUID> roleIds,
            Collection<ResourceAclGrant> grants) {
        return grants.stream()
                .filter(grant -> grant.academyId().equals(context.academyId())
                        && grant.resourceType() == context.resourceType()
                        && grant.action() == action
                        && matchesSubject(grant, subject, roleIds)
                        && appliesTo(grant, context))
                .min(Comparator.comparingInt(grant -> distance(grant, context)));
    }

    /**
     * ACL의 주체가 요청 주체에 해당하는지 확인
     *
     * @param grant ACL 후보
     * @param subject 요청 주체
     * @param roleIds 주체의 유효한 역할 ID
     * @return 계정 ACL이면 계정이 같을 때, 역할 ACL이면 그 역할을 가졌을 때 true
     */
    private static boolean matchesSubject(ResourceAclGrant grant, AuthorizationSubject subject, Set<UUID> roleIds) {
        return grant.subjectType() == AclSubjectType.ACCOUNT
                ? grant.subjectId().equals(subject.accountId())
                : roleIds.contains(grant.subjectId());
    }

    /**
     * ACL이 이 리소스에 적용되는지 확인
     *
     * @param grant ACL 후보
     * @param context 리소스 문맥
     * @return 리소스에 직접 걸렸거나, 조상에 걸려 있고 상속이 켜져 있으면 true
     */
    private static boolean appliesTo(ResourceAclGrant grant, ResourceContext context) {
        return grant.resourceId().equals(context.resourceId())
                || grant.inheritToChildren() && context.ancestorResourceIds().contains(grant.resourceId());
    }

    /**
     * ACL이 걸린 위치와 리소스 사이의 거리
     *
     * @param grant 이 리소스에 적용되는 ACL
     * @param context 리소스 문맥
     * @return 직접 걸렸으면 0, 직접 부모면 1, 그 위로 갈수록 1씩 큼
     */
    private static int distance(ResourceAclGrant grant, ResourceContext context) {
        if (grant.resourceId().equals(context.resourceId())) {
            return 0;
        }
        // 조상 목록은 루트부터 직접 부모 순서이므로 뒤에서부터의 위치가 거리
        var ancestors = context.ancestorResourceIds();
        return ancestors.size() - ancestors.indexOf(grant.resourceId());
    }

    /**
     * 대상 종류에 따른 정책 경로
     *
     * @param target 요청 대상
     * @return 학원 대상이면 ACADEMY_V1, 리소스 대상이면 RESOURCE_V1
     */
    public static AuthorizationPolicy policyOf(AuthorizationTarget target) {
        return switch (target) {
            case AuthorizationTarget.Academy ignored -> AuthorizationPolicy.ACADEMY_V1;
            case AuthorizationTarget.Resource ignored -> AuthorizationPolicy.RESOURCE_V1;
        };
    }
}
