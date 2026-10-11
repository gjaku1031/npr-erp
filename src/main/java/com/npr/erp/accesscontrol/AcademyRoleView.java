package com.npr.erp.accesscontrol;

import java.util.Set;
import java.util.UUID;

/**
 * 역할 조회 결과
 *
 * @param id 역할 ID
 * @param academyId 학원 ID
 * @param name 표시 이름
 * @param status 역할 상태
 * @param permissions 연결된 권한 키
 */
public record AcademyRoleView(UUID id, UUID academyId, String name, AcademyRoleStatus status, Set<String> permissions) {
}
