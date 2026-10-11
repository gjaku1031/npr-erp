package com.npr.erp.integration.accesscontrol;

import static com.npr.generated.jooq.Tables.AUTHORIZATION_AUDIT_LOG;
import static com.npr.generated.jooq.Tables.PERMISSION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.npr.erp.accesscontrol.AccessControlConflictException;
import com.npr.erp.accesscontrol.AccessControlNotFoundException;
import com.npr.erp.accesscontrol.AuthorizationReason;
import com.npr.erp.accesscontrol.AuthorizationRequest;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.AuthorizationTarget;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.PermissionKey;
import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.integration.IntegrationTest;
import java.util.List;
import java.util.UUID;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.Test;

/**
 * 실제 DB의 소속·역할·권한·ACL로 내리는 인가 판단 검사
 */
@IntegrationTest
class AuthorizationBehaviorIntegrationTest extends AccessControlIntegrationSupport {
    /**
     * 역할 이름을 바꿔도 권한과 ACL 연결이 유지돼 인가 결과가 같은지 확인
     */
    @Test
    void renamingRoleKeepsPermissionsAndAcls() {
        var setup = initializedAcademy("역할 이름 변경");
        var file = childOfRoot(setup);
        assertThat(authorizeFileRead(setup.adminAccountId(), file).allowed()).isTrue();

        var renamed = roleAdministration.renameRole(
                new AuthorizationSubject(setup.adminAccountId()),
                setup.academyId(),
                setup.roleId(),
                "  변경된   운영 관리자  ",
                1);

        assertThat(renamed.value().name()).isEqualTo("변경된 운영 관리자");
        assertThat(renamed.policyVersion()).isEqualTo(2);
        assertThat(authorizeFileRead(setup.adminAccountId(), file).allowed()).isTrue();
    }

    /**
     * 역할에서 권한을 빼면 바로 다음 요청부터 거부되는지 확인. 세션에 권한 사본을 두지 않기 때문임
     */
    @Test
    void permissionRevocationAppliesToNextRequest() {
        var setup = initializedAcademy("즉시 회수");
        var file = childOfRoot(setup);
        assertThat(authorizeFileRead(setup.adminAccountId(), file).allowed()).isTrue();

        var updated = roleAdministration.replaceRolePermissions(
                new AuthorizationSubject(setup.adminAccountId()),
                setup.academyId(),
                setup.roleId(),
                allPermissionsExcept(PermissionCatalog.STORAGE_FILE_READ),
                1);

        assertThat(updated.policyVersion()).isEqualTo(2);
        var after = authorizeFileRead(setup.adminAccountId(), file);
        assertThat(after.allowed()).isFalse();
        assertThat(after.reason()).isEqualTo(AuthorizationReason.MISSING_PERMISSION);
    }

    /**
     * 읽었던 정책 버전이 지난 뒤의 변경 요청은 거부되는지 확인
     */
    @Test
    void staleExpectedVersionIsRejected() {
        var setup = initializedAcademy("버전 충돌");
        var admin = new AuthorizationSubject(setup.adminAccountId());
        roleAdministration.createRole(admin, setup.academyId(), "첫 변경", 1);

        assertThatThrownBy(() -> roleAdministration.createRole(admin, setup.academyId(), "뒤늦은 변경", 1))
                .isInstanceOfSatisfying(
                        AccessControlConflictException.class,
                        failure -> assertThat(failure.getCode()).isEqualTo("POLICY_VERSION_MISMATCH"));
    }

    /**
     * 초기화되지 않은 학원의 기능 권한 요약은 정책이 있는 것처럼 돌려주지 않는지 확인
     */
    @Test
    void capabilitiesOfUninitializedAcademyAreNotFound() {
        var superuser = new AuthorizationSubject(superuserAccountId());

        assertThatThrownBy(() -> capabilityReader.capabilities(superuser, UUID.randomUUID()))
                .isInstanceOfSatisfying(AccessControlNotFoundException.class, failure -> assertThat(failure.getCode())
                        .isEqualTo("ACADEMY_ACCESS_NOT_INITIALIZED"));
    }

    /**
     * 목록 필터가 여러 리소스를 한 번에 판단하고, 루트의 상속 가능한 ACL로 모두 허용하는지 확인
     */
    @Test
    void filterPermittedEvaluatesManyResourcesAtOnce() {
        var setup = initializedAcademy("목록 인가");
        var contexts = List.of(childOfRoot(setup), childOfRoot(setup), childOfRoot(setup));

        var permitted = authorizer.filterPermitted(
                new AuthorizationSubject(setup.adminAccountId()),
                PermissionCatalog.STORAGE_FOLDER_LIST.key(),
                ResourceAction.LIST,
                contexts,
                null);

        assertThat(permitted).containsExactlyInAnyOrderElementsOf(
                contexts.stream().map(context -> context.resourceId()).toList());
    }

