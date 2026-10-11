package com.npr.erp.accesscontrol.internal.authorization;

import static com.npr.generated.jooq.Tables.ACADEMY_ACCESS_SCOPE;
import static com.npr.generated.jooq.Tables.ACADEMY_ROLE;
import static com.npr.generated.jooq.Tables.ROLE_ASSIGNMENT;
import static com.npr.generated.jooq.Tables.ROLE_PERMISSION;
import static com.npr.generated.jooq.Tables.STAFF_MEMBERSHIP;

import com.npr.erp.accesscontrol.AcademyCapabilities;
import com.npr.erp.accesscontrol.AcademyCapabilityReader;
import com.npr.erp.accesscontrol.AccessControlNotFoundException;
import com.npr.erp.accesscontrol.AuthorizationDecision;
import com.npr.erp.accesscontrol.AuthorizationDeniedException;
import com.npr.erp.accesscontrol.AuthorizationPolicy;
import com.npr.erp.accesscontrol.AuthorizationReason;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.PermissionDefinition;
import com.npr.erp.accesscontrol.PermissionKey;
import com.npr.erp.accesscontrol.internal.superuser.PlatformSuperuserRepository;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link AcademyCapabilityReader} 구현
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
public class JooqAcademyCapabilityReader implements AcademyCapabilityReader {
    /**
     * 플랫폼 슈퍼유저 등록부
     */
    private final PlatformSuperuserRepository superuserRepository;

    /**
     * 현재 권한 조회
     */
    private final AccessSnapshotQuery accessSnapshotQuery;

    /**
     * jOOQ 실행 문맥
     */
    private final DSLContext dsl;

    /**
     * {@inheritDoc}
     */
    @Override
    public AcademyCapabilities capabilities(AuthorizationSubject subject, UUID academyId) {
        var snapshot = accessSnapshotQuery.load(subject.accountId(), academyId);
        var policyVersion = snapshot.policyVersion();
        if (policyVersion == null) {
            throw new AccessControlNotFoundException(
                    "ACADEMY_ACCESS_NOT_INITIALIZED", "학원 권한 정책이 초기화되지 않았습니다: " + academyId);
        }

        var superuser = superuserRepository.existsById(subject.accountId());
        if (!superuser && !snapshot.access().membershipActive()) {
            throw new AuthorizationDeniedException(AuthorizationDecision.deny(
                    AuthorizationReason.MEMBERSHIP_INACTIVE, AuthorizationPolicy.ACADEMY_V1));
        }

        // 슈퍼유저는 전체 권한을 가진 것으로 보여 줌
        var permissions = superuser
                ? PermissionCatalog.definitions().stream()
                        .map(definition -> definition.key().value())
                        .collect(Collectors.toUnmodifiableSet())
                : snapshot.access().permissions().stream()
                        .map(PermissionKey::value)
                        .collect(Collectors.toUnmodifiableSet());
        return new AcademyCapabilities(academyId, policyVersion, superuser, permissions);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<UUID> accessibleAcademyIds(AuthorizationSubject subject) {
        if (superuserRepository.existsById(subject.accountId())) {
            return dsl.select(ACADEMY_ACCESS_SCOPE.ACADEMY_ID)
                    .from(ACADEMY_ACCESS_SCOPE)
                    .orderBy(ACADEMY_ACCESS_SCOPE.CREATED_AT)
                    .fetch(ACADEMY_ACCESS_SCOPE.ACADEMY_ID);
        }
        return dsl.select(STAFF_MEMBERSHIP.ACADEMY_ID)
                .from(STAFF_MEMBERSHIP)
                .where(STAFF_MEMBERSHIP.ACCOUNT_ID.eq(subject.accountId())
                        .and(STAFF_MEMBERSHIP.STATUS.eq("ACTIVE")))
                .orderBy(STAFF_MEMBERSHIP.STARTED_AT)
                .fetch(STAFF_MEMBERSHIP.ACADEMY_ID);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public Set<UUID> accountIdsWith(UUID academyId, PermissionDefinition permission) {
        return dsl.selectDistinct(STAFF_MEMBERSHIP.ACCOUNT_ID)
                .from(STAFF_MEMBERSHIP)
                .join(ROLE_ASSIGNMENT)
                .on(ROLE_ASSIGNMENT.STAFF_MEMBERSHIP_ID.eq(STAFF_MEMBERSHIP.ID)
                        .and(ROLE_ASSIGNMENT.ACADEMY_ID.eq(STAFF_MEMBERSHIP.ACADEMY_ID))
                        .and(ROLE_ASSIGNMENT.REVOKED_AT.isNull()))
                .join(ACADEMY_ROLE)
                .on(ACADEMY_ROLE.ID.eq(ROLE_ASSIGNMENT.ROLE_ID).and(ACADEMY_ROLE.STATUS.eq("ACTIVE")))
                .join(ROLE_PERMISSION)
                .on(ROLE_PERMISSION.ROLE_ID.eq(ACADEMY_ROLE.ID)
                        .and(ROLE_PERMISSION.PERMISSION_KEY.eq(permission.key().value())))
                .where(STAFF_MEMBERSHIP.ACADEMY_ID.eq(academyId).and(STAFF_MEMBERSHIP.STATUS.eq("ACTIVE")))
                .fetchSet(STAFF_MEMBERSHIP.ACCOUNT_ID);
    }
}
