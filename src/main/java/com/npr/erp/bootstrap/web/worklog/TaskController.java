package com.npr.erp.bootstrap.web.worklog;

import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.bootstrap.web.AcademyContext;
import com.npr.erp.bootstrap.web.Guard;
import com.npr.erp.bootstrap.web.Redirects;
import com.npr.erp.tng.TngDayGroup;
import com.npr.erp.worklog.CounselDesk;
import com.npr.erp.worklog.TagCatalog;
import com.npr.erp.worklog.TaskBoard;
import com.npr.erp.worklog.TaskDraft;
import com.npr.erp.worklog.TaskKind;
import com.npr.erp.worklog.TaskLink;
import com.npr.erp.worklog.TaskView;
import com.npr.erp.worklog.WorkCalendar;
import com.npr.erp.worklog.WorklogNotFoundException;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.multipart.MultipartFile;

/**
 * 업무 화면
 *
 * 같은 주소가 두 가지 모습을 가짐. 업무 관리 권한이 있으면 전체 업무와 담당자 전원의 진행을, 업무 수행 권한만 있으면
 * 본인에게 배정된 업무와 본인의 보고만 봄
 */
@Controller
@RequestMapping("/a/{academyId}")
@RequiredArgsConstructor
public class TaskController {
    /**
     * 권한 확인
     */
    private final Guard guard;

    /**
     * 업무 원장
     */
    private final TaskBoard taskBoard;

    /**
     * 상담 처리
     */
    private final CounselDesk counselDesk;

    /**
     * 태그
     */
    private final TagCatalog tagCatalog;

    /**
     * 날짜 기준
     */
    private final WorkCalendar calendar;

    /**
     * 업무 목록
     *
     * @param context 요청 문맥
     * @param view 전체 업무를 볼지(all) 내 업무를 볼지(mine). 없으면 권한에 맞는 쪽
     * @param filter 진행 중(active), 완료(done), 보관(archived)
     * @param model 화면 모델
     * @return 업무 목록 템플릿
     */
    @GetMapping("/tasks")
    public String list(
            AcademyContext context,
            @RequestParam(required = false) String view,
            @RequestParam(defaultValue = "active") String filter,
            Model model) {
        var manages = context.can(PermissionCatalog.WORKLOG_TASK_MANAGE);
        var showAll = manages && !"mine".equals(view);
        List<TaskView> tasks;
        if (showAll) {
            guard.require(context, PermissionCatalog.WORKLOG_TASK_MANAGE);
            tasks = taskBoard.allTasks(context.academyId(), assignable(context));
        } else {
            guard.require(context, PermissionCatalog.WORKLOG_TASK_PERFORM);
            tasks = taskBoard.tasksOf(context.academyId(), context.accountId(), assignable(context));
        }

        // 내 업무에서는 본인의 완료 여부로, 전체 업무에서는 담당자 전원의 완료 여부로 나눔
        var me = context.accountId();
        var filtered = tasks.stream()
                .filter(task -> {
                    var done = showAll
                            ? task.allDone()
                            : task.progressOf(me).map(progress -> progress.complete()).orElse(false);
                    return switch (filter) {
                        case "archived" -> task.archived();
                        case "done" -> !task.archived() && done;
                        default -> !task.archived() && !done;
                    };
                })
                .toList();
        model.addAttribute("tasks", filtered);
        model.addAttribute("showAll", showAll);
        model.addAttribute("filter", filter);
        return "worklog/tasks";
    }

    /**
     * 새 업무 입력 화면
     *
     * @param context 요청 문맥
     * @param date 달력에서 고른 날짜. 없으면 오늘
     * @param model 화면 모델
     * @return 업무 입력 템플릿
     */
    @GetMapping("/tasks/new")
    public String createForm(AcademyContext context, @RequestParam(required = false) LocalDate date, Model model) {
        guard.require(context, PermissionCatalog.WORKLOG_TASK_MANAGE);
        var start = date == null ? calendar.today() : date;
        model.addAttribute("task", null);
        model.addAttribute("startDate", start);
        model.addAttribute("dueDate", start);
        populateForm(context, model);
        return "worklog/task-form";
    }

