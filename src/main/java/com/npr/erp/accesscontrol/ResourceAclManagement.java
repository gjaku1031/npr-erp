package com.npr.erp.accesscontrol;

import java.util.List;
import java.util.UUID;

/**
 * 리소스 ACL 관리 계약
 *
 * 호출자는 리소스가 실제로 있고 ACL을 걸 수 있는 종류인지(폴더인지) 먼저 확인해야 함
 */
public interface ResourceAclManagement {
    /**
     * 리소스에 직접 걸린 ACL 조회
     *
     * 조상에게서 상속받는 항목은 포함하지 않음
     *
     * @param actor 조회하는 주체. {@code storage.acl.read} 권한과 READ ACL 필요
     * @param context 리소스 문맥
     * @return 생성 순서의 ACL 목록
     */
    AcademyPolicyView<List<ResourceAclView>> list(AuthorizationSubject actor, ResourceContext context);

    /**
     * ACL 부여 또는 상속 설정 변경
     *
     * 같은 주체·작업의 항목이 이미 있으면 상속 설정만 바꾸고, 같은 설정이면 아무것도 바꾸지 않음
     *
     * @param actor 변경하는 주체. {@code storage.acl.manage} 권한과 MANAGE_ACL ACL 필요
     * @param context 리소스 문맥
     * @param subject 허용을 받을 주체
     * @param action 허용할 작업
     * @param inheritToChildren 하위 리소스에도 적용할지
     * @param expectedPolicyVersion 화면이 읽었던 정책 버전
     * @return 부여된 ACL
     * @throws AccessControlValidationException 주체가 같은 학원의 활성 소속·역할이 아닐 때
     */
    AcademyPolicyView<ResourceAclView> grant(
            AuthorizationSubject actor,
            ResourceContext context,
            ResourceAclSubject subject,
            ResourceAction action,
            boolean inheritToChildren,
            long expectedPolicyVersion);

    /**
     * ACL 회수
     *
     * @param actor 변경하는 주체. {@code storage.acl.manage} 권한과 MANAGE_ACL ACL 필요
     * @param context 리소스 문맥
     * @param aclId 회수할 ACL ID
     * @param expectedPolicyVersion 화면이 읽었던 정책 버전
     * @return 올라간 정책 버전
     * @throws AccessControlNotFoundException 그 리소스의 ACL이 아닐 때
     * @throws AccessControlConflictException 마지막 ACL 관리자가 사라질 때
     */
    AcademyPolicyView<Void> revoke(
            AuthorizationSubject actor, ResourceContext context, UUID aclId, long expectedPolicyVersion);
}
