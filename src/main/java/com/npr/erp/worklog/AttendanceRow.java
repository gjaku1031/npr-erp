package com.npr.erp.worklog;

import com.npr.erp.tng.TngScore;

/**
 * 출결표의 학생 한 줄
 *
 * 출결과 과제 이행은 보고 날짜의 자료, 성적은 주간테스트 시행일의 자료임
 *
 * @param studentCode 학번
 * @param studentName 학생 이름
 * @param school 학교
 * @param motherPhone 어머니 연락처
 * @param status 출결 문구
 * @param tone 출결 단계
 * @param advance 선행 과제 이행 등급
 * @param deep 심화 과제 이행 등급
 * @param score 주간테스트 성적. 시행일이 정해지지 않았거나 응시하지 않았으면 null
 */
public record AttendanceRow(
        String studentCode,
        String studentName,
        String school,
        String motherPhone,
        String status,
        AttendanceTone tone,
        HomeworkGrade advance,
        HomeworkGrade deep,
        TngScore score) {
    /**
     * 보충이 필요한 점수인지
     *
     * @return 성적이 있고 70점 미만이면 true
     */
    public boolean lowScore() {
        return score != null && score.total() < 70;
    }
}