    /**
     * 업무 생성
     *
     * @param context 요청 문맥
     * @param form 입력
     * @return 만든 업무의 상세 화면
     */
    @PostMapping("/tasks")
    public String create(AcademyContext context, TaskForm form) {
        guard.require(context, PermissionCatalog.WORKLOG_TASK_MANAGE);
        var task = taskBoard.create(context.academyId(), context.accountId(), form.toDraft(), assignable(context));
        return "redirect:" + context.path("/tasks/" + task.id());
    }

    /**
     * 업무 상세
     *
     * @param context 요청 문맥
     * @param taskId 업무 ID
     * @param model 화면 모델
     * @return 업무 상세 템플릿
     */
    @GetMapping("/tasks/{taskId}")
    public String detail(AcademyContext context, @PathVariable UUID taskId, Model model) {
        var task = visibleTask(context, taskId);
        var mine = task.progressOf(context.accountId()).orElse(null);
        model.addAttribute("task", task);
        model.addAttribute("mine", mine);
        model.addAttribute("manages", task.kind() != TaskKind.SELF_COUNSEL
                && context.can(PermissionCatalog.WORKLOG_TASK_MANAGE));

        // 상담 업무의 담당자에게는 본인의 상담 대상과 명단을 가져올 반을 보여 줌
        if (mine != null && task.kind().counsel() && context.can(PermissionCatalog.WORKLOG_COUNSEL_WRITE)) {
            model.addAttribute("entries", counselDesk.entries(context.academyId(), taskId, context.accountId()));
            model.addAttribute(
                    "rosterClassrooms", counselDesk.rosterClassrooms(context.academyId(), taskId, context.accountId()));
        }
        return "worklog/task";
    }

    /**
     * 업무 수정 화면
     *
     * @param context 요청 문맥
     * @param taskId 업무 ID
     * @param model 화면 모델
     * @return 업무 입력 템플릿
     */
    @GetMapping("/tasks/{taskId}/edit")
    public String editForm(AcademyContext context, @PathVariable UUID taskId, Model model) {
        var task = managedTask(context, taskId);
        model.addAttribute("task", task);
        model.addAttribute("startDate", task.startDate());
        model.addAttribute("dueDate", task.dueDate());
        populateForm(context, model);
        return "worklog/task-form";
    }

    /**
     * 업무 수정
     *
     * @param context 요청 문맥
     * @param taskId 업무 ID
     * @param form 입력
     * @return 업무 상세 화면
     */
    @PostMapping("/tasks/{taskId}")
    public String update(AcademyContext context, @PathVariable UUID taskId, TaskForm form) {
        managedTask(context, taskId);
        taskBoard.update(context.academyId(), taskId, form.toDraft(), assignable(context));
        return "redirect:" + context.path("/tasks/" + taskId);
    }

    /**
     * 업무 삭제
     *
     * @param context 요청 문맥
     * @param taskId 업무 ID
     * @return 업무 목록
     */
    @PostMapping("/tasks/{taskId}/delete")
    public String delete(AcademyContext context, @PathVariable UUID taskId) {
        managedTask(context, taskId);
        taskBoard.delete(context.academyId(), taskId);
        return "redirect:" + context.path("/tasks");
    }

    /**
     * 업무 보관 또는 보관 해제
     *
     * @param context 요청 문맥
     * @param taskId 업무 ID
     * @param archived 보관할지
     * @param request 요청
     * @return 이전 화면
     */
    @PostMapping("/tasks/{taskId}/archive")
    public String archive(
            AcademyContext context,
            @PathVariable UUID taskId,
            @RequestParam boolean archived,
            HttpServletRequest request) {
        managedTask(context, taskId);
        taskBoard.setArchived(context.academyId(), taskId, archived);
        return Redirects.back(request, context.path("/tasks"));
    }

