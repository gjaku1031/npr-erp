package com.npr.erp.accesscontrol.internal.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 인가 판단과 정책 변경의 감사 기록
 *
 * 한 번 쓰면 바꾸지 않음
 */
@Getter
@Entity(name = "AuthorizationAuditLog")
@Table(name = "authorization_audit_log")
public class AuthorizationAuditLogEntity {
    /**
     * 기록 ID
     */
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * 사건 종류
     */
    @Column(name = "event_type", nullable = false, updatable = false, length = 80)
    private String eventType;

    /**
     * 요청 추적 ID
     */
    @Column(name = "request_id", updatable = false, length = 128)
    private String requestId;

    /**
     * 실행한 계정
     */
    @Column(name = "actor_account_id", updatable = false)
    private UUID actorAccountId;

    /**
     * 대상 계정
     */
    @Column(name = "target_account_id", updatable = false)
    private UUID targetAccountId;

    /**
     * 학원 ID
     */
    @Column(name = "academy_id", updatable = false)
    private UUID academyId;

    /**
     * 판단한 권한 키
     */
    @Column(name = "permission_key", updatable = false, length = 160)
    private String permissionKey;

    /**
     * 리소스 종류
     */
    @Column(name = "resource_type", updatable = false, length = 64)
    private String resourceType;

    /**
     * 리소스 ID
     */
    @Column(name = "resource_id", updatable = false)
    private UUID resourceId;

    /**
     * ALLOW 또는 DENY
     */
    @Column(name = "decision", updatable = false, length = 32)
    private String decision;

    /**
     * 사유 코드
     */
    @Column(name = "reason_code", nullable = false, updatable = false, length = 100)
    private String reasonCode;

    /**
     * 정책 버전
     */
    @Column(name = "policy_version", updatable = false)
    private Long policyVersion;

    /**
     * 관련 ACL ID
     */
    @Column(name = "matched_acl_id", updatable = false)
    private UUID matchedAclId;

    /**
     * 변경 전 상태 JSON
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "before_state", columnDefinition = "jsonb", updatable = false)
    private String beforeState;

    /**
     * 변경 후 상태 JSON
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "after_state", columnDefinition = "jsonb", updatable = false)
    private String afterState;

    /**
     * 그 밖의 정보 JSON
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "details", columnDefinition = "jsonb", updatable = false)
    private String details;

    /**
     * 발생 시각
     */
    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt;

    /**
     * JPA 인스턴스 초기화
     */
    protected AuthorizationAuditLogEntity() {
    }

    /**
     * 사건을 기록으로 변환
     *
     * @param event 기록할 사건
     * @param requestId 요청 추적 ID
     * @param beforeState 직렬화한 변경 전 상태. 없으면 null
     * @param afterState 직렬화한 변경 후 상태. 없으면 null
     * @param details 직렬화한 부가 정보. 없으면 null
     * @param occurredAt 발생 시각
     */
    public AuthorizationAuditLogEntity(
            AuthorizationAuditEvent event,
            String requestId,
            String beforeState,
            String afterState,
            String details,
            Instant occurredAt) {
        this.id = UUID.randomUUID();
        this.eventType = event.eventType();
        this.requestId = requestId;
        this.actorAccountId = event.actorAccountId();
        this.targetAccountId = event.targetAccountId();
        this.academyId = event.academyId();
        this.permissionKey = event.permissionKey();
        this.resourceType = event.resourceType();
        this.resourceId = event.resourceId();
        this.decision = event.decision();
        this.reasonCode = event.reasonCode();
        this.policyVersion = event.policyVersion();
        this.matchedAclId = event.matchedAclId();
        this.beforeState = beforeState;
        this.afterState = afterState;
        this.details = details;
        this.occurredAt = occurredAt;
    }
}
