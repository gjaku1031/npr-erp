package com.npr.erp.accesscontrol.internal.role;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * 역할에 연결된 권한 한 건
 */
@Getter
@Entity(name = "RolePermission")
@Table(name = "role_permission")
public class RolePermissionEntity {
    /**
     * 역할 ID와 권한 키
     */
    @EmbeddedId
    private RolePermissionId id;

    /**
     * 연결한 계정 ID
     */
    @Column(name = "granted_by", nullable = false, updatable = false)
    private UUID grantedBy;

    /**
     * 연결 시각
     */
    @Column(name = "granted_at", nullable = false, updatable = false)
    private Instant grantedAt;

    /**
     * JPA 인스턴스 초기화
     */
    protected RolePermissionEntity() {
    }

    /**
     * 새 연결 생성
     *
     * @param roleId 역할 ID
     * @param permissionKey 권한 키
     * @param grantedBy 연결한 계정 ID
     * @param now 연결 시각
     */
    public RolePermissionEntity(UUID roleId, String permissionKey, UUID grantedBy, Instant now) {
        this.id = new RolePermissionId(roleId, permissionKey);
        this.grantedBy = grantedBy;
        this.grantedAt = now;
    }
}
