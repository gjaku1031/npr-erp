package com.npr.erp.tng;

/**
 * 학생 한 명의 하루 과제 이행
 *
 * @param studentCode 학번
 * @param advance 선행 과제 이행 문구. 없음, 미흡, 미이행 중 하나이거나 입력 전이면 빈 문자열
 * @param deep 심화 과제 이행 문구. 값의 범위는 선행과 같음
 */
public record TngHomework(String studentCode, String advance, String deep) {
}
