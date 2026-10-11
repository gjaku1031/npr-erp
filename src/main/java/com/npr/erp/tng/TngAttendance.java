package com.npr.erp.tng;

/**
 * 학생 한 명의 하루 출결
 *
 * @param studentCode 학번
 * @param studentName 이름
 * @param status 출결 상태 문구. 출석, 지각, 결석, 조퇴 등
 */
public record TngAttendance(String studentCode, String studentName, String status) {
}
