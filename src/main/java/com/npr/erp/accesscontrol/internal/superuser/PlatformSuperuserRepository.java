package com.npr.erp.accesscontrol.internal.superuser;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 플랫폼 슈퍼유저 등록부
 */
public interface PlatformSuperuserRepository extends JpaRepository<PlatformSuperuserEntity, UUID> {
}
