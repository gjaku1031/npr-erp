package com.npr.erp.accesscontrol;

/**
 * 권한이 받는 대상 종류
 */
public enum PermissionTargetType {
    /**
     * 학원 전체에 대한 기능
     */
    ACADEMY,

    /**
     * 특정 리소스에 대한 작업
     */
    RESOURCE
}
