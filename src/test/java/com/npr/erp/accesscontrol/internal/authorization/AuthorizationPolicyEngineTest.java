package com.npr.erp.accesscontrol.internal.authorization;

import static org.assertj.core.api.Assertions.assertThat;

import com.npr.erp.accesscontrol.AuthorizationReason;
import com.npr.erp.accesscontrol.AuthorizationRequest;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.AuthorizationTarget;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.PermissionDefinition;
import com.npr.erp.accesscontrol.PermissionKey;
import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.accesscontrol.ResourceContext;
import com.npr.erp.accesscontrol.ResourceType;
import com.npr.erp.accesscontrol.internal.acl.AclSubjectType;
import com.npr.erp.accesscontrol.internal.acl.ResourceAclGrant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * 순수 정책 엔진의 판단 규칙 검사
 *
 * DB 없이 권한과 ACL을 직접 만들어 넣음. 폴더 구조는 루트 → 부모 → 파일
 */
class AuthorizationPolicyEngineTest {
    /**
     * 검사 대상
     */
    private final AuthorizationPolicyEngine engine = new AuthorizationPolicyEngine();

    /**
     * 요청 계정
     */
    private final UUID accountId = uuid(1);

    /**
     * 학원
     */
    private final UUID academyId = uuid(10);

    /**
     * 요청 계정이 가진 역할
     */
    private final UUID roleId = uuid(20);

    /**
     * 루트 폴더
     */
    private final UUID rootId = uuid(100);

    /**
     * 부모 폴더
     */
    private final UUID parentId = uuid(101);

    /**
     * 파일
     */
    private final UUID fileId = uuid(102);

    /**
     * 활성 소속, 기능 권한, 파일에 직접 걸린 계정 ACL이 모두 있으면 허용하고 그 ACL을 근거로 남기는지 확인
     */
    @Test
    void allowsWhenPermissionAndDirectAccountAclExist() {
        var grant = grant(uuid(200), AclSubjectType.ACCOUNT, accountId, fileId, ResourceAction.READ, false);

        var evaluation = engine.evaluate(
                fileRead(), access(Set.of(PermissionCatalog.STORAGE_FILE_READ), Set.of()), List.of(grant));

        assertThat(evaluation.decision().allowed()).isTrue();
        assertThat(evaluation.decision().reason()).isEqualTo(AuthorizationReason.ALLOWED);
        assertThat(evaluation.matchedAclId()).isEqualTo(grant.id());
    }

    /**
     * 루트와 부모에 모두 상속 가능한 역할 ACL이 있으면 더 가까운 부모의 ACL을 근거로 고르는지 확인
     */
    @Test
    void picksNearestInheritableAncestorAcl() {
        var rootGrant = grant(uuid(200), AclSubjectType.ROLE, roleId, rootId, ResourceAction.READ, true);
        var parentGrant = grant(uuid(201), AclSubjectType.ROLE, roleId, parentId, ResourceAction.READ, true);

        var evaluation = engine.evaluate(
                fileRead(),
                access(Set.of(PermissionCatalog.STORAGE_FILE_READ), Set.of(roleId)),
                List.of(rootGrant, parentGrant));

        assertThat(evaluation.decision().allowed()).isTrue();
        assertThat(evaluation.matchedAclId()).isEqualTo(parentGrant.id());
    }

    /**
     * 부모의 ACL이 상속 불가이면 하위 파일에는 적용되지 않는지 확인
     */
    @Test
    void nonInheritableAncestorAclDoesNotApplyToChild() {
        var grant = grant(uuid(200), AclSubjectType.ROLE, roleId, parentId, ResourceAction.READ, false);

        var decision = engine.evaluate(
                        fileRead(), access(Set.of(PermissionCatalog.STORAGE_FILE_READ), Set.of(roleId)), List.of(grant))
                .decision();

        assertThat(decision.allowed()).isFalse();
        assertThat(decision.reason()).isEqualTo(AuthorizationReason.ACL_NOT_GRANTED);
    }

    /**
     * 하위 폴더에 상속이 꺼진 ACL이 있어도 루트의 상속 가능한 허용을 막지 못하는지 확인
     */
    @Test
    void closerNonInheritableAclDoesNotBlockFartherAllow() {
        var rootGrant = grant(uuid(200), AclSubjectType.ROLE, roleId, rootId, ResourceAction.READ, true);
        var parentGrant = grant(uuid(201), AclSubjectType.ROLE, roleId, parentId, ResourceAction.READ, false);

        var evaluation = engine.evaluate(
                fileRead(),
                access(Set.of(PermissionCatalog.STORAGE_FILE_READ), Set.of(roleId)),
                List.of(rootGrant, parentGrant));

        assertThat(evaluation.decision().allowed()).isTrue();
        assertThat(evaluation.matchedAclId()).isEqualTo(rootGrant.id());
    }

