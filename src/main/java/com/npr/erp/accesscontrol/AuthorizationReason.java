package com.npr.erp.accesscontrol;

/**
 * 허용 또는 거부의 고정 사유 코드
 */
public enum AuthorizationReason {
    /**
     * 일반 규칙을 모두 통과
     */
    ALLOWED,

    /**
     * 플랫폼 슈퍼유저 자격으로 소속·권한·ACL 검사를 건너뜀
     */
    SUPERUSER_BYPASS,

    /**
     * 슈퍼유저 전용 경계에 일반 계정이 접근
     */
    SUPERUSER_REQUIRED,

    /**
     * 코드에 정의되지 않은 권한 키
     */
    UNKNOWN_PERMISSION,

    /**
     * 권한과 대상 종류·리소스 종류·ACL 작업이 맞지 않음
     */
    PERMISSION_TARGET_MISMATCH,

    /**
     * 대상 학원에 활성 소속이 없음
     */
    MEMBERSHIP_INACTIVE,

    /**
     * 유효한 역할로 필요한 권한을 얻지 못함
     */
    MISSING_PERMISSION,

    /**
     * 읽어 온 권한의 학원과 요청 대상의 학원이 다름
     */
    ACADEMY_SCOPE_MISMATCH,

    /**
     * 리소스와 상속 가능한 조상 어디에도 맞는 ACL이 없음
     */
    ACL_NOT_GRANTED
}
