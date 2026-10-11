package com.npr.erp.accesscontrol.internal.scope;

import static com.npr.generated.jooq.Tables.ACADEMY_ROLE;
import static com.npr.generated.jooq.Tables.RESOURCE_ACL;
import static com.npr.generated.jooq.Tables.ROLE_ASSIGNMENT;
import static com.npr.generated.jooq.Tables.ROLE_PERMISSION;
import static com.npr.generated.jooq.Tables.STAFF_MEMBERSHIP;

import com.npr.erp.accesscontrol.PermissionCatalog;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 학원에 ACL을 관리할 수 있는 사람이 남아 있는지 확인하는 조회
 */
@Repository
@RequiredArgsConstructor
public class LockoutGuardQuery {
    /**
     * jOOQ 실행 문맥
     */
    private final DSLContext dsl;

    /**
     * 유효한 루트 ACL 관리자가 한 명이라도 있는지 확인
     *
     * 활성 소속이면서 (1) 유효한 역할로 {@code storage.acl.manage} 권한을 가지고 (2) 루트 폴더의 MANAGE_ACL 허용을
     * 계정으로 직접 받았거나 유효한 역할로 받은 사람을 찾음. 권한을 주는 역할과 ACL을 주는 역할은 달라도 됨.
     * 플랫폼 슈퍼유저는 세지 않음
     *
     * @param academyId 학원 ID
     * @param rootResourceId 학원 저장소 루트 폴더 ID
     * @return 한 명이라도 있으면 true
     */
    public boolean hasEffectiveRootAclManager(UUID academyId, UUID rootResourceId) {
        var membership = STAFF_MEMBERSHIP.as("membership");
        var permissionAssignment = ROLE_ASSIGNMENT.as("permission_assignment");
        var permissionRole = ACADEMY_ROLE.as("permission_role");
        var requiredPermission = ROLE_PERMISSION.as("required_permission");
        var rootAcl = RESOURCE_ACL.as("root_acl");
        var aclAssignment = ROLE_ASSIGNMENT.as("acl_assignment");
        var aclRole = ACADEMY_ROLE.as("acl_role");

        // (1) 회수되지 않은 배정 → 활성 역할 → ACL 관리 권한
        var hasManagePermission = DSL.exists(DSL.selectOne()
                .from(permissionAssignment)
                .join(permissionRole)
                .on(permissionRole.ID.eq(permissionAssignment.ROLE_ID)
                        .and(permissionRole.ACADEMY_ID.eq(permissionAssignment.ACADEMY_ID))
                        .and(permissionRole.STATUS.eq("ACTIVE")))
                .join(requiredPermission)
                .on(requiredPermission.ROLE_ID.eq(permissionRole.ID)
                        .and(requiredPermission.PERMISSION_KEY.eq(
                                PermissionCatalog.STORAGE_ACL_MANAGE.key().value())))
                .where(permissionAssignment.STAFF_MEMBERSHIP_ID.eq(membership.ID)
                        .and(permissionAssignment.ACADEMY_ID.eq(membership.ACADEMY_ID))
                        .and(permissionAssignment.REVOKED_AT.isNull())));

        // (2-b) 루트 ACL의 주체 역할을 유효하게 가지고 있는가
        var hasAclRole = DSL.exists(DSL.selectOne()
                .from(aclAssignment)
                .join(aclRole)
                .on(aclRole.ID.eq(aclAssignment.ROLE_ID)
                        .and(aclRole.ACADEMY_ID.eq(aclAssignment.ACADEMY_ID))
                        .and(aclRole.STATUS.eq("ACTIVE")))
                .where(aclAssignment.STAFF_MEMBERSHIP_ID.eq(membership.ID)
                        .and(aclAssignment.ACADEMY_ID.eq(membership.ACADEMY_ID))
                        .and(aclAssignment.REVOKED_AT.isNull())
                        .and(aclAssignment.ROLE_ID.eq(rootAcl.SUBJECT_ROLE_ID))));

        // (2) 루트 폴더의 MANAGE_ACL 허용을 계정으로 직접 또는 역할로 받았는가
        var hasRootAcl = DSL.exists(DSL.selectOne()
                .from(rootAcl)
                .where(rootAcl.ACADEMY_ID.eq(membership.ACADEMY_ID)
                        .and(rootAcl.RESOURCE_TYPE.eq("STORAGE_NODE"))
                        .and(rootAcl.RESOURCE_ID.eq(rootResourceId))
                        .and(rootAcl.ACTION.eq("MANAGE_ACL"))
                        .and(rootAcl.SUBJECT_ACCOUNT_ID.eq(membership.ACCOUNT_ID).or(hasAclRole))));

        return dsl.fetchExists(DSL.selectOne()
                .from(membership)
                .where(membership.ACADEMY_ID.eq(academyId)
                        .and(membership.STATUS.eq("ACTIVE"))
                        .and(hasManagePermission)
                        .and(hasRootAcl)));
    }
}