    /**
     * 일반 업무를 완료 또는 미완료로 표시
     *
     * @param context 요청 문맥
     * @param taskId 업무 ID
     * @param done 완료로 표시할지
     * @param request 요청
     * @return 이전 화면
     */
    @PostMapping("/tasks/{taskId}/status")
    public String markStatus(
            AcademyContext context,
            @PathVariable UUID taskId,
            @RequestParam boolean done,
            HttpServletRequest request) {
        guard.require(context, PermissionCatalog.WORKLOG_TASK_PERFORM);
        taskBoard.markStatus(context.academyId(), taskId, context.accountId(), assignable(context), done);
        return Redirects.back(request, context.path("/tasks/" + taskId));
    }

    /**
     * MT 업무의 요일 묶음 체크
     *
     * @param context 요청 문맥
     * @param taskId 업무 ID
     * @param part 월수금 또는 화목토
     * @param done 체크할지
     * @param request 요청
     * @return 이전 화면
     */
    @PostMapping("/tasks/{taskId}/mt")
    public String toggleMt(
            AcademyContext context,
            @PathVariable UUID taskId,
            @RequestParam TngDayGroup part,
            @RequestParam boolean done,
            HttpServletRequest request) {
        guard.require(context, PermissionCatalog.WORKLOG_TASK_PERFORM);
        taskBoard.toggleMt(context.academyId(), taskId, context.accountId(), assignable(context), part, done);
        return Redirects.back(request, context.path("/tasks/" + taskId));
    }

    /**
     * 텍스트 보고 저장
     *
     * @param context 요청 문맥
     * @param taskId 업무 ID
     * @param text 보고 내용
     * @return 업무 상세 화면
     */
    @PostMapping("/tasks/{taskId}/report")
    public String saveReport(AcademyContext context, @PathVariable UUID taskId, @RequestParam String text) {
        guard.require(context, PermissionCatalog.WORKLOG_TASK_PERFORM);
        taskBoard.saveReport(context.academyId(), taskId, context.accountId(), assignable(context), text);
        return "redirect:" + context.path("/tasks/" + taskId);
    }

    /**
     * 보고에 파일 첨부
     *
     * @param context 요청 문맥
     * @param taskId 업무 ID
     * @param file 올린 파일
     * @return 업무 상세 화면
     * @throws IOException 올린 파일을 읽지 못했을 때
     */
    @PostMapping("/tasks/{taskId}/attachments")
    public String attach(AcademyContext context, @PathVariable UUID taskId, @RequestParam MultipartFile file)
            throws IOException {
        guard.require(context, PermissionCatalog.WORKLOG_TASK_PERFORM);
        Uploads.requireAttachmentSize(file);
        taskBoard.attach(
                context.academyId(),
                taskId,
                context.accountId(),
                assignable(context),
                file.getOriginalFilename(),
                file.getContentType(),
                file.getBytes());
        return "redirect:" + context.path("/tasks/" + taskId);
    }

    /**
     * 본인이 올린 첨부 삭제
     *
     * 업무 보고의 첨부와 일일보고 체크리스트의 첨부를 모두 여기서 지움
     *
     * @param context 요청 문맥
     * @param attachmentId 첨부 ID
     * @param request 요청
     * @return 이전 화면
     */
    @PostMapping("/attachments/{attachmentId}/delete")
    public String removeAttachment(
            AcademyContext context, @PathVariable UUID attachmentId, HttpServletRequest request) {
        guard.requireAny(context, PermissionCatalog.WORKLOG_TASK_PERFORM, PermissionCatalog.WORKLOG_REPORT_WRITE);
        taskBoard.removeAttachment(context.academyId(), attachmentId, context.accountId());
        return Redirects.back(request, context.path("/tasks"));
    }

