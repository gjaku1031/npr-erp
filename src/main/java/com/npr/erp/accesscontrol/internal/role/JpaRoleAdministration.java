package com.npr.erp.accesscontrol.internal.role;

import com.npr.erp.accesscontrol.AcademyPolicyView;
import com.npr.erp.accesscontrol.AcademyRoleStatus;
import com.npr.erp.accesscontrol.AcademyRoleView;
import com.npr.erp.accesscontrol.AccessControlConflictException;
import com.npr.erp.accesscontrol.AccessControlNotFoundException;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.PermissionKey;
import com.npr.erp.accesscontrol.RoleAdministration;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditEvent;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditRecorder;
import com.npr.erp.accesscontrol.internal.authorization.PolicyGuard;
import com.npr.erp.accesscontrol.internal.scope.AcademyLockoutGuard;
import com.npr.erp.accesscontrol.internal.scope.AcademyPolicyMutationGate;
import com.npr.erp.accesscontrol.internal.scope.AcademyScopeLocker;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link RoleAdministration} 구현
 */
@Service
@RequiredArgsConstructor
public class JpaRoleAdministration implements RoleAdministration {
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
     * 역할 저장소
     */
    private final AcademyRoleRepository roleRepository;

    /**
     * 역할-권한 연결 저장소
     */
    private final RolePermissionRepository rolePermissionRepository;

