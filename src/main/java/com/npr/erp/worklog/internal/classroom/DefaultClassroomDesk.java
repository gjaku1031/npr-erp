package com.npr.erp.worklog.internal.classroom;

import com.npr.erp.tng.TngClassroom;
import com.npr.erp.tng.TngCounselRecord;
import com.npr.erp.tng.TngGateway;
import com.npr.erp.tng.TngHomework;
import com.npr.erp.tng.TngNotebook;
import com.npr.erp.tng.TngScore;
import com.npr.erp.tng.TngStudent;
import com.npr.erp.worklog.AttendanceRow;
import com.npr.erp.worklog.AttendanceSheet;
import com.npr.erp.worklog.AttendanceTone;
import com.npr.erp.worklog.ClassroomDesk;
import com.npr.erp.worklog.HomeworkGrade;
import com.npr.erp.worklog.JournalDesk;
import com.npr.erp.worklog.JournalView;
import com.npr.erp.worklog.WorklogForbiddenException;
import com.npr.erp.worklog.WorklogStaffDirectory;
import com.npr.erp.worklog.internal.support.Texts;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * {@link ClassroomDesk} 구현
 *
 * DB에는 쓰지 않고 외부 시스템 포트만 읽고 씀. 그래서 트랜잭션을 열지 않음
 */
@Service
@RequiredArgsConstructor
public class DefaultClassroomDesk implements ClassroomDesk {
    /**
     * 알림장 제목의 최대 길이
     */
    private static final int MAX_TITLE_LENGTH = 200;

    /**
     * 알림장 내용의 최대 길이
     */
    private static final int MAX_BODY_LENGTH = 8000;

    /**
     * 직원 설정
     */
    private final WorklogStaffDirectory staffDirectory;

    /**
     * 일일보고 정의와 설정
     */
    private final JournalDesk journalDesk;

    /**
     * 외부 시스템 포트
     */
    private final TngGateway tngGateway;

    /**
     * {@inheritDoc}
     */
    @Override
    public List<TngClassroom> classroomsOn(UUID academyId, UUID accountId, LocalDate date) {
        // 그 날짜의 일일보고가 있으면 만들 때 적어 둔 특강기간을, 없으면 지금의 설정을 따름
        var special = journalDesk.journal(academyId, date)
                .map(JournalView::specialPeriod)
                .orElseGet(() -> journalDesk.settings(academyId).specialPeriod());
        return staffDirectory.staff(academyId, accountId).classroomsOn(date, special);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public Optional<TngNotebook> notebook(UUID academyId, UUID accountId, String classCode, LocalDate date) {
        ownClassroom(academyId, accountId, classCode);
        return tngGateway.notebook(classCode, date);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public TngNotebook publishNotebook(
            UUID academyId, UUID accountId, String classCode, LocalDate date, String title, String body) {
        ownClassroom(academyId, accountId, classCode);
        return tngGateway.publishNotebook(
                classCode,
                date,
                Texts.required(title, "알림장 제목", MAX_TITLE_LENGTH),
                Texts.required(body, "알림장 내용", MAX_BODY_LENGTH));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public AttendanceSheet attendance(UUID academyId, UUID accountId, String classCode, LocalDate date) {
        var classroom = ownClassroom(academyId, accountId, classCode);

        // 학교와 연락처는 명단에서, 과제 이행은 보고 날짜에서, 성적은 주간테스트 시행일에서 읽어 학번으로 합침
        var students = new HashMap<String, TngStudent>();
        for (var student : tngGateway.students(classCode)) {
            students.put(student.code(), student);
        }
        var homework = new HashMap<String, TngHomework>();
        for (var entry : tngGateway.homework(classCode, date)) {
            homework.put(entry.studentCode(), entry);
        }
        var testDate = journalDesk.settings(academyId).weeklyTestDateOf(classroom.dayGroup());
        var scores = new HashMap<String, TngScore>();
        if (testDate != null) {
            for (var score : tngGateway.weeklyTestScores(classCode, testDate)) {
                scores.put(score.studentCode(), score);
            }
        }

        var rows = new ArrayList<AttendanceRow>();
        for (var attendance : tngGateway.attendance(classCode, date)) {
            var student = students.get(attendance.studentCode());
            var work = homework.get(attendance.studentCode());
            rows.add(new AttendanceRow(
                    attendance.studentCode(),
                    attendance.studentName(),
                    student == null ? "" : student.school(),
                    student == null ? "" : student.motherPhone(),
                    attendance.status(),
                    AttendanceTone.of(attendance.status()),
                    HomeworkGrade.of(work == null ? null : work.advance()),
                    HomeworkGrade.of(work == null ? null : work.deep()),
                    scores.get(attendance.studentCode())));
        }
        return new AttendanceSheet(classroom, date, testDate, rows);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<TngCounselRecord> counselRecords(UUID academyId, UUID accountId, LocalDate date) {
        var staffCode = staffDirectory.staff(academyId, accountId).tngStaffCode();
        return staffCode == null ? List.of() : tngGateway.counsels(staffCode, date);
    }

    /**
     * 요청한 사람의 담당 반인지 확인
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     * @param classCode 반 코드
     * @return 담당 반
     * @throws WorklogForbiddenException 담당 반이 아닐 때
     */
    private TngClassroom ownClassroom(UUID academyId, UUID accountId, String classCode) {
        return staffDirectory.staff(academyId, accountId).classrooms().stream()
                .filter(classroom -> classroom.code().equals(classCode))
                .findFirst()
                .orElseThrow(() -> new WorklogForbiddenException("담당 반의 자료만 볼 수 있습니다."));
    }
}
