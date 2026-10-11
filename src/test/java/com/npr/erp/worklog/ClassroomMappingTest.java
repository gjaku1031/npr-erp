package com.npr.erp.worklog;

import static org.assertj.core.api.Assertions.assertThat;

import com.npr.erp.tng.TngClassKind;
import com.npr.erp.tng.TngClassroom;
import com.npr.erp.tng.TngDayGroup;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * 외부 시스템의 문구와 요일을 업무일지의 값으로 바꾸는 규칙 검사
 */
class ClassroomMappingTest {
    /**
     * 정규 월수금, 정규 화목토, 특강 월수금 반을 하나씩 가진 직원
     */
    private final StaffView staff = new StaffView(
            UUID.randomUUID(),
            UUID.randomUUID(),
            "S01",
            List.of(
                    new TngClassroom("C1", "초4 M", TngDayGroup.MWF, TngClassKind.REGULAR),
                    new TngClassroom("C2", "초5 T", TngDayGroup.TTS, TngClassKind.REGULAR),
                    new TngClassroom("X1", "특강 M", TngDayGroup.MWF, TngClassKind.SPECIAL)),
            null);

    /**
     * 평소에는 그 요일 묶음의 정규 반만, 특강기간에는 같은 요일의 특강 반까지 나오는지 확인
     */
    @Test
    void classroomsFollowDayGroupAndSpecialPeriod() {
        var monday = LocalDate.of(2026, 10, 5);
        var tuesday = LocalDate.of(2026, 10, 6);

        assertThat(staff.classroomsOn(monday, false)).extracting(TngClassroom::code).containsExactly("C1");
        assertThat(staff.classroomsOn(monday, true)).extracting(TngClassroom::code).containsExactly("C1", "X1");
        assertThat(staff.classroomsOn(tuesday, true)).extracting(TngClassroom::code).containsExactly("C2");
    }

    /**
     * 일요일에는 처리할 반이 없는지 확인
     */
    @Test
    void sundayHasNoClassrooms() {
        assertThat(staff.classroomsOn(LocalDate.of(2026, 10, 4), true)).isEmpty();
    }

    /**
     * 과제 이행 문구가 등급으로 바뀌는지 확인
     */
    @Test
    void homeworkTextMapsToGrade() {
        assertThat(HomeworkGrade.of("미이행")).isEqualTo(HomeworkGrade.C);
        assertThat(HomeworkGrade.of("미흡")).isEqualTo(HomeworkGrade.B);
        assertThat(HomeworkGrade.of("없음")).isEqualTo(HomeworkGrade.A);
        assertThat(HomeworkGrade.of("")).isEqualTo(HomeworkGrade.NONE);
        assertThat(HomeworkGrade.of(null)).isEqualTo(HomeworkGrade.NONE);
    }

    /**
     * 출결 문구가 세 단계로 나뉘는지 확인
     */
    @Test
    void attendanceTextMapsToTone() {
        assertThat(AttendanceTone.of("결석")).isEqualTo(AttendanceTone.BAD);
        assertThat(AttendanceTone.of("지각")).isEqualTo(AttendanceTone.WARN);
        assertThat(AttendanceTone.of("출석")).isEqualTo(AttendanceTone.GOOD);
    }
}
