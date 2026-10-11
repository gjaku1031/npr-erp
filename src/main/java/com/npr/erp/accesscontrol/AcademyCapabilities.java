package com.npr.erp.accesscontrol;

import java.util.Set;
import java.util.UUID;

/**
 * 한 계정이 한 학원에서 가진 기능 권한 요약
 *
 * 메뉴와 버튼을 보여 줄지 정하는 힌트로만 씀. 개별 폴더의 ACL은 반영하지 않으므로 실제 작업 때 다시 인가해야 함
 *
 * @param academyId 학원 ID
 * @param policyVersion 정책 버전
 * @param superuser 플랫폼 슈퍼유저 여부
 * @param permissions 가진 권한 키
 */
public record AcademyCapabilities(UUID academyId, long policyVersion, boolean superuser, Set<String> permissions) {
    /**
     * 권한 보유 확인
     *
     * @param permission 확인할 권한
     * @return 가지고 있으면 true
     */
    public boolean has(PermissionDefinition permission) {
        return permissions.contains(permission.key().value());
    }
}
