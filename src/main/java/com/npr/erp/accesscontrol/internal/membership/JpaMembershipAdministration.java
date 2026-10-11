package com.npr.erp.accesscontrol.internal.membership;

import com.npr.erp.accesscontrol.AcademyPolicyView;
import com.npr.erp.accesscontrol.AccessControlConflictException;
import com.npr.erp.accesscontrol.AccessControlNotFoundException;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.MembershipAdministration;
import com.npr.erp.accesscontrol.MembershipStatus;
import com.npr.erp.accesscontrol.MembershipView;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditEvent;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditRecorder;
import com.npr.erp.accesscontrol.internal.authorization.PolicyGuard;
import com.npr.erp.accesscontrol.internal.scope.AcademyLockoutGuard;
import com.npr.erp.accesscontrol.internal.scope.AcademyPolicyMutationGate;
import com.npr.erp.accesscontrol.internal.scope.AcademyScopeLocker;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link MembershipAdministration} 구현
 */
@Service
@RequiredArgsConstructor
public class JpaMembershipAdministration implements MembershipAdministration {
    /**
     * 인가 확인
     */
    private final PolicyGuard policyGuard;

    /**
     * 정책 변경 진입 절차
     */
    private final AcademyPolicyMutationGate mutationGate;

    /**
     * 학원 정책 조회
     */
    private final AcademyScopeLocker scopeLocker;

    /**
     * 소속 저장소
     */
    private final StaffMembershipRepository repository;

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
    public AcademyPolicyView<List<MembershipView>> memberships(AuthorizationSubject actor, UUID academyId) {
        policyGuard.requireAcademy(actor, academyId, PermissionCatalog.ACCESS_MEMBERSHIP_READ);
        var scope = scopeLocker.get(academyId);
        var views = repository.findAllByAcademyIdOrderByCreatedAtAsc(academyId).stream()
                .map(StaffMembershipEntity::toView)
                .toList();
        return new AcademyPolicyView<>(academyId, scope.getPolicyVersion(), views);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public AcademyPolicyView<MembershipView> createMembership(
            AuthorizationSubject actor, UUID academyId, UUID accountId, long expectedPolicyVersion) {
        var scope = mutationGate.open(
                actor, academyId, PermissionCatalog.ACCESS_MEMBERSHIP_MANAGE, expectedPolicyVersion);
        if (repository.findByAcademyIdAndAccountIdAndStatus(academyId, accountId, MembershipStatus.ACTIVE)
                .isPresent()) {
            throw new AccessControlConflictException(
                    "ACTIVE_MEMBERSHIP_ALREADY_EXISTS", "이 계정에는 이미 활성 소속이 있습니다.");
        }

        var now = Instant.now();
        var membership = repository.save(new StaffMembershipEntity(academyId, accountId, actor.accountId(), now));
        var version = scope.advance(now);
        var view = membership.toView();
        auditRecorder.recordInCurrentTransaction(AuthorizationAuditEvent.builder()
                .eventType("MEMBERSHIP_CREATED")
                .reasonCode("MEMBERSHIP_CREATED")
                .actorAccountId(actor.accountId())
                .targetAccountId(accountId)
                .academyId(academyId)
                .policyVersion(version)
                .afterState(view)
                .build());
        return new AcademyPolicyView<>(academyId, version, view);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public AcademyPolicyView<MembershipView> endMembership(
            AuthorizationSubject actor, UUID academyId, UUID membershipId, long expectedPolicyVersion) {
        var scope = mutationGate.open(
                actor, academyId, PermissionCatalog.ACCESS_MEMBERSHIP_MANAGE, expectedPolicyVersion);
        var membership = repository.findByIdAndAcademyId(membershipId, academyId)
                .orElseThrow(() -> new AccessControlNotFoundException("MEMBERSHIP_NOT_FOUND", "소속을 찾을 수 없습니다."));
        if (membership.getStatus() != MembershipStatus.ACTIVE) {
            throw new AccessControlConflictException("MEMBERSHIP_INACTIVE", "종료된 소속은 바꿀 수 없습니다.");
        }

        var before = membership.toView();
        var now = Instant.now();
        membership.end(now);
        lockoutGuard.requireLocalAclManager(scope, actor, "END_MEMBERSHIP");
        var version = scope.advance(now);
        var after = membership.toView();
        auditRecorder.recordInCurrentTransaction(AuthorizationAuditEvent.builder()
                .eventType("MEMBERSHIP_ENDED")
                .reasonCode("MEMBERSHIP_ENDED")
                .actorAccountId(actor.accountId())
                .targetAccountId(membership.getAccountId())
                .academyId(academyId)
                .policyVersion(version)
                .beforeState(before)
                .afterState(after)
                .build());
        return new AcademyPolicyView<>(academyId, version, after);
    }
}
