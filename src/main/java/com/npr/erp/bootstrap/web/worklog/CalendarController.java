package com.npr.erp.bootstrap.web.worklog;

import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.bootstrap.web.AcademyContext;
import com.npr.erp.bootstrap.web.Guard;
import com.npr.erp.worklog.EventDraft;
import com.npr.erp.worklog.EventKind;
import com.npr.erp.worklog.TagCatalog;
import com.npr.erp.worklog.TaskBoard;
import com.npr.erp.worklog.TaskView;
import com.npr.erp.worklog.TeamCalendar;
import com.npr.erp.worklog.WorkCalendar;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * 캘린더 화면
 *
 * 업무와 일정을 기간 막대로 그림. 보이는 범위는 다른 화면과 같음: 업무 관리 권한이 있으면 전체 업무, 아니면 본인
 * 업무이고, 일정은 팀 일정과 본인의 개인일정임
 */
@Controller
@RequestMapping("/a/{academyId}")
@RequiredArgsConstructor
public class CalendarController {
    /**
     * 한 주의 날 수
     */
    private static final int DAYS = 7;

    /**
     * 권한 확인
     */
    private final Guard guard;

    /**
     * 일정
     */
    private final TeamCalendar teamCalendar;

    /**
     * 업무 원장
     */
    private final TaskBoard taskBoard;

    /**
     * 태그
     */
    private final TagCatalog tagCatalog;

    /**
     * 날짜 기준
     */
    private final WorkCalendar calendar;

