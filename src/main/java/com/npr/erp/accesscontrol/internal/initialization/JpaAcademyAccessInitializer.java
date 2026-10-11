package com.npr.erp.accesscontrol.internal.initialization;

import com.npr.erp.accesscontrol.AcademyAccessInitializationResult;
import com.npr.erp.accesscontrol.AcademyAccessInitializer;
import com.npr.erp.accesscontrol.AccessControlConflictException;
import com.npr.erp.accesscontrol.AccessControlValidationException;
import com.npr.erp.accesscontrol.AuthorizationDeniedException;
import com.npr.erp.accesscontrol.InitializeAcademyAccessCommand;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.PermissionDefinition;
import com.npr.erp.accesscontrol.PermissionKey;
import com.npr.erp.accesscontrol.ResourceAclSubject;
import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.accesscontrol.ResourceType;
import com.npr.erp.accesscontrol.SuperuserAccess;
import com.npr.erp.accesscontrol.internal.acl.ResourceAclEntity;
import com.npr.erp.accesscontrol.internal.acl.ResourceAclRepository;
import com.npr.erp.accesscontrol.internal.assignment.RoleAssignmentEntity;
import com.npr.erp.accesscontrol.internal.assignment.RoleAssignmentRepository;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditEvent;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditRecorder;
import com.npr.erp.accesscontrol.internal.membership.StaffMembershipEntity;
import com.npr.erp.accesscontrol.internal.membership.StaffMembershipRepository;
import com.npr.erp.accesscontrol.internal.role.AcademyRoleEntity;
import com.npr.erp.accesscontrol.internal.role.AcademyRoleRepository;
import com.npr.erp.accesscontrol.internal.role.RoleNameNormalizer;
import com.npr.erp.accesscontrol.internal.role.RolePermissionEntity;
import com.npr.erp.accesscontrol.internal.role.RolePermissionRepository;
import com.npr.erp.accesscontrol.internal.role.RolePermissionValidator;
import com.npr.erp.accesscontrol.internal.scope.AcademyAccessScopeEntity;
import com.npr.erp.accesscontrol.internal.scope.AcademyAccessScopeRepository;
import com.npr.erp.accesscontrol.internal.scope.AcademyPolicyMutationLock;
import com.npr.erp.accesscontrol.internal.scope.LockoutGuardQuery;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link AcademyAccessInitializer} 구현
 */
@Service
@RequiredArgsConstructor
public class JpaAcademyAccessInitializer implements AcademyAccessInitializer {
    /**
     * 슈퍼유저 확인
     */
    private final SuperuserAccess superuserAccess;

    /**
     * 학원별 정책 변경 잠금
     */
    private final AcademyPolicyMutationLock mutationLock;

    /**
     * 정책 저장소
     */
    private final AcademyAccessScopeRepository scopeRepository;

    /**
     * 소속 저장소
     */
    private final StaffMembershipRepository membershipRepository;

    /**
     * 역할 저장소
     */
    private final AcademyRoleRepository roleRepository;

    /**
     * 역할-권한 연결 저장소
     */
    private final RolePermissionRepository rolePermissionRepository;

    /**
     * 역할 배정 저장소
     */
    private final RoleAssignmentRepository assignmentRepository;

    /**
     * ACL 저장소
     */
    private final ResourceAclRepository aclRepository;

    /**
     * 역할 이름 정규화
     */
    private final RoleNameNormalizer roleNameNormalizer;

