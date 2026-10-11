package com.npr.erp.worklog.internal.task;

import static com.npr.generated.jooq.Tables.WORKLOG_COUNSEL_ENTRY;

import com.npr.erp.worklog.AssigneeProgress;
import com.npr.erp.worklog.AttachmentView;
import com.npr.erp.worklog.TagView;
import com.npr.erp.worklog.TaskKind;
import com.npr.erp.worklog.TaskLink;
import com.npr.erp.worklog.TaskProgress;
import com.npr.erp.worklog.TaskView;
import com.npr.erp.worklog.internal.support.WorklogJson;
import com.npr.erp.worklog.internal.tag.WorklogTagEntity;
import com.npr.erp.worklog.internal.tag.WorklogTagRepository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;

/**
 * 업무 조회 결과 조립
 *
 * 담당자, 처리 상태, 첨부, 상담 집계를 업무 수와 상관없이 각각 한 번씩만 읽어 합침
 */
@Component
@RequiredArgsConstructor
public class TaskViewAssembler {
    /**
     * 참고 링크 목록의 JSON 타입
     */
    private static final TypeReference<List<TaskLink>> LINKS = new TypeReference<>() {
    };

    /**
     * 태그 저장소
     */
    private final WorklogTagRepository tagRepository;

    /**
     * 처리 상태 저장소
     */
    private final WorklogTaskStatusRepository statusRepository;

    /**
     * 골라서 배정한 담당자
     */
    private final TaskAssigneeStore assigneeStore;

    /**
     * 첨부 저장
     */
    private final AttachmentStore attachmentStore;

    /**
     * jOOQ 실행 문맥
     */
    private final DSLContext dsl;

    /**
     * JSON 변환
     */
    private final WorklogJson json;

    /**
     * 업무들을 담당자 전원의 진행과 함께 조회 결과로 변환
     *
     * @param tasks 업무 엔티티
     * @param assignableIds 지금의 배정 후보
     * @return 입력 순서의 조회 결과
     */
    public List<TaskView> assemble(List<WorklogTaskEntity> tasks, Set<UUID> assignableIds) {
        if (tasks.isEmpty()) {
            return List.of();
        }
        var taskIds = tasks.stream().map(WorklogTaskEntity::getId).toList();

        // 조회 한 번씩으로 필요한 것을 모두 읽어 색인함
        var tags = new HashMap<UUID, TagView>();
        var tagIds = new HashSet<UUID>();
        for (var task : tasks) {
            tagIds.add(task.getTagId());
        }
        for (WorklogTagEntity tag : tagRepository.findAllById(tagIds)) {
            tags.put(tag.getId(), tag.toView());
        }
        var pickedAssignees = assigneeStore.load(taskIds);
        var statuses = new HashMap<TaskAssigneeId, WorklogTaskStatusEntity>();
        for (var status : statusRepository.findAllByIdTaskIdIn(taskIds)) {
            statuses.put(status.getId(), status);
        }
        var attachments = new HashMap<TaskAssigneeId, List<AttachmentView>>();
        for (var item : attachmentStore.listForTasks(taskIds)) {
            attachments
                    .computeIfAbsent(
                            new TaskAssigneeId(item.taskId(), item.attachment().ownerAccountId()),
                            ignored -> new ArrayList<>())
                    .add(item.attachment());
        }
        var counsel = counselCounts(taskIds);

        var views = new ArrayList<TaskView>();
        for (var task : tasks) {
            var assigneeIds = assigneesOf(task, pickedAssignees.getOrDefault(task.getId(), Set.of()), assignableIds);
            var progresses = new ArrayList<AssigneeProgress>();
            var doneCount = 0;
            for (var accountId : assigneeIds) {
                var key = new TaskAssigneeId(task.getId(), accountId);
                var progress = progressOf(
                        task.getKind(),
                        accountId,
                        statuses.get(key),
                        attachments.getOrDefault(key, List.of()),
                        counsel.getOrDefault(key, CounselCount.NONE));
                progresses.add(progress);
                if (progress.complete()) {
                    doneCount++;
                }
            }
            views.add(new TaskView(
                    task.getId(),
                    task.getTitle(),
                    task.getDescription(),
                    tags.get(task.getTagId()),
                    task.getStartDate(),
                    task.getDueDate(),
                    task.getKind(),
                    task.isAssignAll(),
                    task.isReportRequired(),
                    task.isAttachmentRequired(),
                    task.isArchived(),
                    json.read(task.getLinks(), LINKS),
                    task.getOwnerAccountId(),
                    progresses,
                    assigneeIds.size(),
                    doneCount));
        }
        return views;
    }