    /**
     * 한 달 캘린더
     *
     * @param context 요청 문맥
     * @param month 볼 달. 없으면 이번 달
     * @param model 화면 모델
     * @return 캘린더 템플릿
     */
    @GetMapping("/calendar")
    public String month(AcademyContext context, @RequestParam(required = false) YearMonth month, Model model) {
        guard.require(context, PermissionCatalog.WORKLOG_CALENDAR_USE);
        var shown = month == null ? YearMonth.from(calendar.today()) : month;
        var first = shown.atDay(1).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        var last = shown.atEndOfMonth().with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY));

        // 보이는 범위의 업무와 일정을 막대로 바꿈
        var spans = new ArrayList<Span>();
        for (var task : visibleTasks(context)) {
            var done = task.progressOf(context.accountId()).map(progress -> progress.complete()).orElse(task.allDone());
            spans.add(new Span(
                    task.title(),
                    context.path("/tasks/" + task.id()),
                    task.archived() || done ? "task done" : "task",
                    task.tag() == null ? "" : task.tag().emoji(),
                    task.tag() == null ? "" : task.tag().color(),
                    task.startDate(),
                    task.dueDate()));
        }
        var events = teamCalendar.events(context.academyId(), context.accountId(), first, last);
        for (var event : events) {
            spans.add(new Span(
                    event.title(),
                    context.path("/calendar") + "?month=" + shown + "#event-" + event.id(),
                    event.kind() == EventKind.TEAM ? "team" : "personal",
                    event.tag() == null ? "" : event.tag().emoji(),
                    event.tag() == null ? "" : event.tag().color(),
                    event.startDate(),
                    event.endDate()));
        }

        var weeks = new ArrayList<Week>();
        for (var monday = first; !monday.isAfter(last); monday = monday.plusWeeks(1)) {
            weeks.add(weekOf(monday, spans));
        }
        model.addAttribute("month", shown);
        model.addAttribute("weeks", weeks);
        model.addAttribute("events", events);
        model.addAttribute("tags", tagCatalog.tags(context.academyId()));
        return "worklog/calendar";
    }

    /**
     * 일정 생성
     *
     * @param context 요청 문맥
     * @param kind 팀 일정인지 개인일정인지
     * @param form 입력
     * @return 일정이 시작하는 달의 캘린더
     */
    @PostMapping("/events")
    public String create(AcademyContext context, @RequestParam EventKind kind, EventForm form) {
        if (kind == EventKind.TEAM) {
            guard.require(context, PermissionCatalog.WORKLOG_EVENT_MANAGE);
            teamCalendar.createTeamEvent(context.academyId(), context.accountId(), form.toDraft());
        } else {
            guard.require(context, PermissionCatalog.WORKLOG_CALENDAR_USE);
            teamCalendar.createPersonalEvent(context.academyId(), context.accountId(), form.toDraft());
        }
        return backToMonth(context, form.startDate());
    }

    /**
     * 일정 수정 또는 삭제
     *
     * 팀 일정은 일정 관리 권한이 있어야 하고, 개인일정은 본인의 것인지를 업무일지 모듈이 확인함
     *
     * @param context 요청 문맥
     * @param eventId 일정 ID
     * @param action 수정(update) 또는 삭제(delete)
     * @param form 입력
     * @return 일정이 있던 달의 캘린더
     */
    @PostMapping("/events/{eventId}")
    public String change(
            AcademyContext context, @PathVariable UUID eventId, @RequestParam String action, EventForm form) {
        guard.require(context, PermissionCatalog.WORKLOG_CALENDAR_USE);
        var event = teamCalendar.event(context.academyId(), eventId, context.accountId());
        var delete = "delete".equals(action);
        if (event.kind() == EventKind.TEAM) {
            guard.require(context, PermissionCatalog.WORKLOG_EVENT_MANAGE);
            if (delete) {
                teamCalendar.deleteTeamEvent(context.academyId(), eventId);
            } else {
                teamCalendar.updateTeamEvent(context.academyId(), eventId, form.toDraft());
            }
        } else if (delete) {
            teamCalendar.deletePersonalEvent(context.academyId(), eventId, context.accountId());
        } else {
            teamCalendar.updatePersonalEvent(context.academyId(), eventId, context.accountId(), form.toDraft());
        }
        return backToMonth(context, delete ? event.startDate() : form.startDate());
    }

    /**
     * 요청한 사람이 볼 수 있는 업무
     *
     * @param context 요청 문맥
     * @return 관리 권한이 있으면 전체, 수행 권한만 있으면 본인 업무, 둘 다 없으면 빈 목록
     */
    private List<TaskView> visibleTasks(AcademyContext context) {
        var assignable = guard.holders(context, PermissionCatalog.WORKLOG_TASK_PERFORM);
        if (context.can(PermissionCatalog.WORKLOG_TASK_MANAGE)) {
            return taskBoard.allTasks(context.academyId(), assignable);
        }
        if (context.can(PermissionCatalog.WORKLOG_TASK_PERFORM)) {
            return taskBoard.tasksOf(context.academyId(), context.accountId(), assignable);
        }
        return List.of();
    }

    /**
     * 한 주에 걸치는 막대를 그 주의 칸 번호로 잘라 배치
     *
     * @param monday 그 주의 월요일
     * @param spans 전체 막대
     * @return 날짜 일곱 개와 그 주에 걸친 막대
     */
    private static Week weekOf(LocalDate monday, List<Span> spans) {
        var sunday = monday.plusDays(DAYS - 1);
        var days = new ArrayList<LocalDate>();
        for (var offset = 0; offset < DAYS; offset++) {
            days.add(monday.plusDays(offset));
        }
        var bars = new ArrayList<Bar>();
        for (var span : spans) {
            if (span.end().isBefore(monday) || span.start().isAfter(sunday)) {
                continue;
            }
            var from = span.start().isBefore(monday) ? monday : span.start();
            var to = span.end().isAfter(sunday) ? sunday : span.end();
            bars.add(new Bar(
                    span,
                    (int) ChronoUnit.DAYS.between(monday, from) + 1,
                    (int) ChronoUnit.DAYS.between(monday, to) + 2,
                    span.start().isBefore(monday),
                    span.end().isAfter(sunday)));
        }
        return new Week(days, bars);
    }

    /**
     * 날짜가 속한 달의 캘린더로 돌아감
     *
     * @param context 요청 문맥
     * @param date 날짜. 없으면 이번 달
     * @return 리다이렉트
     */
    private String backToMonth(AcademyContext context, LocalDate date) {
        var month = YearMonth.from(date == null ? calendar.today() : date);
        return "redirect:" + context.path("/calendar") + "?month=" + month;
    }

    /**
     * 일정 입력 폼
     *
     * @param title 제목
     * @param memo 메모
     * @param startDate 시작일
     * @param endDate 종료일
     * @param tagId 팀 일정의 태그 ID
     */
    public record EventForm(String title, String memo, LocalDate startDate, LocalDate endDate, UUID tagId) {
        /**
         * 모듈에 넘길 입력으로 변환
         *
         * @return 일정 입력
         */
        EventDraft toDraft() {
            return new EventDraft(title, memo, startDate, endDate, tagId);
        }
    }

    /**
     * 캘린더에 그릴 기간 하나
     *
     * @param title 제목
     * @param href 눌렀을 때 갈 주소
     * @param kind 모양을 정하는 종류: task, team, personal. 끝난 업무는 done이 붙음
     * @param emoji 태그 이모지
     * @param color 태그 색
     * @param start 시작일
     * @param end 종료일
     */
    public record Span(
            String title, String href, String kind, String emoji, String color, LocalDate start, LocalDate end) {
    }

    /**
     * 한 주 안에 놓인 막대
     *
     * @param span 기간
     * @param columnStart 시작 칸. 1부터
     * @param columnEnd 끝 칸의 다음 번호
     * @param continuesBefore 앞 주에서 이어지는지
     * @param continuesAfter 다음 주로 이어지는지
     */
    public record Bar(Span span, int columnStart, int columnEnd, boolean continuesBefore, boolean continuesAfter) {
    }

    /**
     * 캘린더의 한 주
     *
     * @param days 월요일부터 일요일까지
     * @param bars 그 주에 걸친 막대
     */
    public record Week(List<LocalDate> days, List<Bar> bars) {
    }
}
