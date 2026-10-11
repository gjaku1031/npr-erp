package com.npr.erp.bootstrap.web.worklog;

import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.bootstrap.web.AcademyContext;
import com.npr.erp.bootstrap.web.Guard;
import com.npr.erp.worklog.ChecklistAnswer;
import com.npr.erp.worklog.ClassroomDesk;
import com.npr.erp.worklog.DailyReports;
import com.npr.erp.worklog.JournalDesk;
import com.npr.erp.worklog.ReportInput;
import com.npr.erp.worklog.ReportPayload;
import com.npr.erp.worklog.WizardGate;
import com.npr.erp.worklog.WorkCalendar;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
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
import org.springframework.web.multipart.MultipartFile;

/**
 * 일일보고 작성 화면
 *
 * 다섯 단계를 주소의 step 값으로 오가며, 단계마다 넣은 값은 임시저장으로 서버에 남김. 제출할 수 있는지는 서버가 계산한
 * 단계별 완료 여부를 따름
 */
@Controller
@RequestMapping("/a/{academyId}/reports")
@RequiredArgsConstructor
public class ReportController {
    /**
     * 권한 확인
     */
    private final Guard guard;

    /**
     * 일일보고
     */
    private final DailyReports dailyReports;

    /**
     * 일일보고 정의
     */
    private final JournalDesk journalDesk;

    /**
     * 담당 반 자료
     */
    private final ClassroomDesk classroomDesk;

    /**
     * 날짜 기준
     */
    private final WorkCalendar calendar;

    /**
     * 내 일일보고: 오늘의 상태와 지난 보고
     *
     * @param context 요청 문맥
     * @param model 화면 모델
     * @return 내 일일보고 템플릿
     */
    @GetMapping
    public String overview(AcademyContext context, Model model) {
        guard.require(context, PermissionCatalog.WORKLOG_REPORT_WRITE);
        var today = calendar.today();
        model.addAttribute("journal", journalDesk.journal(context.academyId(), today).orElse(null));
        model.addAttribute(
                "todayReport", dailyReports.report(context.academyId(), context.accountId(), today).orElse(null));
        model.addAttribute("history", dailyReports.history(context.academyId(), context.accountId()));
        return "worklog/reports";
    }

    /**
     * 한 날짜의 작성 화면
     *
     * @param context 요청 문맥
     * @param date 날짜
     * @param step 보여 줄 단계. 1부터 5
     * @param classCode 4단계에서 고른 반
     * @param model 화면 모델
     * @return 작성 화면 템플릿
     */
    @GetMapping("/{date}")
    public String wizard(
            AcademyContext context,
            @PathVariable LocalDate date,
            @RequestParam(defaultValue = "1") int step,
            @RequestParam(name = "class", required = false) String classCode,
            Model model) {
        guard.require(context, PermissionCatalog.WORKLOG_REPORT_WRITE);
        var wizard = dailyReports.wizard(context.academyId(), context.accountId(), date, assignable(context));
        var current = Math.clamp(step, 1, WizardGate.STEPS);
        model.addAttribute("wizard", wizard);
        model.addAttribute("date", date);
        model.addAttribute("step", current);
        model.addAttribute(
                "stepNames", List.of("체크리스트", "알림장", "상담 확인", "출결 확인", "업무 확인"));

        // 단계마다 필요한 외부 자료만 읽음
        if (current == 3) {
            model.addAttribute(
                    "counselRecords", classroomDesk.counselRecords(context.academyId(), context.accountId(), date));
        }
        if (current == 4 && !wizard.classrooms().isEmpty()) {
            var selected = wizard.classrooms().stream()
                    .filter(classroom -> classroom.code().equals(classCode))
                    .findFirst()
                    .orElse(wizard.classrooms().getFirst());
            model.addAttribute("selectedClass", selected);
            model.addAttribute(
                    "sheet",
                    classroomDesk.attendance(context.academyId(), context.accountId(), selected.code(), date));
        }
        return "worklog/report";
    }

