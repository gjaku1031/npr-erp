package com.npr.erp.accesscontrol;

import java.util.Collection;
import java.util.Set;
import java.util.UUID;

/**
 * 업무 기능이 권한을 확인할 때 쓰는 공개 인가 경계
 *
 * 권한 계약을 먼저 확인하고, 플랫폼 슈퍼유저 등록부를 본 뒤, 일반 사용자는 현재 소속·역할·권한과 필요한 ACL을
 * 읽어 평가함. 결정만 돌려주므로 거부된 요청을 멈추는 일은 호출자 책임임
 */
public interface Authorizer {
    /**
     * 단건 요청 판단
     *
     * @param request 주체, 권한, 대상
     * @return 허용 여부와 사유
     */
    AuthorizationDecision authorize(AuthorizationRequest request);

    /**
     * 판단 결과가 거부이면 예외를 던지는 단건 요청 판단
     *
     * @param request 주체, 권한, 대상
     * @throws AuthorizationDeniedException 거부되었을 때
     */
    default void require(AuthorizationRequest request) {
        var decision = authorize(request);
        if (!decision.allowed()) {
            throw new AuthorizationDeniedException(decision);
        }
    }

    /**
     * 같은 학원·같은 종류의 리소스 여러 개를 한 번의 조회로 걸러 냄
     *
     * 권한과 ACL 후보를 한 번씩만 읽고 메모리에서 리소스마다 평가함. SQL의 검색·정렬·페이지 나누기를 대신하지는 않음
     *
     * @param subject 목록을 조회하는 주체
     * @param permission 목록 기능에 필요한 리소스 권한
     * @param action 항목마다 요구할 ACL 작업
     * @param resources 서버가 원장에서 만든 리소스 문맥 목록
     * @param requestId 감사 기록과 연결할 요청 추적 ID. 없으면 null
     * @return 접근할 수 있는 리소스 ID 집합
     * @throws IllegalArgumentException 학원이나 리소스 종류가 섞였거나 같은 리소스가 두 번 들어 있을 때
     */
    Set<UUID> filterPermitted(
            AuthorizationSubject subject,
            PermissionKey permission,
            ResourceAction action,
            Collection<ResourceContext> resources,
            String requestId);
}
