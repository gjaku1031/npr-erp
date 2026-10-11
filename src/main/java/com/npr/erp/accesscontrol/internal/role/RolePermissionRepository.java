package com.npr.erp.accesscontrol.internal.role;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 역할-권한 연결 저장소
 */
public interface RolePermissionRepository extends JpaRepository<RolePermissionEntity, RolePermissionId> {
    /**
     * 한 역할의 권한 연결 조회
     *
     * @param roleId 역할 ID
     * @return 연결 목록
     */
    List<RolePermissionEntity> findAllByIdRoleId(UUID roleId);

    /**
     * 여러 역할의 권한 연결을 한 번에 조회
     *
     * @param roleIds 역할 ID 목록
     * @return 연결 목록
     */
    List<RolePermissionEntity> findAllByIdRoleIdIn(Collection<UUID> roleIds);

    /**
     * 한 역할의 권한 연결을 모두 삭제
     *
     * @param roleId 역할 ID
     */
    void deleteAllByIdRoleId(UUID roleId);
}
