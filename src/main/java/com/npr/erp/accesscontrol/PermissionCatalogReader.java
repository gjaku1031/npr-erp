package com.npr.erp.accesscontrol;

import java.util.List;
import java.util.UUID;

/**
 * 관리 화면용 권한 목록 조회
 */
public interface PermissionCatalogReader {
    /**
     * 역할에 넣을 수 있는 전체 권한 목록
     *
     * @param actor 조회하는 주체. {@code access.role.read} 권한 필요
     * @param academyId 학원 ID
     * @return 코드에 정의된 권한 목록과 정책 버전
     * @throws AuthorizationDeniedException 권한이 없을 때
     */
    AcademyPolicyView<List<PermissionDefinition>> permissionCatalog(AuthorizationSubject actor, UUID academyId);
}
