package com.npr.erp.accesscontrol;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 소속에 대한 역할 배정 관리 계약
 */
public interface RoleAssignmentAdministration {
    /**
     * 학원 전체 소속의 유효한 역할 배정 조회
     *
     * @param actor 조회하는 주체. {@code access.assignment.read} 권한 필요
     * @param academyId 학원 ID
     * @return 소속 ID별 역할 배정 목록. 배정이 없는 소속은 키가 없음
     */
    AcademyPolicyView<Map<UUID, List<RoleAssignmentView>>> assignments(AuthorizationSubject actor, UUID academyId);

    /**
     * 한 소속의 역할을 요청한 집합으로 교체
     *
     * @param actor 변경하는 주체. {@code access.assignment.manage} 권한 필요
     * @param academyId 학원 ID
     * @param membershipId 소속 ID
     * @param roleIds 변경 후의 전체 역할 ID
     * @param expectedPolicyVersion 화면이 읽었던 정책 버전
     * @return 변경 후의 역할 배정
     * @throws AccessControlValidationException 다른 학원의 역할이나 비활성 역할이 있을 때
     * @throws AccessControlConflictException 종료된 소속이거나 마지막 ACL 관리자가 사라질 때
     */
    AcademyPolicyView<List<RoleAssignmentView>> replaceMembershipRoles(
            AuthorizationSubject actor, UUID academyId, UUID membershipId, Set<UUID> roleIds,
            long expectedPolicyVersion);
}
