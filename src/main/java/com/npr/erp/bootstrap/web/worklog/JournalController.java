package com.npr.erp.bootstrap.web.worklog;

import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.bootstrap.web.AcademyContext;
import com.npr.erp.bootstrap.web.Guard;
import com.npr.erp.worklog.ClassroomDesk;
import com.npr.erp.worklog.DailyReports;
import com.npr.erp.worklog.JournalDesk;
import com.npr.erp.worklog.WorkCalendar;
import com.npr.erp.worklog.WorklogNotFoundException;
import java.time.LocalDate;
import java.util.Set;
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
 * 일일보고 관리 화면
 *
 * 날짜별 체크리스트를 정하는 일(정의 관리 권한)과 낸 보고를 읽고 확인하는 일(검토 권한)을 한 화면에 둠
 */
@Controller
@RequestMapping("/a/{academyId}/journals")
@RequiredArgsConstructor
public class JournalController {
    /**
     * 권한 확인
     */
    private final Guard guard;

    /**
     * 일일보고 정의
     */
    private final JournalDesk journalDesk;

    /**
     * 일일보고
     */
    private final DailyReports dailyReports;

    /**
     * 담당 반 자료
     */
    private final ClassroomDesk classroomDesk;

    /**
     * 날짜 기준
     */
    private final WorkCalendar calendar;

    /**
     * 날짜 목록과 고른 날짜의 체크리스트·제출 현황
     *
     * @param context 요청 문맥
     * @param date 고른 날짜. 없으면 오늘
     * @param model 화면 모델
     * @return 일일보고 관리 템플릿
     */
    @GetMapping
    public String overview(AcademyContext context, @RequestParam(required = false) LocalDate date, Model model) {
        guard.requireAny(
                context, PermissionCatalog.WORKLOG_JOURNAL_MANAGE, PermissionCatalog.WORKLOG_REPORT_REVIEW);
        var selected = date == null ? calendar.today() : date;
        var reporters = reporters(context);
        model.addAttribute("selected", selected);
        model.addAttribute("journals", journalDesk.journals(context.academyId(), reporters));
        model.addAttribute("journal", journalDesk.journal(context.academyId(), selected).orElse(null));
        model.addAttribute("settings", journalDesk.settings(context.academyId()));
        model.addAttribute("reporterCount", reporters.size());
        if (context.can(PermissionCatalog.WORKLOG_REPORT_REVIEW)) {
            model.addAttribute("board", dailyReports.board(context.academyId(), selected, reporters));
        }
        return "worklog/journals";
    }

    /**
     * 한 날짜의 일일보고 생성
     *
     * @param context 요청 문맥
     * @param date 날짜
     * @return 그 날짜를 고른 관리 화면
     */
    @PostMapping
    public String create(AcademyContext context, @RequestParam LocalDate date) {
        guard.require(context, PermissionCatalog.WORKLOG_JOURNAL_MANAGE);
        journalDesk.create(context.academyId(), context.accountId(), date);
        return "redirect:" + context.path("/journals") + "?date=" + date;
    }

    /**
     * 한 날짜의 일일보고 삭제
     *
     * @param context 요청 문맥
     * @param date 날짜
     * @return 관리 화면
     */
    @PostMapping("/{date}/delete")
    public String delete(AcademyContext context, @PathVariable LocalDate date) {
        guard.require(context, PermissionCatalog.WORKLOG_JOURNAL_MANAGE);
        journalDesk.delete(context.academyId(), date);
        return "redirect:" + context.path("/journals");
    }

    /**
     * 체크리스트 항목 추가
     *
     * @param context 요청 문맥
     * @param date 날짜
     * @param text 내용
     * @param required 확인 결과를 꼭 적어야 하는지
     * @return 그 날짜를 고른 관리 화면
     */
    @PostMapping("/{date}/items")
    public String addItem(
            AcademyContext context,
            @PathVariable LocalDate date,
            @RequestParam String text,
            @RequestParam(defaultValue = "false") boolean required) {
        guard.require(context, PermissionCatalog.WORKLOG_JOURNAL_MANAGE);
        journalDesk.addItem(context.academyId(), date, text, required);
        return "redirect:" + context.path("/journals") + "?date=" + date;
    }

