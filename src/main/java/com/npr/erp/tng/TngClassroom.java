package com.npr.erp.tng;

/**
 * 직원이 담당하는 반
 *
 * @param code 외부 시스템의 반 코드. 이름이 바뀌어도 같은 반을 가리킴
 * @param name 반 이름
 * @param dayGroup 수업 요일 묶음
 * @param kind 정규 또는 특강
 */
public record TngClassroom(String code, String name, TngDayGroup dayGroup, TngClassKind kind) {
}