    /**
     * ACL만 있고 기능 권한이 없으면 거부하는지 확인. ACL만으로 새 자격을 만들 수 없음
     */
    @Test
    void aclAloneCannotReplaceMissingPermission() {
        var grant = grant(uuid(200), AclSubjectType.ACCOUNT, accountId, fileId, ResourceAction.READ, false);

        var decision = engine.evaluate(fileRead(), access(Set.of(), Set.of()), List.of(grant)).decision();

        assertThat(decision.allowed()).isFalse();
        assertThat(decision.reason()).isEqualTo(AuthorizationReason.MISSING_PERMISSION);
    }

    /**
     * 다른 사람이나 내가 갖지 않은 역할에 걸린 ACL은 내 허용 근거가 되지 않는지 확인
     */
    @Test
    void ignoresAclForOtherSubjects() {
        var otherAccount = grant(uuid(200), AclSubjectType.ACCOUNT, uuid(2), fileId, ResourceAction.READ, false);
        var otherRole = grant(uuid(201), AclSubjectType.ROLE, uuid(21), fileId, ResourceAction.READ, false);

        var decision = engine.evaluate(
                        fileRead(),
                        access(Set.of(PermissionCatalog.STORAGE_FILE_READ), Set.of(roleId)),
                        List.of(otherAccount, otherRole))
                .decision();

        assertThat(decision.reason()).isEqualTo(AuthorizationReason.ACL_NOT_GRANTED);
    }

    /**
     * 작업 사이에 포함 관계가 없어 WRITE ACL로는 READ를 허용받지 못하는지 확인
     */
    @Test
    void writeAclDoesNotImplyRead() {
        var grant = grant(uuid(200), AclSubjectType.ACCOUNT, accountId, fileId, ResourceAction.WRITE, false);

        var decision = engine.evaluate(
                        fileRead(), access(Set.of(PermissionCatalog.STORAGE_FILE_READ), Set.of()), List.of(grant))
                .decision();

        assertThat(decision.reason()).isEqualTo(AuthorizationReason.ACL_NOT_GRANTED);
    }

    /**
     * 소속이 끝났으면 권한이 남아 있어도 ACL을 보기 전에 거부하는지 확인
     */
    @Test
    void deniesInactiveMembershipBeforeOtherChecks() {
        var request = new AuthorizationRequest(
                new AuthorizationSubject(accountId),
                PermissionCatalog.ACCESS_ROLE_READ.key(),
                new AuthorizationTarget.Academy(academyId));
        var inactive = new EffectiveAccess(null, false, Set.of(PermissionCatalog.ACCESS_ROLE_READ.key()), Set.of());

        var decision = engine.evaluate(request, inactive, List.of()).decision();

        assertThat(decision.reason()).isEqualTo(AuthorizationReason.MEMBERSHIP_INACTIVE);
    }

    /**
     * 다른 학원에서 읽은 권한으로는 이 학원의 요청을 허용받지 못하는지 확인
     */
    @Test
    void deniesWhenAccessBelongsToAnotherAcademy() {
        var request = new AuthorizationRequest(
                new AuthorizationSubject(accountId),
                PermissionCatalog.ACCESS_ROLE_READ.key(),
                new AuthorizationTarget.Academy(academyId));
        var otherAcademy =
                new EffectiveAccess(uuid(11), true, Set.of(PermissionCatalog.ACCESS_ROLE_READ.key()), Set.of());

        var decision = engine.evaluate(request, otherAcademy, List.of()).decision();

        assertThat(decision.reason()).isEqualTo(AuthorizationReason.ACADEMY_SCOPE_MISMATCH);
    }

    /**
     * 코드에 없는 권한 키는 거부하는지 확인
     */
    @Test
    void deniesUnknownPermission() {
        var request = new AuthorizationRequest(
                new AuthorizationSubject(accountId),
                new PermissionKey("unknown.feature.read"),
                new AuthorizationTarget.Academy(academyId));

        var decision = engine.evaluate(request, access(Set.of(), Set.of()), List.of()).decision();

        assertThat(decision.reason()).isEqualTo(AuthorizationReason.UNKNOWN_PERMISSION);
    }

