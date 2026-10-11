package com.npr.erp.accesscontrol.internal.assignment;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * 소속에 대한 역할 배정
 *
 * 회수해도 행을 지우지 않고 회수 시각을 남김
 */
@Getter
@Entity(name = "RoleAssignment")
@Table(name = "role_assignment")
public class RoleAssignmentEntity {
    /**
     * 배정 ID
     */
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * 학원 ID
     */
    @Column(name = "academy_id", nullable = false, updatable = false)
    private UUID academyId;

    /**
     * 소속 ID
     */
    @Column(name = "staff_membership_id", nullable = false, updatable = false)
    private UUID staffMembershipId;

    /**
     * 역할 ID
     */
    @Column(name = "role_id", nullable = false, updatable = false)
    private UUID roleId;

    /**
     * 배정한 계정 ID
     */
    @Column(name = "assigned_by", nullable = false, updatable = false)
    private UUID assignedBy;

    /**
     * 배정 시각
     */
    @Column(name = "assigned_at", nullable = false, updatable = false)
    private Instant assignedAt;

    /**
     * 회수한 계정 ID. 유효한 배정은 null
     */
    @Column(name = "revoked_by")
    private UUID revokedBy;

    /**
     * 회수 시각. 유효한 배정은 null
     */
    @Column(name = "revoked_at")
    private Instant revokedAt;

    /**
     * JPA 인스턴스 초기화
     */
    protected RoleAssignmentEntity() {
    }

    /**
     * 유효한 새 배정 생성
     *
     * @param academyId 학원 ID
     * @param staffMembershipId 소속 ID
     * @param roleId 역할 ID
     * @param assignedBy 배정한 계정 ID
     * @param now 배정 시각
     */
    public RoleAssignmentEntity(UUID academyId, UUID staffMembershipId, UUID roleId, UUID assignedBy, Instant now) {
        this.id = UUID.randomUUID();
        this.academyId = academyId;
        this.staffMembershipId = staffMembershipId;
        this.roleId = roleId;
        this.assignedBy = assignedBy;
        this.assignedAt = now;
    }

    /**
     * 배정 회수
     *
     * @param actorAccountId 회수한 계정 ID
     * @param now 회수 시각
     */
    public void revoke(UUID actorAccountId, Instant now) {
        this.revokedBy = actorAccountId;
        this.revokedAt = now;
    }
}
