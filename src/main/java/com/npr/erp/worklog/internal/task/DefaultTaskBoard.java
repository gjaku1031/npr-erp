package com.npr.erp.worklog.internal.task;

import com.npr.erp.tng.TngClassKind;
import com.npr.erp.tng.TngClassroom;
import com.npr.erp.tng.TngDayGroup;
import com.npr.erp.tng.TngGateway;
import com.npr.erp.worklog.AttachmentContent;
import com.npr.erp.worklog.AttachmentView;
import com.npr.erp.worklog.TagCatalog;
import com.npr.erp.worklog.TaskBoard;
import com.npr.erp.worklog.TaskDraft;
import com.npr.erp.worklog.TaskKind;
import com.npr.erp.worklog.TaskLink;
import com.npr.erp.worklog.TaskView;
import com.npr.erp.worklog.WorklogConflictException;
import com.npr.erp.worklog.WorklogNotFoundException;
import com.npr.erp.worklog.WorklogStaffDirectory;
import com.npr.erp.worklog.WorklogValidationException;
import com.npr.erp.worklog.internal.counsel.ClassRoster;
import com.npr.erp.worklog.internal.support.Texts;
import com.npr.erp.worklog.internal.support.WorklogJson;
import com.npr.erp.worklog.internal.tag.WorklogTagRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link TaskBoard} 구현
 *
 * 입력 검증과 외부 시스템 조회를 맡고, DB 변경은 {@link TaskWriter}의 트랜잭션에 넘김
 */
@Service
@RequiredArgsConstructor
public class DefaultTaskBoard implements TaskBoard {
    /**
     * 업무 이름의 최대 길이
     */
    private static final int MAX_TITLE_LENGTH = 200;

    /**
     * 내용의 최대 길이
     */
    private static final int MAX_DESCRIPTION_LENGTH = 8000;

    /**
     * 참고 링크의 최대 개수
     */
    private static final int MAX_LINKS = 10;

    /**
     * 링크 주소의 최대 길이
     */
    private static final int MAX_URL_LENGTH = 1000;

    /**
     * DB 변경
     */
    private final TaskWriter writer;

    /**
     * 업무 저장소
     */
    private final WorklogTaskRepository taskRepository;

    /**
     * 태그 저장소
     */
    private final WorklogTagRepository tagRepository;

    /**
     * 조회 결과 조립
     */
    private final TaskViewAssembler assembler;

    /**
     * 첨부 저장
     */
    private final AttachmentStore attachmentStore;

    /**
     * 직원 설정
     */
    private final WorklogStaffDirectory staffDirectory;

    /**
     * 외부 시스템 포트
     */
    private final TngGateway tngGateway;

    /**
     * JSON 변환
     */
    private final WorklogJson json;

