package com.npr.erp.accesscontrol.internal.superuser;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * 플랫폼 슈퍼유저 등록 한 건
 *
 * 행이 있으면 슈퍼유저이고, 회수하면 행을 지움
 */
@Getter
@Entity(name = "PlatformSuperuser")
@Table(name = "platform_superuser")
public class PlatformSuperuserEntity {
    /**
     * 슈퍼유저 계정 ID
     */
    @Id
    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    /**
     * 부여한 슈퍼유저 계정 ID. 첫 슈퍼유저는 null
     */
    @Column(name = "granted_by", updatable = false)
    private UUID grantedBy;

    /**
     * 부여 시각
     */
    @Column(name = "granted_at", nullable = false, updatable = false)
    private Instant grantedAt;

    /**
     * JPA 인스턴스 초기화
     */
    protected PlatformSuperuserEntity() {
    }

    /**
     * 새 슈퍼유저 등록 생성
     *
     * @param accountId 슈퍼유저 계정 ID
     * @param grantedBy 부여한 계정 ID. 첫 슈퍼유저는 null
     * @param now 부여 시각
     */
    public PlatformSuperuserEntity(UUID accountId, UUID grantedBy, Instant now) {
        this.accountId = accountId;
        this.grantedBy = grantedBy;
        this.grantedAt = now;
    }
}
