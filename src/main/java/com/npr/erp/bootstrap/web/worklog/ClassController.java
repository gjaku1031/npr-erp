package com.npr.erp.bootstrap.web.worklog;

import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.bootstrap.web.AcademyContext;
import com.npr.erp.bootstrap.web.Guard;
import com.npr.erp.worklog.ClassroomDesk;
import com.npr.erp.worklog.TaskBoard;
import com.npr.erp.worklog.WorkCalendar;
import com.npr.erp.worklog.WorklogStaffDirectory;
import java.time.LocalDate;
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
 * 내 반 화면
 *
 * 일일보고와 상관없이 본인 담당 반의 알림장과 출결을 보고, 본인 반을 직접 가져오거나 개인 상담일정을 만듦. 일일보고를
 * 쓰지 않는 다른 팀 사람이 주로 씀
 */
@Controller
@RequestMapping("/a/{academyId}/classes")
@RequiredArgsConstructor
public class ClassController {
    /**
     * 권한 확인
     */
    private final Guard guard;

    /**
     * 직원 설정
     */
    private final WorklogStaffDirectory staffDirectory;

    /**
     * 담당 반 자료
     */
    private final ClassroomDesk classroomDesk;

    /**
     * 업무 원장
     */
    private final TaskBoard taskBoard;

    /**
     * 날짜 기준
     */
    private final WorkCalendar calendar;

    /**
     * 담당 반 목록과 고른 반의 알림장·출결
     *
     * @param context 요청 문맥
     * @param classCode 고른 반. 없으면 첫 반
     * @param date 볼 날짜. 없으면 오늘
     * @param model 화면 모델
     * @return 내 반 템플릿
     */
    @GetMapping
    public String overview(
            AcademyContext context,
            @RequestParam(name = "class", required = false) String classCode,
            @RequestParam(required = false) LocalDate date,
            Model model) {
        guard.requireAny(
                context, PermissionCatalog.WORKLOG_NOTEBOOK_WRITE, PermissionCatalog.WORKLOG_SELFCLASS_MANAGE);
        var shown = date == null ? calendar.today() : date;
        var staff = staffDirectory.staff(context.academyId(), context.accountId());
        model.addAttribute("staff", staff);
        model.addAttribute("date", shown);
        if (context.can(PermissionCatalog.WORKLOG_SELFCLASS_MANAGE)) {
            model.addAttribute(
                    "selfCounselTasks", taskBoard.selfCounselTasks(context.academyId(), context.accountId()));
        }
        if (!staff.classrooms().isEmpty() && context.can(PermissionCatalog.WORKLOG_NOTEBOOK_WRITE)) {
            var selected = staff.classrooms().stream()
                    .filter(classroom -> classroom.code().equals(classCode))
                    .findFirst()
                    .orElse(staff.classrooms().getFirst());
            model.addAttribute("selectedClass", selected);
            model.addAttribute(
                    "notebook",
                    classroomDesk.notebook(context.academyId(), context.accountId(), selected.code(), shown)
                            .orElse(null));
            model.addAttribute(
                    "sheet",
                    classroomDesk.attendance(context.academyId(), context.accountId(), selected.code(), shown));
        }
        return "worklog/classes";
    }

    /**
     * 본인 담당 반을 외부 시스템에서 다시 가져옴
     *
     * @param context 요청 문맥
     * @return 내 반 화면
     */
    @PostMapping("/sync")
    public String sync(AcademyContext context) {
        guard.require(context, PermissionCatalog.WORKLOG_SELFCLASS_MANAGE);
        staffDirectory.syncClassrooms(context.academyId(), context.accountId());
        return "redirect:" + context.path("/classes");
    }

    /**
     * 알림장 게시 또는 수정
     *
     * @param context 요청 문맥
     * @param classCode 반 코드
     * @param date 날짜
     * @param title 제목
     * @param body 내용
     * @return 그 반과 날짜를 고른 내 반 화면
     */
    @PostMapping("/{classCode}/notebook")
    public String publishNotebook(
            AcademyContext context,
            @PathVariable String classCode,
            @RequestParam LocalDate date,
            @RequestParam String title,
            @RequestParam String body) {
        guard.require(context, PermissionCatalog.WORKLOG_NOTEBOOK_WRITE);
        classroomDesk.publishNotebook(context.academyId(), context.accountId(), classCode, date, title, body);
        return "redirect:" + context.path("/classes") + "?class=" + classCode + "&date=" + date;
    }

    /**
     * 개인 상담일정 생성
     *
     * @param context 요청 문맥
     * @param title 이름
     * @param startDate 시작일
     * @param dueDate 마감일
     * @return 만든 상담일정의 상세 화면
     */
    @PostMapping("/self-counsel")
    public String createSelfCounsel(
            AcademyContext context,
            @RequestParam String title,
            @RequestParam LocalDate startDate,
            @RequestParam LocalDate dueDate) {
        guard.require(context, PermissionCatalog.WORKLOG_SELFCLASS_MANAGE);
        var task = taskBoard.createSelfCounsel(context.academyId(), context.accountId(), title, startDate, dueDate);
        return "redirect:" + context.path("/tasks/" + task.id());
    }

    /**
     * 개인 상담일정 삭제
     *
     * 본인이 만든 상담일정인지는 업무일지 모듈이 확인함
     *
     * @param context 요청 문맥
     * @param taskId 상담일정 ID
     * @return 내 반 화면
     */
    @PostMapping("/self-counsel/{taskId}/delete")
    public String deleteSelfCounsel(AcademyContext context, @PathVariable UUID taskId) {
        guard.require(context, PermissionCatalog.WORKLOG_SELFCLASS_MANAGE);
        taskBoard.deleteSelfCounsel(context.academyId(), taskId, context.accountId());
        return "redirect:" + context.path("/classes");
    }
}
