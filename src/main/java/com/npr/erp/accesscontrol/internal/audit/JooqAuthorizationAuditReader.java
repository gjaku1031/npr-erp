package com.npr.erp.accesscontrol.internal.audit;

import static com.npr.generated.jooq.Tables.AUTHORIZATION_AUDIT_LOG;

import com.npr.erp.accesscontrol.AuthorizationAuditReader;
import com.npr.erp.accesscontrol.AuthorizationAuditView;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.internal.authorization.PolicyGuard;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link AuthorizationAuditReader} 구현
 */
@Service
@RequiredArgsConstructor
public class JooqAuthorizationAuditReader implements AuthorizationAuditReader {
    /**
     * 한 번에 가져올 수 있는 최대 건수
     */
    private static final int MAX_LIMIT = 500;

    /**
     * 인가 확인
     */
    private final PolicyGuard policyGuard;

    /**
     * jOOQ 실행 문맥
     */
    private final DSLContext dsl;

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public List<AuthorizationAuditView> recent(AuthorizationSubject actor, UUID academyId, int limit) {
        policyGuard.requireAcademy(actor, academyId, PermissionCatalog.ACCESS_AUDIT_READ);
        return dsl.selectFrom(AUTHORIZATION_AUDIT_LOG)
                .where(AUTHORIZATION_AUDIT_LOG.ACADEMY_ID.eq(academyId))
                .orderBy(AUTHORIZATION_AUDIT_LOG.OCCURRED_AT.desc())
                .limit(Math.clamp(limit, 1, MAX_LIMIT))
                .fetch(record -> new AuthorizationAuditView(
                        record.getId(),
                        record.getOccurredAt().toInstant(),
                        record.getEventType(),
                        record.getActorAccountId(),
                        record.getTargetAccountId(),
                        record.getPermissionKey(),
                        record.getResourceId(),
                        record.getDecision(),
                        record.getReasonCode(),
                        record.getPolicyVersion()));
    }
}
