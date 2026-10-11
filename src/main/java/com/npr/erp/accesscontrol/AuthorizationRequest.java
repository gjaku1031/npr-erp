package com.npr.erp.accesscontrol;

/**
 * 단건 인가 요청
 *
 * @param subject 작업을 시도하는 활성 계정
 * @param permission 필요한 기능 권한
 * @param target 학원 또는 리소스 대상
 * @param requestId 감사 기록과 연결할 요청 추적 ID. 없으면 null
 */
public record AuthorizationRequest(
        AuthorizationSubject subject, PermissionKey permission, AuthorizationTarget target, String requestId) {
    /**
     * 추적 ID 없이 요청 생성
     *
     * @param subject 작업을 시도하는 활성 계정
     * @param permission 필요한 기능 권한
     * @param target 학원 또는 리소스 대상
     */
    public AuthorizationRequest(AuthorizationSubject subject, PermissionKey permission, AuthorizationTarget target) {
        this(subject, permission, target, null);
    }
}
