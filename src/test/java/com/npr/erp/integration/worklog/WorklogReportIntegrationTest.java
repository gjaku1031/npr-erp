package com.npr.erp.integration.worklog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.npr.erp.integration.IntegrationTest;
import com.npr.erp.worklog.ChecklistAnswer;
import com.npr.erp.worklog.ClassroomDesk;
import com.npr.erp.worklog.DailyReports;
import com.npr.erp.worklog.EventDraft;
import com.npr.erp.worklog.EventView;
import com.npr.erp.worklog.JournalDesk;
import com.npr.erp.worklog.JournalItemView;
import com.npr.erp.worklog.JournalPhase;
import com.npr.erp.worklog.NoticeBoard;
import com.npr.erp.worklog.NoticeView;
import com.npr.erp.worklog.ReportBoardEntry;
import com.npr.erp.worklog.ReportInput;
import com.npr.erp.worklog.ReportState;
import com.npr.erp.worklog.ReportStatus;
import com.npr.erp.worklog.TaskBoard;
import com.npr.erp.worklog.TaskDraft;
import com.npr.erp.worklog.TaskKind;
import com.npr.erp.worklog.TeamCalendar;
import com.npr.erp.worklog.WorklogForbiddenException;
import java.util.HashMap;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 일일보고 정의, 제출 조건, 상태 전이, 공지, 일정 검사
 */
@IntegrationTest
class WorklogReportIntegrationTest extends WorklogIntegrationSupport {
    /**
     * 일일보고 정의
     */
    @Autowired
    private JournalDesk journalDesk;

    /**
     * 일일보고 작성과 제출
     */
    @Autowired
    private DailyReports dailyReports;

    /**
     * 담당 반 자료
     */
    @Autowired
    private ClassroomDesk classroomDesk;

    /**
     * 업무 원장
     */
    @Autowired
    private TaskBoard taskBoard;

    /**
     * 공지
     */
    @Autowired
    private NoticeBoard noticeBoard;

    /**
     * 일정
     */
    @Autowired
    private TeamCalendar teamCalendar;

    /**
     * 새 일일보고가 오늘의 항목을 복사하고, 같은 날짜를 다시 만들어도 그대로인지 확인
     */
    @Test
    void journalCopiesItemsFromToday() {
        journalDesk.create(academyId, leadId, today);
        journalDesk.addItem(academyId, today, "교실 정리", true);
        journalDesk.addItem(academyId, today, "숙제 검사", false);

        var tomorrow = journalDesk.create(academyId, leadId, today.plusDays(1));
        var again = journalDesk.create(academyId, leadId, today.plusDays(1));

        assertThat(tomorrow.phase()).isEqualTo(JournalPhase.UPCOMING);
        assertThat(tomorrow.items()).extracting(JournalItemView::text).containsExactly("교실 정리", "숙제 검사");
        assertThat(tomorrow.items()).extracting(JournalItemView::required).containsExactly(true, false);
        assertThat(again.items()).extracting(JournalItemView::id)
                .containsExactlyElementsOf(tomorrow.items().stream().map(JournalItemView::id).toList());
    }

    /**
     * 지난 날짜의 일일보고는 고칠 수 없는지 확인
     */
    @Test
    void pastJournalIsImmutable() {
        var yesterday = today.minusDays(1);
        journalDesk.create(academyId, leadId, yesterday);

        assertThatThrownBy(() -> journalDesk.addItem(academyId, yesterday, "뒤늦은 항목", false))
                .satisfies(code("JOURNAL_PAST"));
    }

    /**
     * 일일보고를 만들 때의 특강기간이 고정되는지 확인
     */
    @Test
    void journalKeepsSpecialPeriodFromCreation() {
        journalDesk.updateSettings(academyId, null, null, true);
        journalDesk.create(academyId, leadId, today);
        journalDesk.updateSettings(academyId, null, null, false);

        assertThat(journalDesk.journal(academyId, today).orElseThrow().specialPeriod()).isTrue();
        assertThat(journalDesk.create(academyId, leadId, today.plusDays(1)).specialPeriod()).isFalse();
    }

    /**
     * 다섯 단계를 모두 마치기 전에는 제출이 거부되고, 마친 뒤에는 받는지 확인
     */
    @Test
    void submitNeedsEveryGate() {
        prepareJournal();
        var task = taskBoard.create(academyId, leadId, generalTask(), teachers);

        assertThatThrownBy(() -> dailyReports.submit(academyId, teacherA, today, teachers))
                .satisfies(code("REPORT_GATE_OPEN"));

        completeSteps(teacherA);
        // 일반 업무를 표시하지 않으면 5단계가 열려 있음
        assertThat(dailyReports.wizard(academyId, teacherA, today, teachers).gate().openSteps())
                .containsExactly("업무 확인");
        taskBoard.markStatus(academyId, task.id(), teacherA, teachers, false);

        var report = dailyReports.submit(academyId, teacherA, today, teachers);

        assertThat(report.status()).isEqualTo(ReportStatus.SUBMITTED);
        assertThat(report.payload().tasks()).singleElement()
                .satisfies(mark -> assertThat(mark.taskId()).isEqualTo(task.id()));
    }