    /**
     * 첨부 내려받기
     *
     * 올린 본인은 언제나 받을 수 있음. 다른 사람의 첨부는 업무 보고의 것이면 업무 관리 권한, 일일보고의 것이면 보고
     * 검토 권한이 있어야 받음
     *
     * @param context 요청 문맥
     * @param attachmentId 첨부 ID
     * @return 파일 본문
     */
    @GetMapping("/attachments/{attachmentId}")
    public ResponseEntity<byte[]> download(AcademyContext context, @PathVariable UUID attachmentId) {
        var attachment = taskBoard.attachment(context.academyId(), attachmentId);
        if (!attachment.info().ownerAccountId().equals(context.accountId())) {
            guard.require(
                    context,
                    attachment.info().taskId() == null
                            ? PermissionCatalog.WORKLOG_REPORT_REVIEW
                            : PermissionCatalog.WORKLOG_TASK_MANAGE);
        }
        // 브라우저가 올린 파일을 화면으로 해석하지 않도록 항상 내려받기로 응답
        var disposition = ContentDisposition.attachment()
                .filename(attachment.info().fileName(), StandardCharsets.UTF_8)
                .build();
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .header("X-Content-Type-Options", "nosniff")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(attachment.content());
    }

    /**
     * 한 반의 학생 명단을 가져와 상담 대상에 반영
     *
     * @param context 요청 문맥
     * @param taskId 업무 ID
     * @param classCode 반 코드
     * @return 업무 상세 화면
     */
    @PostMapping("/tasks/{taskId}/counsel/sync")
    public String syncRoster(AcademyContext context, @PathVariable UUID taskId, @RequestParam String classCode) {
        guard.require(context, PermissionCatalog.WORKLOG_COUNSEL_WRITE);
        counselDesk.syncRoster(context.academyId(), taskId, context.accountId(), classCode);
        return "redirect:" + context.path("/tasks/" + taskId) + "#counsel";
    }

    /**
     * 상담 저장 또는 전송
     *
     * @param context 요청 문맥
     * @param entryId 상담 ID
     * @param subject 주제
     * @param content 내용
     * @param action 저장(save)인지 전송(send)인지
     * @param request 요청
     * @return 이전 화면
     */
    @PostMapping("/counsel/{entryId}")
    public String writeCounsel(
            AcademyContext context,
            @PathVariable UUID entryId,
            @RequestParam String subject,
            @RequestParam String content,
            @RequestParam(defaultValue = "save") String action,
            HttpServletRequest request) {
        guard.require(context, PermissionCatalog.WORKLOG_COUNSEL_WRITE);
        if ("send".equals(action)) {
            counselDesk.send(context.academyId(), entryId, context.accountId(), calendar.today(), subject, content);
        } else {
            counselDesk.saveDraft(context.academyId(), entryId, context.accountId(), subject, content);
        }
        return Redirects.back(request, context.path("/tasks"));
    }

    /**
     * 결과를 모르는 전송을 외부 시스템의 기록과 대조
     *
     * @param context 요청 문맥
     * @param entryId 상담 ID
     * @param request 요청
     * @return 이전 화면
     */
    @PostMapping("/counsel/{entryId}/resolve")
    public String resolveCounsel(AcademyContext context, @PathVariable UUID entryId, HttpServletRequest request) {
        guard.require(context, PermissionCatalog.WORKLOG_COUNSEL_WRITE);
        counselDesk.resolvePending(context.academyId(), entryId, context.accountId());
        return Redirects.back(request, context.path("/tasks"));
    }

