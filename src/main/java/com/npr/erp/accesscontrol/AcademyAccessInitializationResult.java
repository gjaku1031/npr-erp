package com.npr.erp.accesscontrol;

import java.util.UUID;

/**
 * 학원 권한 정책 초기화 결과
 *
 * @param academyId 학원 ID
 * @param policyVersion 초기 정책 버전
 * @param membershipId 첫 관리자의 소속 ID
 * @param roleId 첫 관리자 역할 ID
 * @param rootAclId 루트 폴더의 ACL 관리 허용 ID
 */
public record AcademyAccessInitializationResult(
        UUID academyId, long policyVersion, UUID membershipId, UUID roleId, UUID rootAclId) {
}
