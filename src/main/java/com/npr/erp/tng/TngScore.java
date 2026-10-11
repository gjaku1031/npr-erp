package com.npr.erp.tng;

/**
 * 학생 한 명의 주간테스트 성적
 *
 * @param studentCode 학번
 * @param studentName 이름
 * @param total 총점. 100점 만점
 * @param rank 반 석차
 * @param examinees 응시자 수
 * @param average 반 평균
 * @param comment 지도 의견. 없으면 빈 문자열
 */
public record TngScore(
        String studentCode, String studentName, int total, int rank, int examinees, double average, String comment) {
}
