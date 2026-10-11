package com.npr.erp.identity.internal.audit;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 계정 감사 기록 저장소
 */
public interface IdentityAuditLogRepository extends JpaRepository<IdentityAuditLogEntity, UUID> {
}
