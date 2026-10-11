package com.npr.erp.identity.internal.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * 계정 생성·비밀번호 변경 감사 기록
 */
@Getter
@Entity(name = "IdentityAuditLog")
@Table(name = "identity_audit_log")
public class IdentityAuditLogEntity {
    /**
     * 기록 ID
     */
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * 사건 종류
     */
    @Column(name = "event_type", nullable = false, updatable = false, length = 64)
    private String eventType;

    /**
     * 실행한 계정. 운영 명령으로 실행하면 null
     */
    @Column(name = "actor_account_id", updatable = false)
    private UUID actorAccountId;

    /**
     * 대상 계정
     */
    @Column(name = "target_account_id", nullable = false, updatable = false)
    private UUID targetAccountId;

    /**
     * 사유
     */
    @Column(name = "reason", nullable = false, updatable = false, length = 500)
    private String reason;

    /**
     * 발생 시각
     */
    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt;

    /**
     * JPA 인스턴스 초기화
     */
    protected IdentityAuditLogEntity() {
    }

    /**
     * 새 감사 기록 생성
     *
     * @param eventType 사건 종류
     * @param actorAccountId 실행한 계정. 없으면 null
     * @param targetAccountId 대상 계정
     * @param reason 사유
     * @param occurredAt 발생 시각
     */
    public IdentityAuditLogEntity(
            String eventType, UUID actorAccountId, UUID targetAccountId, String reason, Instant occurredAt) {
        this.id = UUID.randomUUID();
        this.eventType = eventType;
        this.actorAccountId = actorAccountId;
        this.targetAccountId = targetAccountId;
        this.reason = reason;
        this.occurredAt = occurredAt;
    }
}