    /**
     * 조회 결과에서 한 사람의 진행만 남김
     *
     * 다른 담당자의 보고와 첨부가 담당자에게 내려가지 않게 함. 전체 담당자 수와 완료 수는 그대로 둠
     *
     * @param view 담당자 전원이 담긴 조회 결과
     * @param accountId 남길 계정 ID
     * @return 한 사람의 진행만 담긴 조회 결과
     */
    public static TaskView maskTo(TaskView view, UUID accountId) {
        var own = view.assignees().stream().filter(progress -> progress.accountId().equals(accountId)).toList();
        return new TaskView(
                view.id(),
                view.title(),
                view.description(),
                view.tag(),
                view.startDate(),
                view.dueDate(),
                view.kind(),
                view.assignAll(),
                view.reportRequired(),
                view.attachmentRequired(),
                view.archived(),
                view.links(),
                view.ownerAccountId(),
                own,
                view.assigneeCount(),
                view.doneCount());
    }

    /**
     * 업무 종류에 따라 담당자를 정함
     *
     * @param task 업무
     * @param picked 골라서 배정했거나 생성할 때 고정한 담당자
     * @param assignableIds 지금의 배정 후보
     * @return 계정 ID 순으로 정렬한 담당자
     */
    static Set<UUID> assigneesOf(WorklogTaskEntity task, Set<UUID> picked, Set<UUID> assignableIds) {
        var result = new TreeSet<UUID>();
        switch (task.getKind()) {
            // 개인 상담일정은 만든 사람 혼자 담당
            case SELF_COUNSEL -> result.add(task.getOwnerAccountId());
            // 특강상담은 만들 때 고정한 담당자를 그대로 씀. 명단도 그때 고정했기 때문임
            case SPECIAL_COUNSEL -> result.addAll(picked);
            // 나머지는 지금 후보인 사람만 담당자로 봄. 권한을 잃은 사람은 빠짐
            case GENERAL, MT, COUNSEL -> {
                if (task.isAssignAll()) {
                    result.addAll(assignableIds);
                } else {
                    for (var accountId : picked) {
                        if (assignableIds.contains(accountId)) {
                            result.add(accountId);
                        }
                    }
                }
            }
        }
        return result;
    }

    /**
     * 담당자 한 명의 진행과 완료 여부 계산
     *
     * @param kind 업무 종류
     * @param accountId 담당자 계정 ID
     * @param status 저장된 처리 상태. 없으면 null
     * @param files 보고에 붙인 파일
     * @param counsel 상담 집계
     * @return 담당자 진행
     */
    private static AssigneeProgress progressOf(
            TaskKind kind,
            UUID accountId,
            WorklogTaskStatusEntity status,
            List<AttachmentView> files,
            CounselCount counsel) {
        var progress = status == null ? TaskProgress.NONE : status.getStatus();
        var complete = switch (kind) {
            case GENERAL, MT -> progress == TaskProgress.DONE;
            // 명단을 아직 가져오지 않은 상담 업무는 완료가 아님
            case COUNSEL, SELF_COUNSEL -> counsel.total() > 0 && counsel.sent() >= counsel.total();
            // 특강상담은 맡은 학생이 없는 담당자가 전체 완료를 막지 않게 함
            case SPECIAL_COUNSEL -> counsel.sent() >= counsel.total();
        };
        return new AssigneeProgress(
                accountId,
                progress,
                status == null ? "" : status.getReportText(),
                status != null && status.isMwfDone(),
                status != null && status.isTtsDone(),
                files,
                counsel.sent(),
                counsel.pending(),
                counsel.total(),
                complete,
                status == null ? null : status.getUpdatedAt());
    }

    /**
     * 업무·담당자별 상담 대상 수와 전송 수 집계
     *
     * 학생 이름과 연락처는 읽지 않고 숫자만 셈
     *
     * @param taskIds 업무 ID 목록
     * @return 업무·담당자별 집계
     */
    private Map<TaskAssigneeId, CounselCount> counselCounts(List<UUID> taskIds) {
        var sent = DSL.count().filterWhere(WORKLOG_COUNSEL_ENTRY.DELIVERY_STATE.eq("SENT"));
        var pending = DSL.count().filterWhere(WORKLOG_COUNSEL_ENTRY.DELIVERY_STATE.eq("PENDING"));
        var counts = new HashMap<TaskAssigneeId, CounselCount>();
        dsl.select(WORKLOG_COUNSEL_ENTRY.TASK_ID, WORKLOG_COUNSEL_ENTRY.ACCOUNT_ID, DSL.count(), sent, pending)
                .from(WORKLOG_COUNSEL_ENTRY)
                .where(WORKLOG_COUNSEL_ENTRY.TASK_ID.in(taskIds))
                .groupBy(WORKLOG_COUNSEL_ENTRY.TASK_ID, WORKLOG_COUNSEL_ENTRY.ACCOUNT_ID)
                .forEach(record -> counts.put(
                        new TaskAssigneeId(record.value1(), record.value2()),
                        new CounselCount(record.value3(), record.value4(), record.value5())));
        return counts;
    }

    /**
     * 담당자 한 명의 상담 집계
     *
     * @param total 상담 대상 학생 수
     * @param sent 보낸 상담 수
     * @param pending 결과를 확인하지 못한 상담 수
     */
    private record CounselCount(int total, int sent, int pending) {
        /**
         * 상담 대상이 없는 상태
         */
        private static final CounselCount NONE = new CounselCount(0, 0, 0);
    }
}
