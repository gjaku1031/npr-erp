package com.npr.erp.identity;

/**
 * 계정 상태
 */
public enum AccountStatus {
    /**
     * 로그인과 업무 요청이 가능한 상태
     */
    ACTIVE,

    /**
     * 정지되어 로그인과 업무 요청이 거부되는 상태
     */
    SUSPENDED
}
