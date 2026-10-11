package com.npr.erp.integration.accesscontrol;

import static com.npr.generated.jooq.Tables.RESOURCE_ACL;
import static com.npr.generated.jooq.Tables.ROLE_ASSIGNMENT;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.npr.erp.integration.IntegrationTest;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * 애플리케이션 코드를 거치지 않고 넣은 잘못된 권한 데이터를 DB 제약이 막는지 검사
 */
@IntegrationTest
class AccessControlConstraintIntegrationTest extends AccessControlIntegrationSupport {
    /**
     * 같은 소속·역할의 유효한 배정을 두 번 넣을 수 없는지 확인
     */
    @Test
    void duplicateActiveAssignmentIsRejected() {
        var setup = initializedAcademy("중복 배정");

        assertThatThrownBy(() -> dsl.insertInto(ROLE_ASSIGNMENT)
                        .set(ROLE_ASSIGNMENT.ID, UUID.randomUUID())
                        .set(ROLE_ASSIGNMENT.ACADEMY_ID, setup.academyId())
                        .set(ROLE_ASSIGNMENT.STAFF_MEMBERSHIP_ID, setup.membershipId())
                        .set(ROLE_ASSIGNMENT.ROLE_ID, setup.roleId())
                        .set(ROLE_ASSIGNMENT.ASSIGNED_BY, setup.adminAccountId())
                        .set(ROLE_ASSIGNMENT.ASSIGNED_AT, OffsetDateTime.now())
                        .execute())
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * 다른 학원의 역할을 이 학원의 소속에 배정할 수 없는지 확인. 복합 외래 키가 막음
     */
    @Test
    void assignmentAcrossAcademiesIsRejected() {
        var first = initializedAcademy("교차 A");
        var second = initializedAcademy("교차 B");

        assertThatThrownBy(() -> dsl.insertInto(ROLE_ASSIGNMENT)
                        .set(ROLE_ASSIGNMENT.ID, UUID.randomUUID())
                        .set(ROLE_ASSIGNMENT.ACADEMY_ID, second.academyId())
                        .set(ROLE_ASSIGNMENT.STAFF_MEMBERSHIP_ID, second.membershipId())
                        .set(ROLE_ASSIGNMENT.ROLE_ID, first.roleId())
                        .set(ROLE_ASSIGNMENT.ASSIGNED_BY, second.adminAccountId())
                        .set(ROLE_ASSIGNMENT.ASSIGNED_AT, OffsetDateTime.now())
                        .execute())
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * 주체가 없는 ACL은 넣을 수 없는지 확인
     */
    @Test
    void aclWithoutSubjectIsRejected() {
        var setup = initializedAcademy("주체 없는 ACL");
        var now = OffsetDateTime.now();

        assertThatThrownBy(() -> dsl.insertInto(RESOURCE_ACL)
                        .set(RESOURCE_ACL.ID, UUID.randomUUID())
                        .set(RESOURCE_ACL.ACADEMY_ID, setup.academyId())
                        .set(RESOURCE_ACL.RESOURCE_TYPE, "STORAGE_NODE")
                        .set(RESOURCE_ACL.RESOURCE_ID, UUID.randomUUID())
                        .set(RESOURCE_ACL.ACTION, "READ")
                        .set(RESOURCE_ACL.INHERIT_TO_CHILDREN, false)
                        .set(RESOURCE_ACL.CREATED_BY, setup.adminAccountId())
                        .set(RESOURCE_ACL.CREATED_AT, now)
                        .set(RESOURCE_ACL.UPDATED_AT, now)
                        .execute())
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    /**
     * 같은 리소스·역할·작업의 ACL을 두 번 넣을 수 없는지 확인. 초기화가 이미 루트에 넣은 것과 겹침
     */
    @Test
    void duplicateRoleAclIsRejected() {
        var setup = initializedAcademy("중복 ACL");
        var now = OffsetDateTime.now();

        assertThatThrownBy(() -> dsl.insertInto(RESOURCE_ACL)
                        .set(RESOURCE_ACL.ID, UUID.randomUUID())
                        .set(RESOURCE_ACL.ACADEMY_ID, setup.academyId())
                        .set(RESOURCE_ACL.RESOURCE_TYPE, "STORAGE_NODE")
                        .set(RESOURCE_ACL.RESOURCE_ID, setup.rootResourceId())
                        .set(RESOURCE_ACL.SUBJECT_ROLE_ID, setup.roleId())
                        .set(RESOURCE_ACL.ACTION, "MANAGE_ACL")
                        .set(RESOURCE_ACL.INHERIT_TO_CHILDREN, true)
                        .set(RESOURCE_ACL.CREATED_BY, setup.adminAccountId())
                        .set(RESOURCE_ACL.CREATED_AT, now)
                        .set(RESOURCE_ACL.UPDATED_AT, now)
                        .execute())
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
