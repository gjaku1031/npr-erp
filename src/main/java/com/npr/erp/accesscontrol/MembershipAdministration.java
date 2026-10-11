package com.npr.erp.accesscontrol;

import java.util.List;
import java.util.UUID;

/**
 * 학원 소속 관리 계약
 *
 * 변경 요청은 읽었던 정책 버전을 함께 보내야 하며, 그 사이 정책이 바뀌었으면 거부됨
 */
public interface MembershipAdministration {
    /**
     * 학원의 전체 소속 조회
     *
     * @param actor 조회하는 주체. {@code access.membership.read} 권한 필요
     * @param academyId 학원 ID
     * @return 생성 순서의 소속 목록
     */
    AcademyPolicyView<List<MembershipView>> memberships(AuthorizationSubject actor, UUID academyId);

    /**
     * 활성 계정을 학원 소속으로 추가
     *
     * 계정이 실제로 있고 활성인지는 호출자가 identity로 먼저 확인해야 함
     *
     * @param actor 변경하는 주체. {@code access.membership.manage} 권한 필요
     * @param academyId 학원 ID
     * @param accountId 추가할 계정 ID
     * @param expectedPolicyVersion 화면이 읽었던 정책 버전
     * @return 새 소속과 올라간 정책 버전
     * @throws AccessControlConflictException 정책 버전이 다르거나 이미 활성 소속이 있을 때
     */
    AcademyPolicyView<MembershipView> createMembership(
            AuthorizationSubject actor, UUID academyId, UUID accountId, long expectedPolicyVersion);

    /**
     * 소속 종료
     *
     * @param actor 변경하는 주체. {@code access.membership.manage} 권한 필요
     * @param academyId 학원 ID
     * @param membershipId 종료할 소속 ID
     * @param expectedPolicyVersion 화면이 읽었던 정책 버전
     * @return 종료된 소속과 올라간 정책 버전
     * @throws AccessControlConflictException 정책 버전이 다르거나, 이미 종료됐거나, 마지막 ACL 관리자가 사라질 때
     */
    AcademyPolicyView<MembershipView> endMembership(
            AuthorizationSubject actor, UUID academyId, UUID membershipId, long expectedPolicyVersion);
}
