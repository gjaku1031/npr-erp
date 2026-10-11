package com.npr.erp.accesscontrol;

import java.util.Set;
import java.util.UUID;

/**
 * 학원 권한 정책 초기화 요청
 *
 * @param actor 초기화를 실행하는 플랫폼 슈퍼유저
 * @param academyId 학원 ID
 * @param rootResourceId 학원 저장소 루트 폴더 ID
 * @param firstAccountId 첫 관리자 계정 ID
 * @param firstRoleName 첫 관리자 역할 이름
 * @param firstRolePermissionKeys 첫 역할의 권한. {@code storage.acl.manage}가 반드시 있어야 함
 * @param requestId 감사 기록과 연결할 요청 추적 ID. 없으면 null
 */
public record InitializeAcademyAccessCommand(
        AuthorizationSubject actor,
        UUID academyId,
        UUID rootResourceId,
        UUID firstAccountId,
        String firstRoleName,
        Set<PermissionKey> firstRolePermissionKeys,
        String requestId) {
}