    /**
     * 관리자 존재 확인 조회
     */
    private final LockoutGuardQuery lockoutQuery;

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
    @Transactional
    public AcademyAccessInitializationResult initialize(InitializeAcademyAccessCommand command) {
        var actorId = command.actor().accountId();
        var academyId = command.academyId();

        // 같은 학원을 동시에 초기화하려는 두 요청 중 하나만 통과하도록 정책 행이 없을 때도 잡히는 잠금을 먼저 획득
        mutationLock.acquire(academyId);
        var superuserDecision = superuserAccess.authorize(command.actor(), command.requestId());
        if (!superuserDecision.allowed()) {
            throw new AuthorizationDeniedException(superuserDecision);
        }
        if (scopeRepository.existsById(academyId)) {
            throw new AccessControlConflictException(
                    "ACADEMY_ACCESS_ALREADY_INITIALIZED", "학원 권한 정책이 이미 초기화되어 있습니다.");
        }

        // 첫 역할은 반드시 ACL 관리 권한을 가져야 함. 없으면 초기화 직후 아무도 권한을 고칠 수 없게 됨
        var permissionKeys = command.firstRolePermissionKeys();
        RolePermissionValidator.requireKnown(permissionKeys);
        if (!permissionKeys.contains(PermissionCatalog.STORAGE_ACL_MANAGE.key())) {
            throw new AccessControlValidationException(
                    "INITIAL_ACL_MANAGER_PERMISSION_REQUIRED", "첫 관리자 역할에는 storage.acl.manage 권한이 필요합니다.");
        }
        var roleName = roleNameNormalizer.normalize(command.firstRoleName());

        // 정책 → 소속·역할 → 역할 권한·배정 → 루트 ACL 순으로 저장. 외래 키 순서에 맞춰 중간에 flush
        var now = Instant.now();
        var scope = scopeRepository.save(new AcademyAccessScopeEntity(academyId, command.rootResourceId(), now));
        entityManager.flush();
        var membership = membershipRepository.save(
                new StaffMembershipEntity(academyId, command.firstAccountId(), actorId, now));
        var role = roleRepository.save(new AcademyRoleEntity(academyId, roleName, actorId, now));
        entityManager.flush();
        var sortedKeys = permissionKeys.stream().map(PermissionKey::value).sorted().toList();
        for (var key : sortedKeys) {
            rolePermissionRepository.save(new RolePermissionEntity(role.getId(), key, actorId, now));
        }
        assignmentRepository.save(
                new RoleAssignmentEntity(academyId, membership.getId(), role.getId(), actorId, now));

        // 루트 폴더에는 첫 역할의 권한에 맞는 작업을 상속 가능하게 허용
        var rootAclIds = new ArrayList<UUID>();
        UUID manageAclId = null;
        for (var action : rootActions(permissionKeys)) {
            var acl = aclRepository.save(new ResourceAclEntity(
                    academyId,
                    ResourceType.STORAGE_NODE,
                    command.rootResourceId(),
                    new ResourceAclSubject.Role(role.getId()),
                    action,
                    true,
                    actorId,
                    now));
            rootAclIds.add(acl.getId());
            if (action == ResourceAction.MANAGE_ACL) {
                manageAclId = acl.getId();
            }
        }

        // 방금 만든 구성으로 실제 ACL 관리자가 성립하는지 조회로 다시 확인
        entityManager.flush();
        if (!lockoutQuery.hasEffectiveRootAclManager(academyId, command.rootResourceId())) {
            throw new AccessControlConflictException("INITIAL_ACL_MANAGER_INVALID", "첫 ACL 관리자 경로를 만들지 못했습니다.");
        }

        auditRecorder.recordInCurrentTransaction(AuthorizationAuditEvent.builder()
                .eventType("ACADEMY_ACCESS_INITIALIZED")
                .reasonCode("ACADEMY_ACCESS_INITIALIZED")
                .requestId(command.requestId())
                .actorAccountId(actorId)
                .targetAccountId(command.firstAccountId())
                .academyId(academyId)
                .resourceType(ResourceType.STORAGE_NODE.name())
                .resourceId(command.rootResourceId())
                .policyVersion(scope.getPolicyVersion())
                .matchedAclId(manageAclId)
                .afterState(Map.of(
                        "membershipId", membership.getId(),
                        "roleId", role.getId(),
                        "roleName", role.getName(),
                        "permissions", sortedKeys,
                        "rootAclIds", rootAclIds))
                .build());
        return new AcademyAccessInitializationResult(
                academyId, scope.getPolicyVersion(), membership.getId(), role.getId(), manageAclId);
    }

    /**
     * 첫 역할의 권한에서 루트 폴더에 허용할 ACL 작업을 정함
     *
     * ACL 관리는 항상 포함하고, 나머지는 그 작업을 요구하는 권한을 하나라도 가졌을 때만 포함함
     *
     * @param permissionKeys 첫 역할의 권한 키
     * @return 루트에 허용할 작업
     */
    private static Set<ResourceAction> rootActions(Set<PermissionKey> permissionKeys) {
        var actions = EnumSet.of(ResourceAction.MANAGE_ACL);
        for (PermissionDefinition definition : PermissionCatalog.definitions()) {
            if (definition.resourceAction() != null && permissionKeys.contains(definition.key())) {
                actions.add(definition.resourceAction());
            }
        }
        return actions;
    }
}
