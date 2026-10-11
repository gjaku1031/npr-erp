package com.npr.erp.accesscontrol.internal.audit;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 감사 기록 저장소
 */
public interface AuthorizationAuditLogRepository extends JpaRepository<AuthorizationAuditLogEntity, UUID> {
}