    /**
     * 필수 항목은 체크만으로는 부족하고 확인 결과가 있어야 하는지 확인
     */
    @Test
    void requiredItemNeedsNote() {
        var journal = prepareJournal();
        var answers = new HashMap<UUID, ChecklistAnswer>();
        for (var item : journal) {
            answers.put(item.id(), new ChecklistAnswer(true, ""));
        }
        dailyReports.saveDraft(academyId, teacherA, today, new ReportInput(answers, true, true));

        assertThat(dailyReports.wizard(academyId, teacherA, today, teachers).gate().checklist()).isFalse();
    }

    /**
     * 작성 중 → 제출 → 확인의 순서와 되돌리기 규칙이 지켜지는지 확인
     */
    @Test
    void reportStateTransitions() {
        prepareJournal();
        completeSteps(teacherA);

        // 제출 전에는 확인할 수 없음
        assertThatThrownBy(() -> dailyReports.confirm(academyId, teacherA, today, leadId))
                .satisfies(code("REPORT_NOT_SUBMITTED"));

        dailyReports.submit(academyId, teacherA, today, teachers);
        // 제출한 보고는 되돌리기 전에는 고칠 수 없음
        assertThatThrownBy(() -> dailyReports.saveDraft(
                        academyId, teacherA, today, new ReportInput(new HashMap<>(), false, false)))
                .satisfies(code("REPORT_SUBMITTED"));

        dailyReports.reopen(academyId, teacherA, today);
        dailyReports.submit(academyId, teacherA, today, teachers);
        dailyReports.confirm(academyId, teacherA, today, leadId);

        assertThat(dailyReports.report(academyId, teacherA, today).orElseThrow().state())
                .isEqualTo(ReportState.CONFIRMED);
        // 확인이 끝나면 되돌릴 수 없음
        assertThatThrownBy(() -> dailyReports.reopen(academyId, teacherA, today))
                .satisfies(code("REPORT_CONFIRMED"));
    }

    /**
     * 제출 현황판이 보고 대상 전원을 상태와 함께 보여 주는지 확인
     */
    @Test
    void boardShowsEveryReporter() {
        prepareJournal();
        completeSteps(teacherA);
        dailyReports.submit(academyId, teacherA, today, teachers);

        var board = dailyReports.board(academyId, today, teachers);

        assertThat(board).hasSize(2);
        assertThat(board).filteredOn(entry -> entry.accountId().equals(teacherA))
                .extracting(ReportBoardEntry::state)
                .containsExactly(ReportState.WAITING);
        assertThat(board).filteredOn(entry -> entry.accountId().equals(teacherB))
                .extracting(ReportBoardEntry::state)
                .containsExactly(ReportState.NOT_SUBMITTED);
        assertThat(journalDesk.journals(academyId, teachers).getFirst().submittedCount()).isEqualTo(1);
    }

    /**
     * 제출한 뒤에 담당 반이 바뀌어도 낸 보고의 반 목록은 그대로인지 확인
     */
    @Test
    void submittedReportKeepsClassroomSnapshot() {
        prepareJournal();
        completeSteps(teacherA);
        var submitted = dailyReports.submit(academyId, teacherA, today, teachers);

        staffDirectory.linkTngStaff(academyId, teacherA, "S03");
        staffDirectory.syncClassrooms(academyId, teacherA);

        var wizard = dailyReports.wizard(academyId, teacherA, today, teachers);
        assertThat(wizard.editable()).isFalse();
        assertThat(wizard.classrooms()).isEqualTo(submitted.payload().classrooms());
    }

    /**
     * 제출한 보고의 체크리스트 첨부는 지울 수 없고, 제출을 되돌리면 지울 수 있는지 확인
     */
    @Test
    void submittedReportKeepsChecklistAttachments() {
        var item = prepareJournal().getFirst();
        var file = dailyReports.attachChecklistFile(
                academyId, teacherA, today, item.id(), "확인.png", "image/png", new byte[] {1, 2});
        completeSteps(teacherA);
        dailyReports.submit(academyId, teacherA, today, teachers);

        assertThatThrownBy(() -> taskBoard.removeAttachment(academyId, file.id(), teacherA))
                .satisfies(code("REPORT_SUBMITTED"));

        dailyReports.reopen(academyId, teacherA, today);
        taskBoard.removeAttachment(academyId, file.id(), teacherA);

        assertThat(dailyReports.checklistFiles(academyId, teacherA, today)).isEmpty();
    }

    /**
     * 일일보고를 지우면 그 날짜에 낸 보고도 함께 지워지는지 확인
     */
    @Test
    void deletingJournalRemovesReports() {
        prepareJournal();
        completeSteps(teacherA);
        dailyReports.submit(academyId, teacherA, today, teachers);

        journalDesk.delete(academyId, today);

        assertThat(journalDesk.journal(academyId, today)).isEmpty();
        assertThat(dailyReports.report(academyId, teacherA, today)).isEmpty();
    }