    /**
     * 요청한 사람이 볼 수 있는 형태의 업무 조회
     *
     * 관리 권한이 있으면 담당자 전원의 진행이 담긴 업무를, 아니면 본인에게 배정됐거나 본인이 만든 상담일정만 돌려줌
     *
     * @param context 요청 문맥
     * @param taskId 업무 ID
     * @return 업무
     * @throws WorklogNotFoundException 볼 수 있는 업무가 아닐 때
     */
    private TaskView visibleTask(AcademyContext context, UUID taskId) {
        var academyId = context.academyId();
        var me = context.accountId();

        // 개인 상담일정은 관리 권한과 상관없이 만든 사람만 봄
        var own = taskBoard.selfCounselTasks(academyId, me).stream()
                .filter(task -> task.id().equals(taskId))
                .findFirst();
        if (own.isPresent()) {
            guard.require(context, PermissionCatalog.WORKLOG_SELFCLASS_MANAGE);
            return own.get();
        }
        if (context.can(PermissionCatalog.WORKLOG_TASK_MANAGE)) {
            guard.require(context, PermissionCatalog.WORKLOG_TASK_MANAGE);
            var task = taskBoard.task(academyId, taskId, assignable(context));
            if (task.kind() != TaskKind.SELF_COUNSEL) {
                return task;
            }
        } else {
            guard.require(context, PermissionCatalog.WORKLOG_TASK_PERFORM);
            var assigned = taskBoard.tasksOf(academyId, me, assignable(context)).stream()
                    .filter(task -> task.id().equals(taskId))
                    .findFirst();
            if (assigned.isPresent()) {
                return assigned.get();
            }
        }
        throw new WorklogNotFoundException("TASK_NOT_FOUND", "업무를 찾을 수 없습니다.");
    }

    /**
     * 관리 권한으로 다룰 수 있는 공용 업무 조회
     *
     * 개인 상담일정은 만든 사람의 것이어서 관리 권한으로도 고치거나 지울 수 없음
     *
     * @param context 요청 문맥
     * @param taskId 업무 ID
     * @return 공용 업무
     * @throws WorklogNotFoundException 개인 상담일정이거나 없는 업무일 때
     */
    private TaskView managedTask(AcademyContext context, UUID taskId) {
        guard.require(context, PermissionCatalog.WORKLOG_TASK_MANAGE);
        var task = taskBoard.task(context.academyId(), taskId, assignable(context));
        if (task.kind() == TaskKind.SELF_COUNSEL) {
            throw new WorklogNotFoundException("TASK_NOT_FOUND", "업무를 찾을 수 없습니다.");
        }
        return task;
    }

    /**
     * 업무 입력 화면에 필요한 선택지
     *
     * @param context 요청 문맥
     * @param model 화면 모델
     */
    private void populateForm(AcademyContext context, Model model) {
        model.addAttribute("tags", tagCatalog.tags(context.academyId()));
        model.addAttribute("candidates", assignable(context).stream().sorted().toList());
        model.addAttribute("kinds", List.of(TaskKind.GENERAL, TaskKind.MT, TaskKind.COUNSEL, TaskKind.SPECIAL_COUNSEL));
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

    /**
     * 업무 입력 폼
     *
     * @param title 업무 이름
     * @param description 내용
     * @param tagId 태그 ID
     * @param startDate 시작일
     * @param dueDate 마감일
     * @param kind 업무 종류
     * @param assignAll 전원 배정인지
     * @param assigneeIds 골라서 배정한 계정 ID
     * @param reportRequired 텍스트 보고가 필수인지
     * @param attachmentRequired 첨부가 필수인지
     * @param linkLabel 참고 링크 이름들
     * @param linkUrl 참고 링크 주소들
     */
    public record TaskForm(
            String title,
            String description,
            UUID tagId,
            LocalDate startDate,
            LocalDate dueDate,
            TaskKind kind,
            boolean assignAll,
            List<UUID> assigneeIds,
            boolean reportRequired,
            boolean attachmentRequired,
            List<String> linkLabel,
            List<String> linkUrl) {
        /**
         * 모듈에 넘길 입력으로 변환
         *
         * @return 업무 입력
         */
        TaskDraft toDraft() {
            var links = new ArrayList<TaskLink>();
            var urls = linkUrl == null ? List.<String>of() : linkUrl;
            for (var index = 0; index < urls.size(); index++) {
                var label = linkLabel != null && index < linkLabel.size() ? linkLabel.get(index) : "";
                links.add(new TaskLink(label, urls.get(index)));
            }
            return new TaskDraft(
                    title,
                    description,
                    tagId,
                    startDate,
                    dueDate,
                    kind,
                    assignAll,
                    assigneeIds == null ? Set.of() : new HashSet<>(assigneeIds),
                    reportRequired,
                    attachmentRequired,
                    links);
        }
    }
}