    /**
     * 학원 권한을 리소스에, 리소스 권한을 학원에, 리소스 권한을 다른 작업에 쓰면 모두 거부하는지 확인
     */
    @Test
    void deniesPermissionTargetMismatch() {
        var subject = new AuthorizationSubject(accountId);
        var access = access(
                Set.of(PermissionCatalog.ACCESS_ROLE_READ, PermissionCatalog.STORAGE_FILE_READ), Set.of());
        var academyPermissionOnResource = new AuthorizationRequest(
                subject,
                PermissionCatalog.ACCESS_ROLE_READ.key(),
                new AuthorizationTarget.Resource(fileContext(), ResourceAction.READ));
        var resourcePermissionOnAcademy = new AuthorizationRequest(
                subject, PermissionCatalog.STORAGE_FILE_READ.key(), new AuthorizationTarget.Academy(academyId));
        var wrongAction = new AuthorizationRequest(
                subject,
                PermissionCatalog.STORAGE_FILE_READ.key(),
                new AuthorizationTarget.Resource(fileContext(), ResourceAction.WRITE));

        for (var request : List.of(academyPermissionOnResource, resourcePermissionOnAcademy, wrongAction)) {
            assertThat(engine.evaluate(request, access, List.of()).decision().reason())
                    .isEqualTo(AuthorizationReason.PERMISSION_TARGET_MISMATCH);
        }
    }

    /**
     * 목록 필터가 ACL이 맞는 항목만 남기는지 확인
     */
    @Test
    void filtersListByAcl() {
        var visibleId = uuid(300);
        var hiddenId = uuid(301);
        var contexts = List.of(
                new ResourceContext(academyId, ResourceType.STORAGE_NODE, visibleId, List.of(rootId)),
                new ResourceContext(academyId, ResourceType.STORAGE_NODE, hiddenId, List.of(rootId)));
        var grant = grant(uuid(200), AclSubjectType.ACCOUNT, accountId, visibleId, ResourceAction.LIST, false);

        var permitted = engine.filterPermitted(
                new AuthorizationSubject(accountId),
                PermissionCatalog.STORAGE_FOLDER_LIST.key(),
                ResourceAction.LIST,
                contexts,
                access(Set.of(PermissionCatalog.STORAGE_FOLDER_LIST), Set.of()),
                List.of(grant));

        assertThat(permitted).containsExactly(visibleId);
    }

    /**
     * 파일 읽기 요청 생성
     *
     * @return 요청 계정이 파일을 READ하려는 요청
     */
    private AuthorizationRequest fileRead() {
        return new AuthorizationRequest(
                new AuthorizationSubject(accountId),
                PermissionCatalog.STORAGE_FILE_READ.key(),
                new AuthorizationTarget.Resource(fileContext(), ResourceAction.READ));
    }

    /**
     * 루트 → 부모 아래에 있는 파일의 문맥 생성
     *
     * @return 파일 문맥
     */
    private ResourceContext fileContext() {
        return new ResourceContext(academyId, ResourceType.STORAGE_NODE, fileId, List.of(rootId, parentId));
    }

    /**
     * 이 학원에 활성 소속이 있는 권한 상태 생성
     *
     * @param permissions 가진 권한
     * @param roleIds 가진 역할
     * @return 권한 상태
     */
    private EffectiveAccess access(Set<PermissionDefinition> permissions, Set<UUID> roleIds) {
        var keys = permissions.stream().map(PermissionDefinition::key).collect(Collectors.toSet());
        return new EffectiveAccess(academyId, true, keys, roleIds);
    }

    /**
     * 이 학원의 저장소 노드에 걸린 ACL 후보 생성
     *
     * @param id ACL ID
     * @param subjectType 주체 종류
     * @param subjectId 주체 ID
     * @param resourceId ACL이 걸린 리소스
     * @param action 허용 작업
     * @param inherit 상속 여부
     * @return ACL 후보
     */
    private ResourceAclGrant grant(
            UUID id, AclSubjectType subjectType, UUID subjectId, UUID resourceId, ResourceAction action,
            boolean inherit) {
        return new ResourceAclGrant(
                id, academyId, ResourceType.STORAGE_NODE, resourceId, subjectType, subjectId, action, inherit);
    }

    /**
     * 읽기 쉬운 고정 UUID 생성
     *
     * @param value 구분 번호
     * @return 번호를 하위 비트에 넣은 UUID
     */
    private static UUID uuid(long value) {
        return new UUID(0, value);
    }
}
