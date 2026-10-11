package com.npr.erp.accesscontrol.internal.authorization;

import com.npr.erp.accesscontrol.AuthorizationDecision;
import com.npr.erp.accesscontrol.AuthorizationPolicy;
import com.npr.erp.accesscontrol.AuthorizationReason;
import com.npr.erp.accesscontrol.AuthorizationRequest;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.AuthorizationTarget;
import com.npr.erp.accesscontrol.Authorizer;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.PermissionKey;
import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.accesscontrol.ResourceContext;
import com.npr.erp.accesscontrol.internal.acl.ResourceAclQuery;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditEvent;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditRecorder;
import com.npr.erp.accesscontrol.internal.superuser.PlatformSuperuserRepository;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 조회와 감사 기록을 맡는 {@link Authorizer} 구현
 *
 * 한 번의 판단에서 읽는 소속·역할·권한·ACL이 같은 시점의 값이 되도록 REPEATABLE_READ 읽기 전용 트랜잭션에서 실행함.
 * 거부와 슈퍼유저 우회는 호출한 업무가 롤백돼도 남도록 별도 트랜잭션으로 기록함
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class DefaultAuthorizer implements Authorizer {
    /**
     * 플랫폼 슈퍼유저 등록부
     */
    private final PlatformSuperuserRepository superuserRepository;

    /**
     * 현재 권한 조회
     */
    private final AccessSnapshotQuery accessSnapshotQuery;

    /**
     * ACL 후보 조회
     */
    private final ResourceAclQuery resourceAclQuery;

    /**
     * 순수 정책 엔진
     */
    private final AuthorizationPolicyEngine policyEngine;

    /**
     * 감사 기록기
     */
    private final AuthorizationAuditRecorder auditRecorder;

    /**
     * {@inheritDoc}
     */
    @Override
    public AuthorizationDecision authorize(AuthorizationRequest request) {
        var target = request.target();
        var policy = AuthorizationPolicyEngine.policyOf(target);

        // 권한 계약을 슈퍼유저 확인보다 먼저 봄. 슈퍼유저도 모르는 권한이나 잘못된 작업 조합으로는 허용받지 못함
        var definition = PermissionCatalog.find(request.permission()).orElse(null);
        if (definition == null || !definition.supports(target)) {
            var reason = definition == null
                    ? AuthorizationReason.UNKNOWN_PERMISSION
                    : AuthorizationReason.PERMISSION_TARGET_MISMATCH;
            var decision = AuthorizationDecision.deny(reason, policy);
            auditRecorder.recordIndependent(AuthorizationAuditEvent.decision(request, decision, null, null));
            return decision;
        }

        // 플랫폼 슈퍼유저는 소속·권한·ACL 검사를 건너뛰되 매번 기록을 남김
        if (superuserRepository.existsById(request.subject().accountId())) {
            var decision = AuthorizationDecision.allow(AuthorizationReason.SUPERUSER_BYPASS, policy);
            auditRecorder.recordIndependent(AuthorizationAuditEvent.decision(request, decision, null, null));
            return decision;
        }

        // 소속·기능 권한에서 실패하면 ACL을 읽지 않음
        var snapshot = accessSnapshotQuery.load(request.subject().accountId(), target.academyId());
        var evaluation = policyEngine
                .baseAccessFailure(target.academyId(), request.permission(), snapshot.access(), policy)
                .orElseGet(() -> switch (target) {
                    case AuthorizationTarget.Academy ignored -> policyEngine.evaluate(
                            request, snapshot.access(), List.of());
                    case AuthorizationTarget.Resource resource -> policyEngine.evaluate(
                            request,
                            snapshot.access(),
                            resourceAclQuery.load(
                                    request.subject(),
                                    List.of(resource.context()),
                                    resource.action(),
                                    snapshot.access().roleIds()));
                });

        // 일반 허용은 기록하지 않고 거부만 기록함
        if (!evaluation.decision().allowed()) {
            auditRecorder.recordIndependent(AuthorizationAuditEvent.decision(
                    request, evaluation.decision(), snapshot.policyVersion(), evaluation.matchedAclId()));
        }
        return evaluation.decision();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public Set<UUID> filterPermitted(
            AuthorizationSubject subject,
            PermissionKey permission,
            ResourceAction action,
            Collection<ResourceContext> resources,
            String requestId) {
        if (resources.isEmpty()) {
            return Set.of();
        }

        // 입력 형식 확인: 한 번의 목록 인가는 한 학원, 한 종류, 중복 없는 리소스만 받음
        var academyIds = new HashSet<UUID>();
        var resourceTypes = new HashSet<>();
        var resourceIds = new LinkedHashSet<UUID>();
        for (var context : resources) {
            academyIds.add(context.academyId());
            resourceTypes.add(context.resourceType());
            resourceIds.add(context.resourceId());
        }
        if (academyIds.size() != 1) {
            throw new IllegalArgumentException("한 번의 목록 인가에는 하나의 학원만 쓸 수 있습니다.");
        }
        if (resourceTypes.size() != 1) {
            throw new IllegalArgumentException("한 번의 목록 인가에는 하나의 리소스 종류만 쓸 수 있습니다.");
        }
        if (resourceIds.size() != resources.size()) {
            throw new IllegalArgumentException("한 번의 목록 인가에 같은 리소스를 두 번 넣을 수 없습니다.");
        }
        var academyId = academyIds.iterator().next();
        var first = resources.iterator().next();

        // 권한 계약 확인. 실패하면 항목마다가 아니라 요청 전체를 한 건으로 기록
        var definition = PermissionCatalog.find(permission).orElse(null);
        if (definition == null || !definition.supports(new AuthorizationTarget.Resource(first, action))) {
            var reason = definition == null
                    ? AuthorizationReason.UNKNOWN_PERMISSION
                    : AuthorizationReason.PERMISSION_TARGET_MISMATCH;
            auditBatchDenial(subject, academyId, permission, action, requestId, reason, resources.size(), null);
            return Set.of();
        }

        if (superuserRepository.existsById(subject.accountId())) {
            auditRecorder.recordIndependent(AuthorizationAuditEvent.builder()
                    .eventType("SUPERUSER_BATCH_BYPASS")
                    .requestId(requestId)
                    .actorAccountId(subject.accountId())
                    .academyId(academyId)
                    .permissionKey(permission.value())
                    .decision("ALLOW")
                    .reasonCode(AuthorizationReason.SUPERUSER_BYPASS.name())
                    .details(Map.of("resourceCount", resources.size()))
                    .build());
            return resourceIds;
        }

        var snapshot = accessSnapshotQuery.load(subject.accountId(), academyId);
        var baseFailure = policyEngine.baseAccessFailure(
                academyId, permission, snapshot.access(), AuthorizationPolicy.RESOURCE_V1);
        if (baseFailure.isPresent()) {
            auditBatchDenial(
                    subject,
                    academyId,
                    permission,
                    action,
                    requestId,
                    baseFailure.get().decision().reason(),
                    resources.size(),
                    snapshot.policyVersion());
            return Set.of();
        }

        // ACL 후보를 한 번에 읽고 메모리에서 리소스마다 평가. 개별 항목이 ACL로 빠지는 것은 정상 동작이라 기록하지 않음
        var grants = resourceAclQuery.load(subject, resources, action, snapshot.access().roleIds());
        return policyEngine.filterPermitted(subject, permission, action, resources, snapshot.access(), grants);
    }

    /**
     * 목록 요청 전체가 거부된 사실을 한 건으로 기록
     *
     * @param subject 요청 주체
     * @param academyId 학원 ID
     * @param permission 요청한 권한
     * @param action 요청한 ACL 작업
     * @param requestId 요청 추적 ID
     * @param reason 거부 사유
     * @param resourceCount 요청에 들어 있던 리소스 수
     * @param policyVersion 정책 버전. 읽기 전에 거부됐으면 null
     */
    private void auditBatchDenial(
            AuthorizationSubject subject,
            UUID academyId,
            PermissionKey permission,
            ResourceAction action,
            String requestId,
            AuthorizationReason reason,
            int resourceCount,
            Long policyVersion) {
        auditRecorder.recordIndependent(AuthorizationAuditEvent.builder()
                .eventType("AUTHORIZATION_BATCH_DENIED")
                .requestId(requestId)
                .actorAccountId(subject.accountId())
                .academyId(academyId)
                .permissionKey(permission.value())
                .decision("DENY")
                .reasonCode(reason.name())
                .policyVersion(policyVersion)
                .details(Map.of("action", action.name(), "resourceCount", resourceCount))
                .build());
    }
}