    /**
     * 한 단계에서 넣은 값을 임시저장
     *
     * 폼은 그 단계의 값만 보냄. 나머지 값은 저장돼 있던 것을 그대로 둠
     *
     * @param context 요청 문맥
     * @param date 날짜
     * @param step 값을 보낸 단계
     * @param next 저장한 뒤 보여 줄 단계
     * @param checked 1단계에서 체크한 항목 ID
     * @param confirmed 3·4단계의 확인 여부
     * @param request 요청. 항목별 확인 결과를 읽음
     * @return 작성 화면
     */
    @PostMapping("/{date}/draft")
    public String saveDraft(
            AcademyContext context,
            @PathVariable LocalDate date,
            @RequestParam int step,
            @RequestParam(required = false) Integer next,
            @RequestParam(required = false) List<UUID> checked,
            @RequestParam(defaultValue = "false") boolean confirmed,
            HttpServletRequest request) {
        guard.require(context, PermissionCatalog.WORKLOG_REPORT_WRITE);
        var saved = dailyReports.report(context.academyId(), context.accountId(), date)
                .map(report -> report.payload())
                .orElseGet(ReportPayload::empty);
        var answers = new HashMap<>(saved.checklist());
        var counselChecked = saved.counselChecked();
        var attendanceChecked = saved.attendanceChecked();
        if (step == 1) {
            answers.clear();
            var journal = journalDesk.journal(context.academyId(), date).orElseThrow();
            for (var item : journal.items()) {
                var isChecked = checked != null && checked.contains(item.id());
                var note = request.getParameter("note_" + item.id());
                answers.put(item.id(), new ChecklistAnswer(isChecked, note == null ? "" : note));
            }
        } else if (step == 3) {
            counselChecked = confirmed;
        } else if (step == 4) {
            attendanceChecked = confirmed;
        }
        dailyReports.saveDraft(
                context.academyId(),
                context.accountId(),
                date,
                new ReportInput(answers, counselChecked, attendanceChecked));
        return "redirect:" + context.path("/reports/" + date) + "?step=" + (next == null ? step : next);
    }

    /**
     * 체크리스트 항목에 파일 첨부
     *
     * @param context 요청 문맥
     * @param date 날짜
     * @param itemId 항목 ID
     * @param file 올린 파일
     * @return 작성 화면의 1단계
     * @throws IOException 올린 파일을 읽지 못했을 때
     */
    @PostMapping("/{date}/files")
    public String attach(
            AcademyContext context,
            @PathVariable LocalDate date,
            @RequestParam UUID itemId,
            @RequestParam MultipartFile file)
            throws IOException {
        guard.require(context, PermissionCatalog.WORKLOG_REPORT_WRITE);
        Uploads.requireAttachmentSize(file);
        dailyReports.attachChecklistFile(
                context.academyId(),
                context.accountId(),
                date,
                itemId,
                file.getOriginalFilename(),
                file.getContentType(),
                file.getBytes());
        return "redirect:" + context.path("/reports/" + date) + "?step=1";
    }

    /**
     * 알림장 게시
     *
     * @param context 요청 문맥
     * @param date 날짜
     * @param classCode 반 코드
     * @param title 제목
     * @param body 내용
     * @return 작성 화면의 2단계
     */
    @PostMapping("/{date}/notebook")
    public String publishNotebook(
            AcademyContext context,
            @PathVariable LocalDate date,
            @RequestParam String classCode,
            @RequestParam String title,
            @RequestParam String body) {
        guard.require(context, PermissionCatalog.WORKLOG_NOTEBOOK_WRITE);
        classroomDesk.publishNotebook(context.academyId(), context.accountId(), classCode, date, title, body);
        return "redirect:" + context.path("/reports/" + date) + "?step=2";
    }

    /**
     * 제출
     *
     * @param context 요청 문맥
     * @param date 날짜
     * @return 내 일일보고 화면
     */
    @PostMapping("/{date}/submit")
    public String submit(AcademyContext context, @PathVariable LocalDate date) {
        guard.require(context, PermissionCatalog.WORKLOG_REPORT_WRITE);
        dailyReports.submit(context.academyId(), context.accountId(), date, assignable(context));
        return "redirect:" + context.path("/reports");
    }

    /**
     * 제출 되돌리기
     *
     * @param context 요청 문맥
     * @param date 날짜
     * @return 작성 화면
     */
    @PostMapping("/{date}/reopen")
    public String reopen(AcademyContext context, @PathVariable LocalDate date) {
        guard.require(context, PermissionCatalog.WORKLOG_REPORT_WRITE);
        dailyReports.reopen(context.academyId(), context.accountId(), date);
        return "redirect:" + context.path("/reports/" + date);
    }

    /**
     * 지금의 업무 배정 후보
     *
     * @param context 요청 문맥
     * @return 업무 수행 권한을 가진 계정
     */
    private Set<UUID> assignable(AcademyContext context) {
        return guard.holders(context, PermissionCatalog.WORKLOG_TASK_PERFORM);
    }
}
