package com.npr.erp.bootstrap.web.worklog;

import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.bootstrap.web.AcademyContext;
import com.npr.erp.bootstrap.web.Guard;
import com.npr.erp.worklog.DailyReports;
import com.npr.erp.worklog.JournalDesk;
import com.npr.erp.worklog.NoticeBoard;
import com.npr.erp.worklog.ReportState;
import com.npr.erp.worklog.TaskBoard;
import com.npr.erp.worklog.TaskView;
import com.npr.erp.worklog.TeamCalendar;
import com.npr.erp.worklog.WorkCalendar;
import java.time.LocalDate;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * 학원 홈
 *
 * 한 화면을 가진 권한에 따라 다르게 채움. 업무를 관리하는 사람에게는 전체 진행과 제출 현황을, 업무를 받는 사람에게는
 * 본인의 할 일을 보여 줌
 */
@Controller
@RequiredArgsConstructor
public class DashboardController {
    /**
     * 마감 임박으로 보는 남은 날 수
     */
    private static final int DUE_SOON_DAYS = 2;

    /**
     * 홈에 보여 주는 다가오는 일정의 기간
     */
    private static final int UPCOMING_DAYS = 14;

    /**
     * 권한 확인
     */
    private final Guard guard;

    /**
     * 업무 원장
     */
    private final TaskBoard taskBoard;

    /**
     * 일일보고
     */
    private final DailyReports dailyReports;

    /**
     * 일일보고 정의
     */
    private final JournalDesk journalDesk;

    /**
     * 공지
     */
    private final NoticeBoard noticeBoard;

    /**
     * 일정
     */
    private final TeamCalendar teamCalendar;

    /**
     * 날짜 기준
     */
    private final WorkCalendar calendar;

    /**
     * 학원 홈 화면
     *
     * @param context 요청 문맥
     * @param model 화면 모델
     * @return 홈 템플릿
     */
    @GetMapping("/a/{academyId}")
    public String dashboard(AcademyContext context, Model model) {
        var today = calendar.today();
        var academyId = context.academyId();
        var assignable = guard.holders(context, PermissionCatalog.WORKLOG_TASK_PERFORM);

        // 관리하는 사람: 전체 업무 진행과 마감 임박
        if (context.can(PermissionCatalog.WORKLOG_TASK_MANAGE)) {
            var active = taskBoard.allTasks(academyId, assignable).stream()
                    .filter(task -> !task.archived())
                    .toList();
            model.addAttribute("teamTasks", active);
            model.addAttribute("teamDueSoon", dueSoon(active, today.plusDays(DUE_SOON_DAYS)).stream()
                    .filter(task -> !task.allDone())
                    .toList());
        }

        // 보고를 검토하는 사람: 오늘의 제출 현황
        if (context.can(PermissionCatalog.WORKLOG_REPORT_REVIEW)) {
            var board = dailyReports.board(
                    academyId, today, guard.holders(context, PermissionCatalog.WORKLOG_REPORT_WRITE));
            model.addAttribute("board", board);
            model.addAttribute("boardWaiting", board.stream()
                    .filter(entry -> entry.state() == ReportState.WAITING)
                    .count());
            model.addAttribute("boardMissing", board.stream()
                    .filter(entry -> entry.state() == ReportState.NOT_SUBMITTED)
                    .count());
        }

        // 업무를 받는 사람: 본인의 남은 업무
        if (context.can(PermissionCatalog.WORKLOG_TASK_PERFORM)) {
            var mine = taskBoard.tasksOf(academyId, context.accountId(), assignable).stream()
                    .filter(task -> !task.archived())
                    .filter(task -> task.progressOf(context.accountId())
                            .map(progress -> !progress.complete())
                            .orElse(false))
                    .toList();
            model.addAttribute("myTasks", mine);
            model.addAttribute("myDueSoon", dueSoon(mine, today.plusDays(DUE_SOON_DAYS)));
        }

        // 보고를 쓰는 사람: 오늘 보고의 상태
        if (context.can(PermissionCatalog.WORKLOG_REPORT_WRITE)) {
            model.addAttribute("journalReady", journalDesk.journal(academyId, today).isPresent());
            model.addAttribute("myReportState", dailyReports.report(academyId, context.accountId(), today)
                    .map(report -> report.state())
                    .orElse(ReportState.NOT_SUBMITTED));
        }
        if (context.can(PermissionCatalog.WORKLOG_NOTICE_MANAGE)) {
            model.addAttribute("notices", noticeBoard.activeNotices(academyId).stream().limit(2).toList());
        }
        if (context.can(PermissionCatalog.WORKLOG_CALENDAR_USE)) {
            model.addAttribute(
                    "upcoming",
                    teamCalendar.events(academyId, context.accountId(), today, today.plusDays(UPCOMING_DAYS)));
        }
        return "dashboard";
    }

    /**
     * 기준 날짜까지 마감인 업무
     *
     * @param tasks 업무 목록
     * @param until 기준 날짜
     * @return 마감일이 기준 날짜 이하인 업무
     */
    private static List<TaskView> dueSoon(List<TaskView> tasks, LocalDate until) {
        return tasks.stream().filter(task -> !task.dueDate().isAfter(until)).toList();
    }
}
