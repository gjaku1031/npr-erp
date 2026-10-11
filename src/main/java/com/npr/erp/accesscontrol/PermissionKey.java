package com.npr.erp.accesscontrol;

import java.util.regex.Pattern;

/**
 * 기능 권한의 식별자
 *
 * {@code domain.resource.action} 형태의 영문 소문자 점 구분 문자열
 *
 * @param value 권한 키 원문
 */
public record PermissionKey(String value) {
    /**
     * 권한 키 형식
     */
    private static final Pattern PATTERN = Pattern.compile("[a-z][a-z0-9]*(?:\\.[a-z][a-z0-9-]*)+");

    /**
     * 형식 확인
     *
     * @throws IllegalArgumentException 형식에 맞지 않을 때
     */
    public PermissionKey {
        if (value == null || !PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("권한 키는 영문 소문자 점 구분 형식이어야 합니다: " + value);
        }
    }

    /**
     * 권한 키 원문 반환
     */
    @Override
    public String toString() {
        return value;
    }
}
