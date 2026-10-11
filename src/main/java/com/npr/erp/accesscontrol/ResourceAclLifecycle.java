package com.npr.erp.accesscontrol;

/**
 * 리소스가 사라질 때 그 리소스의 ACL을 정리하는 계약
 *
 * 사용자가 직접 부르는 기능이 아님. 삭제 권한을 이미 확인한 호출자가 쓰므로 ACL 관리 권한을 다시 요구하지 않음
 */
public interface ResourceAclLifecycle {
    /**
     * 리소스에 직접 걸린 ACL을 모두 회수
     *
     * 걸린 ACL이 없으면 정책 버전을 올리지 않음
     *
     * @param actor 삭제를 실행한 주체. 감사 기록에 남김
     * @param context 사라지는 리소스의 문맥
     * @return 회수 후의 정책 버전
     * @throws AccessControlConflictException 학원 루트의 ACL을 정리하려 할 때
     */
    AcademyPolicyView<Void> revokeAll(AuthorizationSubject actor, ResourceContext context);
}
