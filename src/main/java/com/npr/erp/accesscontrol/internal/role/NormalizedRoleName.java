package com.npr.erp.accesscontrol.internal.role;

/**
 * 정규화한 역할 이름
 *
 * @param displayName 화면에 보이는 이름
 * @param normalizedName 중복 검사에 쓰는 소문자 이름
 */
public record NormalizedRoleName(String displayName, String normalizedName) {
}
