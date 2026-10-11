package com.npr.erp.tng;

/**
 * 반에 다니는 학생
 *
 * @param code 외부 시스템의 학번
 * @param name 이름
 * @param school 학교
 * @param motherPhone 어머니 연락처. 등록되지 않았으면 빈 문자열
 */
public record TngStudent(String code, String name, String school, String motherPhone) {
}
