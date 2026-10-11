package com.npr.erp.accesscontrol.internal.authorization;

/**
 * DB에서 읽은 권한과 그 시점의 정책 버전
 *
 * @param access 계정의 현재 권한
 * @param policyVersion 학원의 정책 버전. 초기화되지 않은 학원은 null
 */
public record LoadedAccessSnapshot(EffectiveAccess access, Long policyVersion) {
}