    /**
     * 역할 이름 정규화
     */
    private final RoleNameNormalizer roleNameNormalizer;

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
    public AcademyPolicyView<List<AcademyRoleView>> roles(AuthorizationSubject actor, UUID academyId) {
        policyGuard.requireAcademy(actor, academyId, PermissionCatalog.ACCESS_ROLE_READ);
        var scope = scopeLocker.get(academyId);

        // 역할별 권한을 역할 수만큼 조회하지 않도록 한 번에 읽어 묶음
        var roles = roleRepository.findAllByAcademyIdOrderByCreatedAtAsc(academyId);
        var permissionsByRole = rolePermissionRepository
                .findAllByIdRoleIdIn(roles.stream().map(AcademyRoleEntity::getId).toList())
                .stream()
                .collect(Collectors.groupingBy(
                        entity -> entity.getId().getRoleId(),
                        Collectors.mapping(entity -> entity.getId().getPermissionKey(), Collectors.toSet())));
        var views = roles.stream()
                .map(role -> role.toView(permissionsByRole.getOrDefault(role.getId(), Set.of())))
                .toList();
        return new AcademyPolicyView<>(academyId, scope.getPolicyVersion(), views);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public AcademyPolicyView<AcademyRoleView> createRole(
            AuthorizationSubject actor, UUID academyId, String name, long expectedPolicyVersion) {
        var scope = mutationGate.open(actor, academyId, PermissionCatalog.ACCESS_ROLE_MANAGE, expectedPolicyVersion);
        var normalized = roleNameNormalizer.normalize(name);
        if (roleRepository.existsByAcademyIdAndNormalizedName(academyId, normalized.normalizedName())) {
            throw nameConflict();
        }

        var now = Instant.now();
        var role = roleRepository.save(new AcademyRoleEntity(academyId, normalized, actor.accountId(), now));
        var version = scope.advance(now);
        var view = role.toView(Set.of());
        auditRecorder.recordInCurrentTransaction(
                roleEvent("ROLE_CREATED", actor, academyId, version).afterState(view).build());
        return new AcademyPolicyView<>(academyId, version, view);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public AcademyPolicyView<AcademyRoleView> renameRole(
            AuthorizationSubject actor, UUID academyId, UUID roleId, String name, long expectedPolicyVersion) {
        var scope = mutationGate.open(actor, academyId, PermissionCatalog.ACCESS_ROLE_MANAGE, expectedPolicyVersion);
        var role = findRole(academyId, roleId);
        var normalized = roleNameNormalizer.normalize(name);
        if (roleRepository.existsByAcademyIdAndNormalizedNameAndIdNot(
                academyId, normalized.normalizedName(), roleId)) {
            throw nameConflict();
        }

        // 같은 이름으로의 변경은 버전을 올리지 않음
        var permissions = rolePermissions(roleId);
        var before = role.toView(permissions);
        if (role.getName().equals(normalized.displayName())) {
            return new AcademyPolicyView<>(academyId, scope.getPolicyVersion(), before);
        }

        var now = Instant.now();
        role.rename(normalized, now);
        var version = scope.advance(now);
        var after = role.toView(permissions);
        auditRecorder.recordInCurrentTransaction(roleEvent("ROLE_RENAMED", actor, academyId, version)
                .beforeState(before)
                .afterState(after)
                .build());
        return new AcademyPolicyView<>(academyId, version, after);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public AcademyPolicyView<AcademyRoleView> deactivateRole(
            AuthorizationSubject actor, UUID academyId, UUID roleId, long expectedPolicyVersion) {
        var scope = mutationGate.open(actor, academyId, PermissionCatalog.ACCESS_ROLE_MANAGE, expectedPolicyVersion);
        var role = findRole(academyId, roleId);
        var permissions = rolePermissions(roleId);
        var before = role.toView(permissions);
        if (role.getStatus() == AcademyRoleStatus.INACTIVE) {
            return new AcademyPolicyView<>(academyId, scope.getPolicyVersion(), before);
        }

        var now = Instant.now();
        role.deactivate(now);
        lockoutGuard.requireLocalAclManager(scope, actor, "DEACTIVATE_ROLE");
        var version = scope.advance(now);
        var after = role.toView(permissions);
        auditRecorder.recordInCurrentTransaction(roleEvent("ROLE_DEACTIVATED", actor, academyId, version)
                .beforeState(before)
                .afterState(after)
                .build());
        return new AcademyPolicyView<>(academyId, version, after);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public AcademyPolicyView<AcademyRoleView> replaceRolePermissions(
            AuthorizationSubject actor,
            UUID academyId,
            UUID roleId,
            Set<PermissionKey> permissionKeys,
            long expectedPolicyVersion) {
        var scope = mutationGate.open(actor, academyId, PermissionCatalog.ACCESS_ROLE_MANAGE, expectedPolicyVersion);
        var role = findRole(academyId, roleId);
        if (role.getStatus() != AcademyRoleStatus.ACTIVE) {
            throw new AccessControlConflictException("ROLE_INACTIVE", "비활성 역할은 바꿀 수 없습니다.");
        }
        RolePermissionValidator.requireKnown(permissionKeys);

        var before = rolePermissions(roleId);
        var requested = permissionKeys.stream().map(PermissionKey::value).collect(Collectors.toSet());
        if (before.equals(requested)) {
            return new AcademyPolicyView<>(academyId, scope.getPolicyVersion(), role.toView(requested));
        }

        // 전체를 지우고 다시 넣음. 지운 것이 DB에 먼저 반영돼야 같은 키를 다시 넣을 때 기본 키가 충돌하지 않음
        rolePermissionRepository.deleteAllByIdRoleId(roleId);
        entityManager.flush();
        var now = Instant.now();
        rolePermissionRepository.saveAll(requested.stream()
                .sorted()
                .map(key -> new RolePermissionEntity(roleId, key, actor.accountId(), now))
                .toList());

        lockoutGuard.requireLocalAclManager(scope, actor, "REPLACE_ROLE_PERMISSIONS");
        var version = scope.advance(now);
        auditRecorder.recordInCurrentTransaction(roleEvent("ROLE_PERMISSIONS_REPLACED", actor, academyId, version)
                .beforeState(Map.of("roleId", roleId, "permissions", new TreeSet<>(before)))
                .afterState(Map.of("roleId", roleId, "permissions", new TreeSet<>(requested)))
                .build());
        return new AcademyPolicyView<>(academyId, version, role.toView(requested));
    }

    /**
     * 학원 안에서 역할 조회
     *
     * @param academyId 학원 ID
     * @param roleId 역할 ID
     * @return 역할
     * @throws AccessControlNotFoundException 없거나 다른 학원의 역할일 때
     */
    private AcademyRoleEntity findRole(UUID academyId, UUID roleId) {
        return roleRepository.findByIdAndAcademyId(roleId, academyId)
                .orElseThrow(() -> new AccessControlNotFoundException("ROLE_NOT_FOUND", "역할을 찾을 수 없습니다."));
    }

    /**
     * 역할에 연결된 권한 키 조회
     *
     * @param roleId 역할 ID
     * @return 권한 키 집합
     */
    private Set<String> rolePermissions(UUID roleId) {
        var keys = new HashSet<String>();
        for (var entity : rolePermissionRepository.findAllByIdRoleId(roleId)) {
            keys.add(entity.getId().getPermissionKey());
        }
        return keys;
    }

    /**
     * 역할 이름 중복 예외 생성
     *
     * @return 던질 예외
     */
    private static AccessControlConflictException nameConflict() {
        return new AccessControlConflictException("ROLE_NAME_ALREADY_EXISTS", "같은 학원에 같은 이름의 역할이 있습니다.");
    }

    /**
     * 역할 변경 감사 사건의 공통 필드 채우기
     *
     * @param eventType 사건 종류. 사유 코드도 같은 값으로 채움
     * @param actor 실행한 주체
     * @param academyId 학원 ID
     * @param policyVersion 올라간 정책 버전
     * @return 나머지 필드를 채울 빌더
     */
    private static AuthorizationAuditEvent.AuthorizationAuditEventBuilder roleEvent(
            String eventType, AuthorizationSubject actor, UUID academyId, long policyVersion) {
        return AuthorizationAuditEvent.builder()
                .eventType(eventType)
                .reasonCode(eventType)
                .actorAccountId(actor.accountId())
                .academyId(academyId)
                .policyVersion(policyVersion);
    }
}
