package com.npr.erp.accesscontrol;

import java.time.Instant;
import java.util.UUID;

/**
 * 유효한 역할 배정 조회 결과
 *
 * @param id 배정 ID
 * @param membershipId 소속 ID
 * @param roleId 역할 ID
 * @param roleName 역할 이름
 * @param assignedAt 배정 시각
 */
public record RoleAssignmentView(UUID id, UUID membershipId, UUID roleId, String roleName, Instant assignedAt) {
}
