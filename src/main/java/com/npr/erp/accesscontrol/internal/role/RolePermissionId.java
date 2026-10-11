package com.npr.erp.accesscontrol.internal.role;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;
import lombok.Getter;

/**
 * 역할-권한 연결의 복합 키
 */
@Getter
@Embeddable
public final class RolePermissionId implements Serializable {
    /**
     * 역할 ID
     */
    @Column(name = "role_id", nullable = false)
    private UUID roleId;

    /**
     * 권한 키
     */
    @Column(name = "permission_key", nullable = false, length = 160)
    private String permissionKey;

    /**
     * JPA 인스턴스 초기화
     */
    RolePermissionId() {
    }

    /**
     * 역할과 권한 키로 복합 키 생성
     *
     * @param roleId 역할 ID
     * @param permissionKey 권한 키
     */
    public RolePermissionId(UUID roleId, String permissionKey) {
        this.roleId = roleId;
        this.permissionKey = permissionKey;
    }

    /**
     * 역할 ID와 권한 키가 모두 같으면 같은 키
     */
    @Override
    public boolean equals(Object other) {
        return this == other
                || other instanceof RolePermissionId that
                        && Objects.equals(roleId, that.roleId)
                        && Objects.equals(permissionKey, that.permissionKey);
    }

    /**
     * 역할 ID와 권한 키 기준 해시
     */
    @Override
    public int hashCode() {
        return Objects.hash(roleId, permissionKey);
    }
}