    /**
     * 다른 학원의 리소스를 섞은 목록 인가 요청은 잘못된 호출로 거부하는지 확인
     */
    @Test
    void filterPermittedRejectsMixedAcademies() {
        var first = initializedAcademy("혼합 A");
        var second = initializedAcademy("혼합 B");

        assertThatThrownBy(() -> authorizer.filterPermitted(
                        new AuthorizationSubject(first.adminAccountId()),
                        PermissionCatalog.STORAGE_FOLDER_LIST.key(),
                        ResourceAction.LIST,
                        List.of(childOfRoot(first), childOfRoot(second)),
                        null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    /**
     * 슈퍼유저도 정의되지 않은 권한이나 대상·작업이 맞지 않는 요청으로는 허용받지 못하는지 확인
     */
    @Test
    void superuserCannotBypassPermissionContract() {
        var setup = initializedAcademy("슈퍼유저 계약");
        var superuser = new AuthorizationSubject(superuserAccountId());

        var unknown = authorizer.authorize(new AuthorizationRequest(
                superuser, new PermissionKey("unknown.feature.read"), new AuthorizationTarget.Academy(setup.academyId())));
        var academyPermissionOnResource = authorizer.authorize(new AuthorizationRequest(
                superuser,
                PermissionCatalog.ACCESS_ROLE_READ.key(),
                new AuthorizationTarget.Resource(root(setup), ResourceAction.READ)));
        var wrongAction = authorizer.authorize(new AuthorizationRequest(
                superuser,
                PermissionCatalog.STORAGE_FILE_READ.key(),
                new AuthorizationTarget.Resource(root(setup), ResourceAction.WRITE)));

        assertThat(unknown.reason()).isEqualTo(AuthorizationReason.UNKNOWN_PERMISSION);
        assertThat(academyPermissionOnResource.reason()).isEqualTo(AuthorizationReason.PERMISSION_TARGET_MISMATCH);
        assertThat(wrongAction.reason()).isEqualTo(AuthorizationReason.PERMISSION_TARGET_MISMATCH);
    }

    /**
     * 슈퍼유저의 정상 요청은 우회 사유로 허용되고 감사 기록이 남는지 확인
     */
    @Test
    void superuserBypassIsAllowedAndAudited() {
        var setup = initializedAcademy("슈퍼유저 우회");
        var requestId = UUID.randomUUID().toString();

        var decision = authorizer.authorize(new AuthorizationRequest(
                new AuthorizationSubject(superuserAccountId()),
                PermissionCatalog.ACCESS_ROLE_READ.key(),
                new AuthorizationTarget.Academy(setup.academyId()),
                requestId));

        assertThat(decision.allowed()).isTrue();
        assertThat(decision.reason()).isEqualTo(AuthorizationReason.SUPERUSER_BYPASS);
        assertThat(dsl.fetchCount(AUTHORIZATION_AUDIT_LOG, AUTHORIZATION_AUDIT_LOG.REQUEST_ID.eq(requestId)))
                .isEqualTo(1);
    }

    /**
     * 정책 변경 감사의 상태 값이 JSON 문자열이 아니라 JSON 객체로 저장되는지 확인
     */
    @Test
    void auditStateIsStoredAsJsonObject() {
        var setup = initializedAcademy("감사 JSON");
        var jsonType = DSL.field("jsonb_typeof({0})", String.class, AUTHORIZATION_AUDIT_LOG.AFTER_STATE);

        var type = dsl.select(jsonType)
                .from(AUTHORIZATION_AUDIT_LOG)
                .where(AUTHORIZATION_AUDIT_LOG.ACADEMY_ID.eq(setup.academyId())
                        .and(AUTHORIZATION_AUDIT_LOG.EVENT_TYPE.eq("ACADEMY_ACCESS_INITIALIZED")))
                .fetchOne(jsonType);

        assertThat(type).isEqualTo("object");
    }

    /**
     * 코드의 권한 목록과 DB의 권한 표가 같은 키를 가지는지 확인. 어긋나면 역할에 권한을 넣을 때 외래 키가 깨짐
     */
    @Test
    void databasePermissionRowsMatchCatalog() {
        var databaseKeys = dsl.select(PERMISSION.PERMISSION_KEY).from(PERMISSION).fetch(PERMISSION.PERMISSION_KEY);
        var catalogKeys = PermissionCatalog.definitions().stream().map(definition -> definition.key().value()).toList();

        assertThat(databaseKeys).containsExactlyInAnyOrderElementsOf(catalogKeys);
    }
}
