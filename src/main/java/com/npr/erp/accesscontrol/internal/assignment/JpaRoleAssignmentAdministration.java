package com.npr.erp.accesscontrol.internal.assignment;

import com.npr.erp.accesscontrol.AcademyPolicyView;
import com.npr.erp.accesscontrol.AcademyRoleStatus;
import com.npr.erp.accesscontrol.AccessControlConflictException;
import com.npr.erp.accesscontrol.AccessControlNotFoundException;
import com.npr.erp.accesscontrol.AccessControlValidationException;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.MembershipStatus;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.RoleAssignmentAdministration;
import com.npr.erp.accesscontrol.RoleAssignmentView;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditEvent;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditRecorder;
import com.npr.erp.accesscontrol.internal.authorization.PolicyGuard;
import com.npr.erp.accesscontrol.internal.membership.StaffMembershipRepository;
import com.npr.erp.accesscontrol.internal.role.AcademyRoleEntity;
import com.npr.erp.accesscontrol.internal.role.AcademyRoleRepository;
import com.npr.erp.accesscontrol.internal.scope.AcademyLockoutGuard;
import com.npr.erp.accesscontrol.internal.scope.AcademyPolicyMutationGate;
import com.npr.erp.accesscontrol.internal.scope.AcademyScopeLocker;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link RoleAssignmentAdministration} 구현
 */
@Service
@RequiredArgsConstructor
public class JpaRoleAssignmentAdministration implements RoleAssignmentAdministration {
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
    private final StaffMembershipRepository membershipRepository;

    /**
     * 역할 저장소
     */
    private final AcademyRoleRepository roleRepository;

    /**
     * 역할 배정 저장소
     */
    private final RoleAssignmentRepository assignmentRepository;

    /**
     * 마지막 ACL 관리자 보호
     */
    private final AcademyLockoutGuard lockoutGuard;

    /**
     * 감사 기록기
     */
    private final AuthorizationAuditRecorder auditRecorder;

