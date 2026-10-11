package com.npr.erp.accesscontrol.internal.membership;

import com.npr.erp.accesscontrol.MembershipStatus;
import com.npr.erp.accesscontrol.MembershipView;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * 계정의 학원 소속
 */
@Getter
@Entity(name = "StaffMembership")
@Table(name = "staff_membership")
public class StaffMembershipEntity {
    /**
     * 소속 ID
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
     * 계정 ID
     */
    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    /**
     * 소속 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private MembershipStatus status;

    /**
     * 시작 시각
     */
    @Column(name = "started_at", nullable = false, updatable = false)
    private Instant startedAt;

    /**
     * 종료 시각. 유효한 소속은 null
     */
    @Column(name = "ended_at")
    private Instant endedAt;

    /**
     * 추가한 계정 ID
     */
    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    /**
     * 생성 시각
     */
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /**
     * 수정 시각
     */
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * JPA 인스턴스 초기화
     */
    protected StaffMembershipEntity() {
    }

    /**
     * 유효한 새 소속 생성
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     * @param createdBy 추가한 계정 ID
     * @param now 시작 시각
     */
    public StaffMembershipEntity(UUID academyId, UUID accountId, UUID createdBy, Instant now) {
        this.id = UUID.randomUUID();
        this.academyId = academyId;
        this.accountId = accountId;
        this.status = MembershipStatus.ACTIVE;
        this.startedAt = now;
        this.createdBy = createdBy;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /**
     * 소속 종료
     *
     * @param now 종료 시각
     */
    public void end(Instant now) {
        this.status = MembershipStatus.ENDED;
        this.endedAt = now;
        this.updatedAt = now;
    }

    /**
     * 공개 조회 결과로 변환
     *
     * @return 소속 조회 결과
     */
    public MembershipView toView() {
        return new MembershipView(id, academyId, accountId, status, startedAt, endedAt);
    }
}
