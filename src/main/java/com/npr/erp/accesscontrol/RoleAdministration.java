package com.npr.erp.accesscontrol;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 역할과 역할의 권한 구성 관리 계약
 *
 * 역할 이름은 표시 정보일 뿐이며 이름으로 관리자를 판정하지 않음
 */
public interface RoleAdministration {
    /**
     * 학원의 전체 역할 조회
     *
     * @param actor 조회하는 주체. {@code access.role.read} 권한 필요
     * @param academyId 학원 ID
     * @return 생성 순서의 역할 목록
     */
    AcademyPolicyView<List<AcademyRoleView>> roles(AuthorizationSubject actor, UUID academyId);

    /**
     * 역할 생성
     *
     * @param actor 변경하는 주체. {@code access.role.manage} 권한 필요
     * @param academyId 학원 ID
     * @param name 역할 이름
     * @param expectedPolicyVersion 화면이 읽었던 정책 버전
     * @return 권한이 없는 새 역할
     * @throws AccessControlConflictException 정책 버전이 다르거나 같은 이름의 역할이 있을 때
     * @throws AccessControlValidationException 이름이 규칙에 맞지 않을 때
     */
    AcademyPolicyView<AcademyRoleView> createRole(
            AuthorizationSubject actor, UUID academyId, String name, long expectedPolicyVersion);

    /**
     * 역할 이름 변경
     *
     * 이름이 바뀌어도 권한과 ACL 연결은 그대로 유지됨
     *
     * @param actor 변경하는 주체. {@code access.role.manage} 권한 필요
     * @param academyId 학원 ID
     * @param roleId 역할 ID
     * @param name 새 이름
     * @param expectedPolicyVersion 화면이 읽었던 정책 버전
     * @return 이름이 바뀐 역할
     */
    AcademyPolicyView<AcademyRoleView> renameRole(
            AuthorizationSubject actor, UUID academyId, UUID roleId, String name, long expectedPolicyVersion);

    /**
     * 역할 비활성화
     *
     * @param actor 변경하는 주체. {@code access.role.manage} 권한 필요
     * @param academyId 학원 ID
     * @param roleId 역할 ID
     * @param expectedPolicyVersion 화면이 읽었던 정책 버전
     * @return 비활성화된 역할
     * @throws AccessControlConflictException 마지막 ACL 관리자가 사라질 때
     */
    AcademyPolicyView<AcademyRoleView> deactivateRole(
            AuthorizationSubject actor, UUID academyId, UUID roleId, long expectedPolicyVersion);

    /**
     * 역할의 권한을 요청한 집합으로 교체
     *
     * 일부만 더하거나 빼지 않고 변경 후의 전체 집합을 받음
     *
     * @param actor 변경하는 주체. {@code access.role.manage} 권한 필요
     * @param academyId 학원 ID
     * @param roleId 역할 ID
     * @param permissionKeys 변경 후의 전체 권한 키
     * @param expectedPolicyVersion 화면이 읽었던 정책 버전
     * @return 권한이 바뀐 역할
     * @throws AccessControlValidationException 정의되지 않은 권한 키가 있을 때
     * @throws AccessControlConflictException 비활성 역할이거나 마지막 ACL 관리자가 사라질 때
     */
    AcademyPolicyView<AcademyRoleView> replaceRolePermissions(
            AuthorizationSubject actor,
            UUID academyId,
            UUID roleId,
            Set<PermissionKey> permissionKeys,
            long expectedPolicyVersion);
}