    /**
     * 현재 트랜잭션의 영속성 컨텍스트
     */
    private final EntityManager entityManager;

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public AcademyPolicyView<Map<UUID, List<RoleAssignmentView>>> assignments(
            AuthorizationSubject actor, UUID academyId) {
        policyGuard.requireAcademy(actor, academyId, PermissionCatalog.ACCESS_ASSIGNMENT_READ);
        var scope = scopeLocker.get(academyId);
        var assignments = assignmentRepository.findAllByAcademyIdAndRevokedAtIsNullOrderByAssignedAtAsc(academyId);
        var grouped = new LinkedHashMap<UUID, List<RoleAssignmentView>>();
        for (var view : toViews(assignments)) {
            grouped.computeIfAbsent(view.membershipId(), ignored -> new ArrayList<>()).add(view);
        }
        return new AcademyPolicyView<>(academyId, scope.getPolicyVersion(), grouped);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public AcademyPolicyView<List<RoleAssignmentView>> replaceMembershipRoles(
            AuthorizationSubject actor, UUID academyId, UUID membershipId, Set<UUID> roleIds,
            long expectedPolicyVersion) {
        var scope = mutationGate.open(
                actor, academyId, PermissionCatalog.ACCESS_ASSIGNMENT_MANAGE, expectedPolicyVersion);
        var membership = membershipRepository.findByIdAndAcademyId(membershipId, academyId)
                .orElseThrow(() -> new AccessControlNotFoundException("MEMBERSHIP_NOT_FOUND", "소속을 찾을 수 없습니다."));
        if (membership.getStatus() != MembershipStatus.ACTIVE) {
            throw new AccessControlConflictException("MEMBERSHIP_INACTIVE", "종료된 소속은 바꿀 수 없습니다.");
        }

        // 요청한 역할이 모두 같은 학원의 활성 역할인지 확인. 조회 결과 수가 요청 수와 다르면 일부가 조건에 맞지 않은 것
        var requestedRoles = roleIds.isEmpty()
                ? List.<AcademyRoleEntity>of()
                : roleRepository.findAllByIdInAndAcademyIdAndStatus(roleIds, academyId, AcademyRoleStatus.ACTIVE);
        if (requestedRoles.size() != roleIds.size()) {
            throw new AccessControlValidationException(
                    "INVALID_ROLE_ASSIGNMENT", "다른 학원의 역할이나 비활성 역할은 배정할 수 없습니다.");
        }

        var active = assignmentRepository.findAllByStaffMembershipIdAndRevokedAtIsNullOrderByAssignedAtAsc(
                membershipId);
        var beforeRoleIds = new HashSet<UUID>();
        for (var assignment : active) {
            beforeRoleIds.add(assignment.getRoleId());
        }
        if (beforeRoleIds.equals(roleIds)) {
            return new AcademyPolicyView<>(academyId, scope.getPolicyVersion(), toViews(active));
        }

        // 빠진 역할은 회수하고 새 역할만 추가함. 그대로인 배정은 건드리지 않음
        var now = Instant.now();
        for (var assignment : active) {
            if (!roleIds.contains(assignment.getRoleId())) {
                assignment.revoke(actor.accountId(), now);
            }
        }
        for (var roleId : roleIds) {
            if (!beforeRoleIds.contains(roleId)) {
                assignmentRepository.save(
                        new RoleAssignmentEntity(academyId, membershipId, roleId, actor.accountId(), now));
            }
        }

        lockoutGuard.requireLocalAclManager(scope, actor, "REPLACE_MEMBERSHIP_ROLES");
        var version = scope.advance(now);
        entityManager.flush();
        var views = toViews(assignmentRepository
                .findAllByStaffMembershipIdAndRevokedAtIsNullOrderByAssignedAtAsc(membershipId));
        auditRecorder.recordInCurrentTransaction(AuthorizationAuditEvent.builder()
                .eventType("ROLE_ASSIGNMENTS_REPLACED")
                .reasonCode("ROLE_ASSIGNMENTS_REPLACED")
                .actorAccountId(actor.accountId())
                .targetAccountId(membership.getAccountId())
                .academyId(academyId)
                .policyVersion(version)
                .beforeState(Map.of("membershipId", membershipId, "roleIds", sorted(beforeRoleIds)))
                .afterState(Map.of("membershipId", membershipId, "roleIds", sorted(roleIds)))
                .build());
        return new AcademyPolicyView<>(academyId, version, views);
    }

    /**
     * 배정에 역할 이름을 붙여 조회 결과로 변환
     *
     * @param assignments 유효한 배정
     * @return 입력 순서의 조회 결과
     * @throws AccessControlConflictException 배정이 가리키는 역할이 없을 때
     */
    private List<RoleAssignmentView> toViews(List<RoleAssignmentEntity> assignments) {
        var roleIds = new HashSet<UUID>();
        for (var assignment : assignments) {
            roleIds.add(assignment.getRoleId());
        }
        var roleNames = new HashMap<UUID, String>();
        for (var role : roleRepository.findAllById(roleIds)) {
            roleNames.put(role.getId(), role.getName());
        }

        var views = new ArrayList<RoleAssignmentView>();
        for (var assignment : assignments) {
            var roleName = roleNames.get(assignment.getRoleId());
            if (roleName == null) {
                throw new AccessControlConflictException("ROLE_REFERENCE_MISSING", "배정이 가리키는 역할을 찾을 수 없습니다.");
            }
            views.add(new RoleAssignmentView(
                    assignment.getId(),
                    assignment.getStaffMembershipId(),
                    assignment.getRoleId(),
                    roleName,
                    assignment.getAssignedAt()));
        }
        return views;
    }

    /**
     * 감사 기록에 넣을 정렬된 ID 문자열 목록
     *
     * @param ids 역할 ID 집합
     * @return 사전순으로 정렬한 문자열
     */
    private static List<String> sorted(Set<UUID> ids) {
        var values = new TreeSet<String>();
        for (var id : ids) {
            values.add(id.toString());
        }
        return List.copyOf(values);
    }
}
