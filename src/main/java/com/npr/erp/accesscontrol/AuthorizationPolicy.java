package com.npr.erp.accesscontrol;

/**
 * 판단에 쓴 정책 경로
 */
public enum AuthorizationPolicy {
    /**
     * 슈퍼유저 전용 경계에서 슈퍼유저 여부만 확인
     */
    SUPERUSER_V1,

    /**
     * 학원 소속과 기능 권한을 평가
     */
    ACADEMY_V1,

    /**
     * 학원 소속과 기능 권한에 리소스 ACL까지 평가
     */
    RESOURCE_V1
}
