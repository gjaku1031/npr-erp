package com.npr.erp.accesscontrol.internal.acl;

import com.npr.erp.accesscontrol.AcademyPolicyView;
import com.npr.erp.accesscontrol.AcademyRoleStatus;
import com.npr.erp.accesscontrol.AccessControlConflictException;
import com.npr.erp.accesscontrol.AccessControlNotFoundException;
import com.npr.erp.accesscontrol.AccessControlValidationException;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.MembershipStatus;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.ResourceAclLifecycle;
import com.npr.erp.accesscontrol.ResourceAclManagement;
import com.npr.erp.accesscontrol.ResourceAclSubject;
import com.npr.erp.accesscontrol.ResourceAclView;
import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.accesscontrol.ResourceContext;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditEvent;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditRecorder;
import com.npr.erp.accesscontrol.internal.authorization.PolicyGuard;
import com.npr.erp.accesscontrol.internal.membership.StaffMembershipRepository;
import com.npr.erp.accesscontrol.internal.role.AcademyRoleRepository;
import com.npr.erp.accesscontrol.internal.scope.AcademyLockoutGuard;
import com.npr.erp.accesscontrol.internal.scope.AcademyPolicyMutationLock;
import com.npr.erp.accesscontrol.internal.scope.AcademyScopeLocker;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * ACL 관리와 생명주기 정리 구현
 *
 * 변경은 학원별 잠금 → 인가 → 정책 행 잠금과 버전 확인 → 변경 → 마지막 관리자 보호 → 버전 올림과 감사 기록 순서로 함
 */
@Service
@RequiredArgsConstructor
public class JpaResourceAclManagement implements ResourceAclManagement, ResourceAclLifecycle {
    /**
     * 인가 확인
     */
    private final PolicyGuard policyGuard;

    /**
     * 학원별 정책 변경 잠금
     */
    private final AcademyPolicyMutationLock mutationLock;

    /**
     * 학원 정책 조회와 행 잠금
     */
    private final AcademyScopeLocker scopeLocker;

    /**
     * ACL 저장소
     */
    private final ResourceAclRepository repository;

    /**
     * 소속 저장소. 계정 주체 검증에 사용
     */
    private final StaffMembershipRepository membershipRepository;

    /**
     * 역할 저장소. 역할 주체 검증에 사용
     */
    private final AcademyRoleRepository roleRepository;

    /**
     * 마지막 ACL 관리자 보호
     */
    private final AcademyLockoutGuard lockoutGuard;