    /**
     * 체크리스트 항목 삭제 또는 필수 여부 변경
     *
     * @param context 요청 문맥
     * @param date 날짜
     * @param itemId 항목 ID
     * @param action 삭제(delete), 필수로(require), 선택으로(relax)
     * @return 그 날짜를 고른 관리 화면
     */
    @PostMapping("/{date}/items/{itemId}")
    public String changeItem(
            AcademyContext context,
            @PathVariable LocalDate date,
            @PathVariable UUID itemId,
            @RequestParam String action) {
        guard.require(context, PermissionCatalog.WORKLOG_JOURNAL_MANAGE);
        if ("delete".equals(action)) {
            journalDesk.removeItem(context.academyId(), itemId);
        } else {
            journalDesk.setRequired(context.academyId(), itemId, "require".equals(action));
        }
        return "redirect:" + context.path("/journals") + "?date=" + date;
    }

    /**
     * 주간테스트 시행일과 특강기간 설정
     *
     * @param context 요청 문맥
     * @param weeklyTestMwf 월수금 반의 시행일
     * @param weeklyTestTts 화목토 반의 시행일
     * @param specialPeriod 특강기간인지
     * @return 관리 화면
     */
    @PostMapping("/settings")
    public String updateSettings(
            AcademyContext context,
            @RequestParam(required = false) LocalDate weeklyTestMwf,
            @RequestParam(required = false) LocalDate weeklyTestTts,
            @RequestParam(defaultValue = "false") boolean specialPeriod) {
        guard.require(context, PermissionCatalog.WORKLOG_JOURNAL_MANAGE);
        journalDesk.updateSettings(context.academyId(), weeklyTestMwf, weeklyTestTts, specialPeriod);
        return "redirect:" + context.path("/journals");
    }

    /**
     * 한 사람이 낸 보고 열람
     *
     * @param context 요청 문맥
     * @param date 날짜
     * @param accountId 작성자 계정 ID
     * @param model 화면 모델
     * @return 보고 열람 템플릿
     */
    @GetMapping("/{date}/reports/{accountId}")
    public String review(
            AcademyContext context, @PathVariable LocalDate date, @PathVariable UUID accountId, Model model) {
        guard.require(context, PermissionCatalog.WORKLOG_REPORT_REVIEW);
        var report = dailyReports.report(context.academyId(), accountId, date)
                .orElseThrow(() -> new WorklogNotFoundException("REPORT_NOT_FOUND", "보고를 찾을 수 없습니다."));
        model.addAttribute("report", report);
        model.addAttribute("journal", journalDesk.journal(context.academyId(), date).orElseThrow());
        model.addAttribute("files", dailyReports.checklistFiles(context.academyId(), accountId, date));
        model.addAttribute("counselRecords", classroomDesk.counselRecords(context.academyId(), accountId, date));
        return "worklog/report-review";
    }

    /**
     * 제출된 보고를 확인 처리
     *
     * @param context 요청 문맥
     * @param date 날짜
     * @param accountId 작성자 계정 ID
     * @return 그 날짜를 고른 관리 화면
     */
    @PostMapping("/{date}/reports/{accountId}/confirm")
    public String confirm(AcademyContext context, @PathVariable LocalDate date, @PathVariable UUID accountId) {
        guard.require(context, PermissionCatalog.WORKLOG_REPORT_REVIEW);
        dailyReports.confirm(context.academyId(), accountId, date, context.accountId());
        return "redirect:" + context.path("/journals") + "?date=" + date;
    }

    /**
     * 지금의 보고 대상
     *
     * @param context 요청 문맥
     * @return 일일보고 작성 권한을 가진 계정
     */
    private Set<UUID> reporters(AcademyContext context) {
        return guard.holders(context, PermissionCatalog.WORKLOG_REPORT_WRITE);
    }
}
