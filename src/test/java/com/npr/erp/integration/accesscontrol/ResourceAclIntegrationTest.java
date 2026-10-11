package com.npr.erp.integration.accesscontrol;

import static com.npr.generated.jooq.Tables.RESOURCE_ACL;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.npr.erp.accesscontrol.AccessControlConflictException;
import com.npr.erp.accesscontrol.AccessControlValidationException;
import com.npr.erp.accesscontrol.AuthorizationReason;
import com.npr.erp.accesscontrol.AuthorizationRequest;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.AuthorizationTarget;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.ResourceAclSubject;
import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.integration.IntegrationTest;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * ACL 부여·회수·생명주기 정리 검사
 */
@IntegrationTest
class ResourceAclIntegrationTest extends AccessControlIntegrationSupport {
    /**
     * 파일 읽기 권한만 가진 직원이 계정 ACL을 받으면 읽을 수 있고, 회수하면 바로 거부되는지 확인
     */
    @Test
    void accountAclGrantAndRevokeTakeEffectImmediately() {
        var setup = initializedAcademy("계정 ACL");
        var superuser = new AuthorizationSubject(superuserAccountId());
        var userId = createAccount("acl-user-" + UUID.randomUUID());
        var membership = membershipAdministration.createMembership(superuser, setup.academyId(), userId, 1);
        var role = roleAdministration.createRole(superuser, setup.academyId(), "파일 열람", 2);
        roleAdministration.replaceRolePermissions(
                superuser,
                setup.academyId(),
                role.value().id(),
                Set.of(PermissionCatalog.STORAGE_FILE_READ.key()),
                3);
        roleAssignmentAdministration.replaceMembershipRoles(
                superuser, setup.academyId(), membership.value().id(), Set.of(role.value().id()), 4);
        var file = childOfRoot(setup);

        // 권한은 있지만 ACL이 없어 거부
        assertThat(authorizeFileRead(userId, file).reason()).isEqualTo(AuthorizationReason.ACL_NOT_GRANTED);

        var acl = aclManagement.grant(
                superuser, root(setup), new ResourceAclSubject.Account(userId), ResourceAction.READ, true, 5);
        assertThat(authorizeFileRead(userId, file).allowed()).isTrue();

        aclManagement.revoke(superuser, root(setup), acl.value().id(), 6);
        assertThat(authorizeFileRead(userId, file).reason()).isEqualTo(AuthorizationReason.ACL_NOT_GRANTED);
    }

    /**
     * 같은 주체·작업을 같은 설정으로 다시 부여하면 정책 버전이 오르지 않고, 상속 설정만 바꾸면 오르는지 확인
     */
    @Test
    void regrantingSameAclDoesNotAdvanceVersion() {
        var setup = initializedAcademy("ACL 재부여");
        var superuser = new AuthorizationSubject(superuserAccountId());
        var folder = childOfRoot(setup);
        var subject = new ResourceAclSubject.Role(setup.roleId());

        var first = aclManagement.grant(superuser, folder, subject, ResourceAction.READ, false, 1);
        var same = aclManagement.grant(superuser, folder, subject, ResourceAction.READ, false, 2);
        var changed = aclManagement.grant(superuser, folder, subject, ResourceAction.READ, true, 2);

        assertThat(first.policyVersion()).isEqualTo(2);
        assertThat(same.policyVersion()).isEqualTo(2);
        assertThat(changed.policyVersion()).isEqualTo(3);
        assertThat(changed.value().id()).isEqualTo(first.value().id());
        assertThat(changed.value().inheritToChildren()).isTrue();
    }

    /**
     * 학원에 소속되지 않은 계정에게는 ACL을 줄 수 없는지 확인
     */
    @Test
    void cannotGrantAclToAccountWithoutMembership() {
        var setup = initializedAcademy("ACL 주체 검증");
        var superuser = new AuthorizationSubject(superuserAccountId());
        var outsiderId = createAccount("acl-outsider-" + UUID.randomUUID());

        assertThatThrownBy(() -> aclManagement.grant(
                        superuser,
                        root(setup),
                        new ResourceAclSubject.Account(outsiderId),
                        ResourceAction.READ,
                        true,
                        1))
                .isInstanceOfSatisfying(AccessControlValidationException.class, failure -> assertThat(failure.getCode())
                        .isEqualTo("ACL_ACCOUNT_MEMBERSHIP_REQUIRED"));
    }

    /**
     * 리소스 정리는 ACL 관리 권한 없이도 그 리소스의 ACL을 모두 지우고, 루트는 지우지 못하는지 확인
     */
    @Test
    void lifecycleCleanupRemovesDirectAclsButProtectsRoot() {
        var setup = initializedAcademy("ACL 정리");
        var superuser = new AuthorizationSubject(superuserAccountId());
        var cleaner = new AuthorizationSubject(createAccount("acl-cleaner-" + UUID.randomUUID()));
        var folder = childOfRoot(setup);
        aclManagement.grant(
                superuser, folder, new ResourceAclSubject.Role(setup.roleId()), ResourceAction.READ, false, 1);

        var cleaned = aclLifecycle.revokeAll(cleaner, folder);

        assertThat(cleaned.policyVersion()).isEqualTo(3);
        assertThat(dsl.fetchCount(RESOURCE_ACL, RESOURCE_ACL.RESOURCE_ID.eq(folder.resourceId()))).isZero();
        assertThatThrownBy(() -> aclLifecycle.revokeAll(cleaner, root(setup)))
                .isInstanceOfSatisfying(AccessControlConflictException.class, failure -> assertThat(failure.getCode())
                        .isEqualTo("ROOT_ACL_LIFECYCLE_REVOKE_FORBIDDEN"));
    }

    /**
     * 권한을 주는 역할과 루트 ACL을 주는 역할이 달라도 둘 다 가진 사람은 ACL 관리자로 인정되는지 확인
     *
     * 그런 사람이 있으면 기존 관리자의 소속을 끝내도 마지막 관리자 보호에 걸리지 않음
     */
    @Test
    void permissionRoleAndAclRoleCanDifferForAclManager() {
        var setup = initializedAcademy("역할 분리");
        var superuser = new AuthorizationSubject(superuserAccountId());
        var secondAdminId = createAccount("split-role-admin-" + UUID.randomUUID());
        var membership = membershipAdministration.createMembership(superuser, setup.academyId(), secondAdminId, 1);
        var permissionRole = roleAdministration.createRole(superuser, setup.academyId(), "ACL 기능 역할", 2);
        roleAdministration.replaceRolePermissions(
                superuser,
                setup.academyId(),
                permissionRole.value().id(),
                Set.of(PermissionCatalog.STORAGE_ACL_MANAGE.key()),
                3);
        var aclRole = roleAdministration.createRole(superuser, setup.academyId(), "루트 ACL 역할", 4);
        roleAssignmentAdministration.replaceMembershipRoles(
                superuser,
                setup.academyId(),
                membership.value().id(),
                Set.of(permissionRole.value().id(), aclRole.value().id()),
                5);
        aclManagement.grant(
                superuser,
                root(setup),
                new ResourceAclSubject.Role(aclRole.value().id()),
                ResourceAction.MANAGE_ACL,
                true,
                6);

        membershipAdministration.endMembership(superuser, setup.academyId(), setup.membershipId(), 7);

        var decision = authorizer.authorize(new AuthorizationRequest(
                new AuthorizationSubject(secondAdminId),
                PermissionCatalog.STORAGE_ACL_MANAGE.key(),
                new AuthorizationTarget.Resource(root(setup), ResourceAction.MANAGE_ACL)));
        assertThat(decision.allowed()).isTrue();
    }
}
