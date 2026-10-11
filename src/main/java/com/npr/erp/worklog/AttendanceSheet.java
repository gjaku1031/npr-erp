package com.npr.erp.worklog;

import com.npr.erp.tng.TngClassroom;
import java.time.LocalDate;
import java.util.List;

/**
 * 한 반의 하루 출결표
 *
 * @param classroom 반
 * @param date 출결과 과제 이행을 본 날짜
 * @param weeklyTestDate 성적을 본 주간테스트 시행일. 정해지지 않았으면 null
 * @param rows 학생별 줄
 */
public record AttendanceSheet(TngClassroom classroom, LocalDate date, LocalDate weeklyTestDate, List<AttendanceRow> rows) {
    /**
     * 출석한 학생 수
     *
     * @return 출석 학생 수
     */
    public long present() {
        return count(AttendanceTone.GOOD);
    }

    /**
     * 지각·조퇴처럼 일부만 참석한 학생 수
     *
     * @return 일부 참석 학생 수
     */
    public long partial() {
        return count(AttendanceTone.WARN);
    }

    /**
     * 결석한 학생 수
     *
     * @return 결석 학생 수
     */
    public long absent() {
        return count(AttendanceTone.BAD);
    }

    /**
     * 출결 단계별 학생 수
     *
     * @param tone 출결 단계
     * @return 그 단계의 학생 수
     */
    private long count(AttendanceTone tone) {
        return rows.stream().filter(row -> row.tone() == tone).count();
    }
}