    /**
     * {@inheritDoc}
     */
    @Override
    public TaskView create(UUID academyId, UUID actorId, TaskDraft draft, Set<UUID> assignableIds) {
        if (draft.kind() == TaskKind.SELF_COUNSEL) {
            throw new WorklogValidationException("TASK_KIND_INVALID", "개인 상담일정은 본인 화면에서 만듭니다.");
        }
        var content = normalize(academyId, draft);
        var picked = pickedAssignees(draft, assignableIds);

        // 특강상담은 만드는 순간의 담당자와 특강 반 학생을 고정함. 명단은 트랜잭션을 열기 전에 읽어 둠
        var rosters = new HashMap<UUID, List<ClassRoster>>();
        if (draft.kind() == TaskKind.SPECIAL_COUNSEL) {
            picked = draft.assignAll() ? Set.copyOf(assignableIds) : picked;
            for (var accountId : picked) {
                var classrooms = staffDirectory.staff(academyId, accountId).classroomsOf(TngClassKind.SPECIAL);
                rosters.put(accountId, readRosters(classrooms));
            }
        }
        var taskId = writer.insert(academyId, actorId, content, null, picked, rosters);
        return task(academyId, taskId, assignableIds);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public TaskView update(UUID academyId, UUID taskId, TaskDraft draft, Set<UUID> assignableIds) {
        var content = normalize(academyId, draft);
        // 특강상담은 고정한 담당자를 그대로 둠
        var picked = draft.kind() == TaskKind.SPECIAL_COUNSEL ? null : pickedAssignees(draft, assignableIds);
        writer.update(academyId, taskId, content, picked);
        return task(academyId, taskId, assignableIds);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void delete(UUID academyId, UUID taskId) {
        writer.delete(academyId, taskId);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void deleteSelfCounsel(UUID academyId, UUID taskId, UUID ownerId) {
        writer.deleteSelfCounsel(academyId, taskId, ownerId);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void setArchived(UUID academyId, UUID taskId, boolean archived) {
        writer.setArchived(academyId, taskId, archived);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public List<TaskView> allTasks(UUID academyId, Set<UUID> assignableIds) {
        var tasks = taskRepository.findAllByAcademyIdOrderByStartDateAscDueDateAscCreatedAtAsc(academyId).stream()
                .filter(task -> task.getKind() != TaskKind.SELF_COUNSEL)
                .toList();
        return assembler.assemble(tasks, assignableIds);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public List<TaskView> tasksOf(UUID academyId, UUID accountId, Set<UUID> assignableIds) {
        return allTasks(academyId, assignableIds).stream()
                .filter(view -> view.progressOf(accountId).isPresent())
                .map(view -> TaskViewAssembler.maskTo(view, accountId))
                .toList();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public List<TaskView> selfCounselTasks(UUID academyId, UUID ownerId) {
        var tasks = taskRepository.findAllByAcademyIdOrderByStartDateAscDueDateAscCreatedAtAsc(academyId).stream()
                .filter(task -> task.getKind() == TaskKind.SELF_COUNSEL && ownerId.equals(task.getOwnerAccountId()))
                .toList();
        return assembler.assemble(tasks, Set.of());
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public TaskView task(UUID academyId, UUID taskId, Set<UUID> assignableIds) {
        var task = taskRepository.findByIdAndAcademyId(taskId, academyId)
                .filter(found -> found.getKind() != TaskKind.SELF_COUNSEL)
                .orElseThrow(() -> new WorklogNotFoundException("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        return assembler.assemble(List.of(task), assignableIds).getFirst();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public TaskView createSelfCounsel(
            UUID academyId, UUID ownerId, String title, LocalDate startDate, LocalDate dueDate) {
        var classrooms = staffDirectory.staff(academyId, ownerId).classrooms();
        if (classrooms.isEmpty()) {
            throw new WorklogConflictException("SELF_CLASSROOMS_EMPTY", "본인 담당 반을 먼저 가져와 주세요.");
        }
        var counselTag = tagRepository.findByAcademyIdAndName(academyId, TagCatalog.COUNSEL_TAG)
                .orElseThrow(() -> new WorklogConflictException("TAG_COUNSEL_MISSING", "상담 태그가 없습니다."));
        requirePeriod(startDate, dueDate);
        var content = new TaskContent(
                Texts.required(title, "상담일정 이름", MAX_TITLE_LENGTH),
                "",
                counselTag.getId(),
                startDate,
                dueDate,
                TaskKind.SELF_COUNSEL,
                false,
                false,
                false,
                json.write(List.of()));
        var taskId =
                writer.insert(academyId, ownerId, content, ownerId, Set.of(), Map.of(ownerId, readRosters(classrooms)));
        return selfCounselTasks(academyId, ownerId).stream()
                .filter(created -> created.id().equals(taskId))
                .findFirst()
                .orElseThrow();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void markStatus(UUID academyId, UUID taskId, UUID accountId, Set<UUID> assignableIds, boolean done) {
        writer.markStatus(academyId, taskId, accountId, assignableIds, done);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void toggleMt(
            UUID academyId, UUID taskId, UUID accountId, Set<UUID> assignableIds, TngDayGroup part, boolean done) {
        writer.toggleMt(academyId, taskId, accountId, assignableIds, part, done);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void saveReport(UUID academyId, UUID taskId, UUID accountId, Set<UUID> assignableIds, String text) {
        writer.saveReport(academyId, taskId, accountId, assignableIds, text);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public AttachmentView attach(
            UUID academyId,
            UUID taskId,
            UUID accountId,
            Set<UUID> assignableIds,
            String fileName,
            String mediaType,
            byte[] content) {
        return writer.attach(academyId, taskId, accountId, assignableIds, fileName, mediaType, content);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void removeAttachment(UUID academyId, UUID attachmentId, UUID accountId) {
        writer.removeAttachment(academyId, attachmentId, accountId);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public AttachmentContent attachment(UUID academyId, UUID attachmentId) {
        return attachmentStore.load(academyId, attachmentId);
    }

    /**
     * 입력을 검증하고 저장할 형태로 정리
     *
     * 상담 종류는 고른 태그와 상관없이 상담 태그를 씀
     *
     * @param academyId 학원 ID
     * @param draft 입력
     * @return 검증을 마친 내용
     */
    private TaskContent normalize(UUID academyId, TaskDraft draft) {
        if (draft.kind() == null) {
            throw new WorklogValidationException("TASK_KIND_REQUIRED", "업무 종류를 골라 주세요.");
        }
        requirePeriod(draft.startDate(), draft.dueDate());
        var tagId = draft.kind().counsel()
                ? tagRepository.findByAcademyIdAndName(academyId, TagCatalog.COUNSEL_TAG)
                        .orElseThrow(() -> new WorklogConflictException("TAG_COUNSEL_MISSING", "상담 태그가 없습니다."))
                        .getId()
                : tagRepository.findByIdAndAcademyId(draft.tagId(), academyId)
                        .orElseThrow(() -> new WorklogValidationException("TASK_TAG_REQUIRED", "태그를 골라 주세요."))
                        .getId();

        // 링크는 이름과 주소가 모두 있는 것만 남기고, 웹 주소가 아닌 것은 받지 않음
        var links = new ArrayList<TaskLink>();
        for (var link : draft.links() == null ? List.<TaskLink>of() : draft.links()) {
            var url = Texts.optional(link.url(), "링크 주소", MAX_URL_LENGTH);
            if (url.isEmpty()) {
                continue;
            }
            if (!url.startsWith("https://") && !url.startsWith("http://")) {
                throw new WorklogValidationException("TASK_LINK_INVALID", "링크는 http 또는 https 주소여야 합니다.");
            }
            var label = Texts.optional(link.label(), "링크 이름", MAX_TITLE_LENGTH);
            links.add(new TaskLink(label.isEmpty() ? url : label, url));
        }
        if (links.size() > MAX_LINKS) {
            throw new WorklogValidationException("TASK_LINKS_TOO_MANY", "참고 링크는 " + MAX_LINKS + "개까지 넣을 수 있습니다.");
        }

        // 완료 조건은 직접 완료로 표시하는 일반 업무에만 의미가 있음
        var general = draft.kind() == TaskKind.GENERAL;
        return new TaskContent(
                Texts.required(draft.title(), "업무 이름", MAX_TITLE_LENGTH),
                Texts.optional(draft.description(), "내용", MAX_DESCRIPTION_LENGTH),
                tagId,
                draft.startDate(),
                draft.dueDate(),
                draft.kind(),
                draft.assignAll(),
                general && draft.reportRequired(),
                general && draft.attachmentRequired(),
                json.write(links));
    }

    /**
     * 골라서 배정한 담당자를 확인
     *
     * @param draft 입력
     * @param assignableIds 지금의 배정 후보
     * @return 저장할 담당자. 전원 배정이면 빈 집합
     * @throws WorklogValidationException 한 명도 고르지 않았거나 후보가 아닌 사람을 골랐을 때
     */
    private static Set<UUID> pickedAssignees(TaskDraft draft, Set<UUID> assignableIds) {
        if (draft.assignAll()) {
            return Set.of();
        }
        var picked = draft.assigneeIds() == null ? Set.<UUID>of() : Set.copyOf(draft.assigneeIds());
        if (picked.isEmpty()) {
            throw new WorklogValidationException("TASK_ASSIGNEE_REQUIRED", "담당자를 한 명 이상 골라 주세요.");
        }
        if (!assignableIds.containsAll(picked)) {
            throw new WorklogValidationException("TASK_ASSIGNEE_INVALID", "업무를 배정할 수 없는 사람이 들어 있습니다. 화면을 새로 고쳐 주세요.");
        }
        return picked;
    }

    /**
     * 기간이 있고 시작일이 마감일보다 늦지 않은지 확인
     *
     * @param startDate 시작일
     * @param dueDate 마감일
     * @throws WorklogValidationException 날짜가 없거나 순서가 뒤집혔을 때
     */
    private static void requirePeriod(LocalDate startDate, LocalDate dueDate) {
        if (startDate == null || dueDate == null) {
            throw new WorklogValidationException("TASK_PERIOD_REQUIRED", "시작일과 마감일을 입력해 주세요.");
        }
        if (startDate.isAfter(dueDate)) {
            throw new WorklogValidationException("TASK_PERIOD_INVALID", "마감일은 시작일보다 빠를 수 없습니다.");
        }
    }

    /**
     * 외부 시스템에서 반별 학생 명단을 읽음
     *
     * @param classrooms 반 목록
     * @return 반별 명단
     */
    private List<ClassRoster> readRosters(List<TngClassroom> classrooms) {
        var rosters = new ArrayList<ClassRoster>();
        for (var classroom : classrooms) {
            rosters.add(new ClassRoster(classroom, tngGateway.students(classroom.code())));
        }
        return rosters;
    }
}