    /**
     * 출결표가 담당 반에만 열리고 학생별 줄을 채우는지 확인
     */
    @Test
    void attendanceIsLimitedToOwnClassrooms() {
        var own = staffDirectory.staff(academyId, teacherA).classrooms().getFirst();
        var others = staffDirectory.staff(academyId, teacherB).classrooms().getFirst();
        journalDesk.updateSettings(academyId, today.minusDays(2), today.minusDays(1), false);
        // 그 반의 수업이 있는 가장 가까운 날짜를 고름
        var classDay = today;
        while (!own.dayGroup().includes(classDay.getDayOfWeek())) {
            classDay = classDay.plusDays(1);
        }

        var sheet = classroomDesk.attendance(academyId, teacherA, own.code(), classDay);

        assertThat(sheet.rows()).isNotEmpty();
        assertThat(sheet.weeklyTestDate()).isNotNull();
        assertThat(sheet.rows()).allSatisfy(row -> assertThat(row.score()).isNotNull());
        assertThatThrownBy(() -> classroomDesk.attendance(academyId, teacherA, others.code(), today))
                .isInstanceOf(WorklogForbiddenException.class);
        assertThatThrownBy(() -> classroomDesk.publishNotebook(academyId, teacherA, others.code(), today, "제목", "내용"))
                .isInstanceOf(WorklogForbiddenException.class);
    }

    /**
     * 새 공지가 맨 위에 놓이고, 순서 이동과 숨기기가 반영되는지 확인
     */
    @Test
    void noticesKeepOrderAndVisibility() {
        var first = noticeBoard.create(academyId, leadId, "첫 공지");
        var second = noticeBoard.create(academyId, leadId, "둘째 공지");
        assertThat(noticeBoard.notices(academyId)).extracting(NoticeView::id).containsExactly(second.id(), first.id());

        noticeBoard.move(academyId, first.id(), true);
        noticeBoard.setActive(academyId, second.id(), false);

        assertThat(noticeBoard.notices(academyId)).extracting(NoticeView::id).containsExactly(first.id(), second.id());
        assertThat(noticeBoard.activeNotices(academyId)).extracting(NoticeView::id).containsExactly(first.id());
    }

    /**
     * 팀 일정은 모두에게, 개인일정은 만든 사람에게만 보이고 본인만 고칠 수 있는지 확인
     */
    @Test
    void personalEventIsVisibleToOwnerOnly() {
        var draft = new EventDraft("개인 약속", "", today, today.plusDays(1), null);
        var personal = teamCalendar.createPersonalEvent(academyId, teacherA, draft);
        var team = teamCalendar.createTeamEvent(
                academyId, leadId, new EventDraft("학부모 설명회", "", today, today, tag("행사").id()));

        assertThat(teamCalendar.events(academyId, teacherA, today.minusDays(7), today.plusDays(7)))
                .extracting(EventView::id)
                .containsExactlyInAnyOrder(personal.id(), team.id());
        assertThat(teamCalendar.events(academyId, teacherB, today.minusDays(7), today.plusDays(7)))
                .extracting(EventView::id)
                .containsExactly(team.id());
        assertThat(team.tag().name()).isEqualTo("행사");
        assertThatThrownBy(() -> teamCalendar.updatePersonalEvent(academyId, personal.id(), teacherB, draft))
                .isInstanceOf(WorklogForbiddenException.class);
        assertThatThrownBy(() -> teamCalendar.event(academyId, personal.id(), teacherB))
                .isInstanceOf(WorklogForbiddenException.class);
    }

    /**
     * 오늘의 일일보고와 항목 두 개(하나는 필수) 준비
     *
     * @return 만든 항목
     */
    private List<JournalItemView> prepareJournal() {
        journalDesk.create(academyId, leadId, today);
        journalDesk.addItem(academyId, today, "교실 정리", true);
        return journalDesk.addItem(academyId, today, "숙제 검사", false).items();
    }

    /**
     * 업무 확인을 뺀 네 단계를 마침
     *
     * 체크리스트를 채우고, 그날 처리할 반마다 알림장을 게시하고, 상담과 출결을 확인으로 표시함
     *
     * @param accountId 작성자 계정 ID
     */
    private void completeSteps(UUID accountId) {
        var wizard = dailyReports.wizard(academyId, accountId, today, teachers);
        var answers = new HashMap<UUID, ChecklistAnswer>();
        for (var item : wizard.journal().items()) {
            answers.put(item.id(), new ChecklistAnswer(true, "확인함"));
        }
        dailyReports.saveDraft(academyId, accountId, today, new ReportInput(answers, true, true));
        for (var classroom : wizard.classrooms()) {
            classroomDesk.publishNotebook(academyId, accountId, classroom.code(), today, "오늘의 알림장", "숙제 안내");
        }
    }

    /**
     * 오늘이 기간에 드는 전원 배정 일반 업무 입력 생성
     *
     * @return 업무 입력
     */
    private TaskDraft generalTask() {
        return new TaskDraft(
                "오늘 할 일",
                "",
                tag("행정").id(),
                today,
                today,
                TaskKind.GENERAL,
                true,
                null,
                false,
                false,
                List.of());
    }
}
