package com.npr.erp.integration.accesscontrol;

import static com.npr.generated.jooq.Tables.AUTHORIZATION_AUDIT_LOG;
import static com.npr.generated.jooq.Tables.PLATFORM_SUPERUSER;
import static com.npr.generated.jooq.Tables.STAFF_MEMBERSHIP;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.npr.erp.accesscontrol.AccessControlConflictException;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.InitializeAcademyAccessCommand;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.integration.IntegrationTest;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.Test;

/**
 * 마지막 관리자 보호와 동시 변경 검사
 */
@IntegrationTest
class AccessControlLockoutIntegrationTest extends AccessControlIntegrationSupport {
    /**
     * 유일한 관리자 역할에서 ACL 관리 권한을 빼는 변경은 롤백되고, 거부 사실만 감사 기록에 남는지 확인
     */
    @Test
    void removingLastAclManagerIsRolledBackAndAudited() {
        var setup = initializedAcademy("잠금 방지");
        var admin = new AuthorizationSubject(setup.adminAccountId());

        assertThatThrownBy(() -> roleAdministration.replaceRolePermissions(
                        admin,
                        setup.academyId(),
                        setup.roleId(),
                        allPermissionsExcept(PermissionCatalog.STORAGE_ACL_MANAGE),
                        1))
                .isInstanceOfSatisfying(AccessControlConflictException.class, failure -> assertThat(failure.getCode())
                        .isEqualTo("LAST_ACL_MANAGER_REMOVAL"));

        var capabilities = capabilityReader.capabilities(admin, setup.academyId());
        assertThat(capabilities.policyVersion()).isEqualTo(1);
        assertThat(capabilities.has(PermissionCatalog.STORAGE_ACL_MANAGE)).isTrue();
        assertThat(dsl.fetchCount(
                        AUTHORIZATION_AUDIT_LOG,
                        AUTHORIZATION_AUDIT_LOG.ACADEMY_ID.eq(setup.academyId())
                                .and(AUTHORIZATION_AUDIT_LOG.EVENT_TYPE.eq("LOCKOUT_CHANGE_DENIED"))))
                .isEqualTo(1);
    }

    /**
     * 관리자 둘이 같은 정책 버전을 보고 서로의 소속을 동시에 끝내려 하면 한 건만 성공해 관리자가 남는지 확인
     */
    @Test
    void concurrentEndsWithSameVersionLeaveOneManager() throws Exception {
        var setup = initializedAcademy("동시 종료");
        var superuser = new AuthorizationSubject(superuserAccountId());
        var secondAdminId = createAccount("second-admin-" + UUID.randomUUID());
        var second = membershipAdministration.createMembership(superuser, setup.academyId(), secondAdminId, 1);
        roleAssignmentAdministration.replaceMembershipRoles(
                superuser, setup.academyId(), second.value().id(), Set.of(setup.roleId()), 2);

        var failures = runConcurrently(List.of(
                () -> membershipAdministration.endMembership(superuser, setup.academyId(), setup.membershipId(), 3),
                () -> membershipAdministration.endMembership(superuser, setup.academyId(), second.value().id(), 3)));

        assertThat(failures).hasSize(1);
        assertThat(failures.getFirst()).isInstanceOf(AccessControlConflictException.class);
        assertThat(dsl.fetchCount(
                        STAFF_MEMBERSHIP,
                        STAFF_MEMBERSHIP.ACADEMY_ID.eq(setup.academyId()).and(STAFF_MEMBERSHIP.STATUS.eq("ACTIVE"))))
                .isEqualTo(1);
    }

    /**
     * 같은 학원을 동시에 초기화하면 한 건만 성공하는지 확인
     */
    @Test
    void concurrentInitializationSucceedsOnce() throws Exception {
        var command = new InitializeAcademyAccessCommand(
                new AuthorizationSubject(superuserAccountId()),
                UUID.randomUUID(),
                UUID.randomUUID(),
                createAccount("concurrent-initializer-" + UUID.randomUUID()),
                "동시 초기 관리자",
                allPermissions(),
                null);

        var failures = runConcurrently(
                List.of(() -> initializer.initialize(command), () -> initializer.initialize(command)));

        assertThat(failures).hasSize(1);
        assertThat(failures.getFirst())
                .isInstanceOfSatisfying(AccessControlConflictException.class, failure -> assertThat(failure.getCode())
                        .isEqualTo("ACADEMY_ACCESS_ALREADY_INITIALIZED"));
    }

    /**
     * 슈퍼유저가 하나도 없을 때 두 계정이 동시에 첫 슈퍼유저가 되려 하면 한 명만 되는지 확인
     */
    @Test
    void concurrentFirstSuperuserGrantSucceedsOnce() throws Exception {
        var first = createAccount("first-superuser-" + UUID.randomUUID());
        var second = createAccount("second-superuser-" + UUID.randomUUID());
        dsl.deleteFrom(PLATFORM_SUPERUSER).execute();

        var failures = runConcurrently(List.of(
                () -> superuserManagement.grant(first, null, "동시 첫 슈퍼유저 검사"),
                () -> superuserManagement.grant(second, null, "동시 첫 슈퍼유저 검사")));

        assertThat(failures).hasSize(1);
        assertThat(failures.getFirst()).isInstanceOf(AccessControlConflictException.class);
        assertThat(dsl.fetchCount(PLATFORM_SUPERUSER)).isEqualTo(1);

        // 다른 테스트가 고정 슈퍼유저를 쓸 수 있게 되돌림
        dsl.deleteFrom(PLATFORM_SUPERUSER).execute();
    }

    /**
     * 이미 슈퍼유저가 있으면 실행자 없는 부여는 대상이 이미 슈퍼유저여도 거부되는지 확인
     */
    @Test
    void grantWithoutActorIsRejectedOnceSuperuserExists() {
        var superuserId = superuserAccountId();

        assertThatThrownBy(() -> superuserManagement.grant(superuserId, null, "실행자 없는 재부여"))
                .isInstanceOfSatisfying(AccessControlConflictException.class, failure -> assertThat(failure.getCode())
                        .isEqualTo("SUPERUSER_ACTOR_REQUIRED"));
    }

    /**
     * 여러 작업을 같은 순간에 시작시키고 실패한 작업의 예외를 모음
     *
     * @param tasks 동시에 실행할 작업
     * @return 실패한 작업이 던진 예외
     * @throws Exception 스레드 대기가 중단됐을 때
     */
    private static List<Throwable> runConcurrently(List<Callable<?>> tasks) throws Exception {
        var start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(tasks.size())) {
            var futures = new ArrayList<Future<Throwable>>();
            for (var task : tasks) {
                futures.add(pool.submit(() -> {
                    start.await();
                    try {
                        task.call();
                        return null;
                    } catch (Throwable failure) {
                        return failure;
                    }
                }));
            }
            start.countDown();

            var failures = new ArrayList<Throwable>();
            for (var future : futures) {
                var failure = future.get();
                if (failure != null) {
                    failures.add(failure);
                }
            }
            return failures;
        }
    }
}
