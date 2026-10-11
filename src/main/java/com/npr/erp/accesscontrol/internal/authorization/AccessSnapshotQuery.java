package com.npr.erp.accesscontrol.internal.authorization;

import static com.npr.generated.jooq.Tables.ACADEMY_ACCESS_SCOPE;
import static com.npr.generated.jooq.Tables.ACADEMY_ROLE;
import static com.npr.generated.jooq.Tables.ROLE_ASSIGNMENT;
import static com.npr.generated.jooq.Tables.ROLE_PERMISSION;
import static com.npr.generated.jooq.Tables.STAFF_MEMBERSHIP;

import com.npr.erp.accesscontrol.PermissionKey;
import java.util.HashSet;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * 계정의 현재 권한을 읽는 조회
 */
@Repository
@RequiredArgsConstructor
public class AccessSnapshotQuery {
    /**
     * jOOQ 실행 문맥
     */
    private final DSLContext dsl;

    /**
     * 한 계정이 한 학원에서 가진 권한 조회
     *
     * @param accountId 계정 ID
     * @param academyId 학원 ID
     * @return 현재 권한과 정책 버전
     */
    public LoadedAccessSnapshot load(UUID accountId, UUID academyId) {
        var policyVersion = dsl.select(ACADEMY_ACCESS_SCOPE.POLICY_VERSION)
                .from(ACADEMY_ACCESS_SCOPE)
                .where(ACADEMY_ACCESS_SCOPE.ACADEMY_ID.eq(academyId))
                .fetchOne(ACADEMY_ACCESS_SCOPE.POLICY_VERSION);

        // 활성 소속이 없으면 역할을 읽지 않음
        var membershipId = dsl.select(STAFF_MEMBERSHIP.ID)
                .from(STAFF_MEMBERSHIP)
                .where(STAFF_MEMBERSHIP.ACADEMY_ID.eq(academyId)
                        .and(STAFF_MEMBERSHIP.ACCOUNT_ID.eq(accountId))
                        .and(STAFF_MEMBERSHIP.STATUS.eq("ACTIVE")))
                .fetchOne(STAFF_MEMBERSHIP.ID);
        if (membershipId == null) {
            return new LoadedAccessSnapshot(EffectiveAccess.none(), policyVersion);
        }

        // 회수되지 않은 배정과 활성 역할만 조인. 권한이 없는 역할도 ACL 주체가 될 수 있어 left join
        var rows = dsl.select(ACADEMY_ROLE.ID, ROLE_PERMISSION.PERMISSION_KEY)
                .from(ROLE_ASSIGNMENT)
                .join(ACADEMY_ROLE)
                .on(ACADEMY_ROLE.ID.eq(ROLE_ASSIGNMENT.ROLE_ID)
                        .and(ACADEMY_ROLE.ACADEMY_ID.eq(ROLE_ASSIGNMENT.ACADEMY_ID)))
                .leftJoin(ROLE_PERMISSION)
                .on(ROLE_PERMISSION.ROLE_ID.eq(ACADEMY_ROLE.ID))
                .where(ROLE_ASSIGNMENT.STAFF_MEMBERSHIP_ID.eq(membershipId)
                        .and(ROLE_ASSIGNMENT.ACADEMY_ID.eq(academyId))
                        .and(ROLE_ASSIGNMENT.REVOKED_AT.isNull())
                        .and(ACADEMY_ROLE.STATUS.eq("ACTIVE")))
                .fetch();

        var roleIds = new HashSet<UUID>();
        var permissions = new HashSet<PermissionKey>();
        for (var row : rows) {
            roleIds.add(row.get(ACADEMY_ROLE.ID));
            var permissionKey = row.get(ROLE_PERMISSION.PERMISSION_KEY);
            if (permissionKey != null) {
                permissions.add(new PermissionKey(permissionKey));
            }
        }
        return new LoadedAccessSnapshot(new EffectiveAccess(academyId, true, permissions, roleIds), policyVersion);
    }
}