    /**
     * 감사 기록기
     */
    private final AuthorizationAuditRecorder auditRecorder;

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public AcademyPolicyView<List<ResourceAclView>> list(AuthorizationSubject actor, ResourceContext context) {
        policyGuard.requireResource(actor, context, PermissionCatalog.STORAGE_ACL_READ);
        var scope = scopeLocker.get(context.academyId());
        var views = directAcls(context).stream().map(ResourceAclEntity::toView).toList();
        return new AcademyPolicyView<>(context.academyId(), scope.getPolicyVersion(), views);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public AcademyPolicyView<ResourceAclView> grant(
            AuthorizationSubject actor,
            ResourceContext context,
            ResourceAclSubject subject,
            ResourceAction action,
            boolean inheritToChildren,
            long expectedPolicyVersion) {
        // 잠금을 먼저 잡고 인가해야, 인가와 변경 사이에 다른 정책 변경이 끼어들지 못함
        mutationLock.acquire(context.academyId());
        policyGuard.requireResource(actor, context, PermissionCatalog.STORAGE_ACL_MANAGE);
        var scope = scopeLocker.lock(context.academyId());
        scope.requireVersion(expectedPolicyVersion);
        validateSubject(context.academyId(), subject);

        // 같은 주체·작업의 항목이 같은 설정으로 이미 있으면 바꾸지 않고 버전도 올리지 않음
        var existing = findExisting(context, subject, action).orElse(null);
        if (existing != null && existing.isInheritToChildren() == inheritToChildren) {
            return new AcademyPolicyView<>(context.academyId(), scope.getPolicyVersion(), existing.toView());
        }

        var now = Instant.now();
        var before = existing == null ? null : existing.toView();
        ResourceAclEntity acl;
        if (existing == null) {
            acl = repository.save(new ResourceAclEntity(
                    context.academyId(),
                    context.resourceType(),
                    context.resourceId(),
                    subject,
                    action,
                    inheritToChildren,
                    actor.accountId(),
                    now));
        } else {
            existing.changeInheritance(inheritToChildren, now);
            acl = existing;
        }

        var version = scope.advance(now);
        var after = acl.toView();
        var eventType = before == null ? "RESOURCE_ACL_GRANTED" : "RESOURCE_ACL_UPDATED";
        auditRecorder.recordInCurrentTransaction(resourceEvent(eventType, actor, context)
                .policyVersion(version)
                .matchedAclId(acl.getId())
                .beforeState(before)
                .afterState(after)
                .build());
        return new AcademyPolicyView<>(context.academyId(), version, after);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public AcademyPolicyView<Void> revoke(
            AuthorizationSubject actor, ResourceContext context, UUID aclId, long expectedPolicyVersion) {
        mutationLock.acquire(context.academyId());
        policyGuard.requireResource(actor, context, PermissionCatalog.STORAGE_ACL_MANAGE);
        var scope = scopeLocker.lock(context.academyId());
        scope.requireVersion(expectedPolicyVersion);

        // 요청한 리소스의 ACL이 맞는지 확인. 다른 폴더의 ACL ID를 끼워 넣는 요청을 막음
        var acl = repository.findByIdAndAcademyId(aclId, context.academyId())
                .filter(entity -> entity.getResourceType() == context.resourceType()
                        && entity.getResourceId().equals(context.resourceId()))
                .orElseThrow(() -> new AccessControlNotFoundException("ACL_NOT_FOUND", "ACL을 찾을 수 없습니다."));
        var before = acl.toView();
        repository.delete(acl);

        // 회수한 뒤에도 ACL을 관리할 수 있는 사람이 학원에 남아 있어야 함
        lockoutGuard.requireLocalAclManager(scope, actor, "REVOKE_RESOURCE_ACL");
        var version = scope.advance(Instant.now());
        auditRecorder.recordInCurrentTransaction(resourceEvent("RESOURCE_ACL_REVOKED", actor, context)
                .policyVersion(version)
                .matchedAclId(acl.getId())
                .beforeState(before)
                .build());
        return new AcademyPolicyView<>(context.academyId(), version, null);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public AcademyPolicyView<Void> revokeAll(AuthorizationSubject actor, ResourceContext context) {
        mutationLock.acquire(context.academyId());
        var scope = scopeLocker.lock(context.academyId());

        // 루트의 ACL은 학원의 관리 경로이므로 생명주기 정리로는 지울 수 없음
        if (context.resourceId().equals(scope.getStorageRootResourceId())) {
            auditRecorder.recordIndependent(resourceEvent("ROOT_ACL_LIFECYCLE_REVOKE_DENIED", actor, context)
                    .reasonCode("ROOT_ACL_LIFECYCLE_REVOKE_FORBIDDEN")
                    .policyVersion(scope.getPolicyVersion())
                    .build());
            throw new AccessControlConflictException(
                    "ROOT_ACL_LIFECYCLE_REVOKE_FORBIDDEN", "학원 루트의 ACL은 리소스 정리로 회수할 수 없습니다.");
        }

        var existing = directAcls(context);
        if (existing.isEmpty()) {
            return new AcademyPolicyView<>(context.academyId(), scope.getPolicyVersion(), null);
        }
        var before = existing.stream().map(ResourceAclEntity::toView).toList();
        repository.deleteAll(existing);
        var version = scope.advance(Instant.now());
        auditRecorder.recordInCurrentTransaction(resourceEvent("RESOURCE_ACL_LIFECYCLE_REVOKED", actor, context)
                .policyVersion(version)
                .beforeState(before)
                .build());
        return new AcademyPolicyView<>(context.academyId(), version, null);
    }

    /**
     * 리소스에 직접 걸린 ACL 조회
     *
     * @param context 리소스 문맥
     * @return 생성 순서의 ACL
     */
    private List<ResourceAclEntity> directAcls(ResourceContext context) {
        return repository.findAllByAcademyIdAndResourceTypeAndResourceIdOrderByCreatedAtAsc(
                context.academyId(), context.resourceType(), context.resourceId());
    }

    /**
     * 같은 리소스·주체·작업의 기존 ACL 조회
     *
     * @param context 리소스 문맥
     * @param subject 주체
     * @param action 작업
     * @return 없으면 빈 값
     */
    private Optional<ResourceAclEntity> findExisting(
            ResourceContext context, ResourceAclSubject subject, ResourceAction action) {
        return switch (subject) {
            case ResourceAclSubject.Account account -> repository
                    .findByAcademyIdAndResourceTypeAndResourceIdAndSubjectAccountIdAndAction(
                            context.academyId(),
                            context.resourceType(),
                            context.resourceId(),
                            account.accountId(),
                            action);
            case ResourceAclSubject.Role role -> repository
                    .findByAcademyIdAndResourceTypeAndResourceIdAndSubjectRoleIdAndAction(
                            context.academyId(), context.resourceType(), context.resourceId(), role.roleId(), action);
        };
    }

    /**
     * ACL 주체가 같은 학원의 유효한 대상인지 확인
     *
     * @param academyId 학원 ID
     * @param subject 주체
     * @throws AccessControlValidationException 활성 소속이 없는 계정이거나 같은 학원의 활성 역할이 아닐 때
     */
    private void validateSubject(UUID academyId, ResourceAclSubject subject) {
        switch (subject) {
            case ResourceAclSubject.Account account -> {
                var active = membershipRepository
                        .findByAcademyIdAndAccountIdAndStatus(academyId, account.accountId(), MembershipStatus.ACTIVE)
                        .isPresent();
                if (!active) {
                    throw new AccessControlValidationException(
                            "ACL_ACCOUNT_MEMBERSHIP_REQUIRED", "계정에 ACL을 주려면 그 학원의 활성 소속이 필요합니다.");
                }
            }
            case ResourceAclSubject.Role role -> {
                var active = roleRepository
                        .findByIdAndAcademyId(role.roleId(), academyId)
                        .filter(entity -> entity.getStatus() == AcademyRoleStatus.ACTIVE)
                        .isPresent();
                if (!active) {
                    throw new AccessControlValidationException(
                            "ACL_ROLE_INVALID", "역할에 ACL을 주려면 같은 학원의 활성 역할이어야 합니다.");
                }
            }
        }
    }

    /**
     * 리소스 대상 감사 사건의 공통 필드 채우기
     *
     * @param eventType 사건 종류. 사유 코드도 같은 값으로 채움
     * @param actor 실행한 주체
     * @param context 리소스 문맥
     * @return 나머지 필드를 채울 빌더
     */
    private static AuthorizationAuditEvent.AuthorizationAuditEventBuilder resourceEvent(
            String eventType, AuthorizationSubject actor, ResourceContext context) {
        return AuthorizationAuditEvent.builder()
                .eventType(eventType)
                .reasonCode(eventType)
                .actorAccountId(actor.accountId())
                .academyId(context.academyId())
                .resourceType(context.resourceType().name())
                .resourceId(context.resourceId());
    }
}
