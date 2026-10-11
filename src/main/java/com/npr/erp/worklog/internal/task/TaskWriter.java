package com.npr.erp.worklog.internal.task;

import com.npr.erp.tng.TngDayGroup;
import com.npr.erp.worklog.AttachmentView;
import com.npr.erp.worklog.TaskKind;
import com.npr.erp.worklog.TaskProgress;
import com.npr.erp.worklog.WorklogConflictException;
import com.npr.erp.worklog.WorklogForbiddenException;
import com.npr.erp.worklog.WorklogNotFoundException;
import com.npr.erp.worklog.WorklogValidationException;
import com.npr.erp.worklog.internal.counsel.ClassRoster;
import com.npr.erp.worklog.internal.counsel.CounselStore;
import com.npr.erp.worklog.internal.support.Texts;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 업무의 DB 쪽 변경
 *
 * 메서드 하나가 트랜잭션 하나임. 외부 시스템에서 명단을 읽는 일은 호출자가 트랜잭션 밖에서 미리 해서 넘김
 */
@Service
@RequiredArgsConstructor
public class TaskWriter {
    /**
     * 텍스트 보고의 최대 길이
     */
    private static final int MAX_REPORT_LENGTH = 4000;

    /**
     * 업무 저장소
     */
    private final WorklogTaskRepository taskRepository;

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
     * 상담의 DB 쪽 처리
     */
    private final CounselStore counselStore;

    /**
     * 업무와 담당자, 고정 명단을 한 트랜잭션에 저장
     *
     * @param academyId 학원 ID
     * @param actorId 만드는 계정 ID
     * @param content 검증을 마친 입력
     * @param ownerId 개인 상담일정의 소유자. 다른 종류는 null
     * @param pickedAssignees 저장할 담당자. 전원 배정인 일반 업무는 빈 집합
     * @param rosters 담당자별로 고정할 명단. 고정 명단이 없는 종류는 빈 맵
     * @return 저장한 업무의 ID
     */
    @Transactional
    public UUID insert(
            UUID academyId,
            UUID actorId,
            TaskContent content,
            UUID ownerId,
            Set<UUID> pickedAssignees,
            Map<UUID, List<ClassRoster>> rosters) {
        var task = taskRepository.saveAndFlush(new WorklogTaskEntity(academyId, content, ownerId, actorId, Instant.now()));
        assigneeStore.replace(task.getId(), pickedAssignees);
        for (var entry : rosters.entrySet()) {
            counselStore.seed(task.getId(), entry.getKey(), entry.getValue());
        }
        return task.getId();
    }

    /**
     * 업무 내용과 담당자 교체
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param content 검증을 마친 입력
     * @param pickedAssignees 새 담당자. 담당자를 바꾸지 않으려면 null
     * @throws WorklogConflictException 종류를 바꾸려 할 때
     */
    @Transactional
    public void update(UUID academyId, UUID taskId, TaskContent content, Set<UUID> pickedAssignees) {
        var task = findShared(academyId, taskId);
        if (task.getKind() != content.kind()) {
            throw new WorklogConflictException("TASK_KIND_IMMUTABLE", "업무 종류는 만든 뒤에 바꿀 수 없습니다.");
        }
        task.apply(content, Instant.now());
        if (pickedAssignees != null) {
            assigneeStore.replace(taskId, pickedAssignees);
        }
    }

    /**
     * 업무 삭제
     *
     * 담당자, 처리 상태, 첨부, 상담은 외래 키의 연쇄 삭제로 함께 지워짐
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     */
    @Transactional
    public void delete(UUID academyId, UUID taskId) {
        taskRepository.delete(findShared(academyId, taskId));
    }

    /**
     * 본인이 만든 개인 상담일정 삭제
     *
     * @param academyId 학원 ID
     * @param taskId 상담일정 ID
     * @param ownerId 요청한 계정 ID
     * @throws WorklogForbiddenException 본인이 만든 상담일정이 아닐 때
     */
    @Transactional
    public void deleteSelfCounsel(UUID academyId, UUID taskId, UUID ownerId) {
        var task = find(academyId, taskId);
        if (task.getKind() != TaskKind.SELF_COUNSEL || !ownerId.equals(task.getOwnerAccountId())) {
            throw new WorklogForbiddenException("본인이 만든 상담일정만 지울 수 있습니다.");
        }
        taskRepository.delete(task);
    }

    /**
     * 보관 여부 변경
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param archived 보관할지
     */
    @Transactional
    public void setArchived(UUID academyId, UUID taskId, boolean archived) {
        findShared(academyId, taskId).archive(archived, Instant.now());
    }

    /**
     * 일반 업무의 완료 표시
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @param assignableIds 지금의 배정 후보
     * @param done 완료로 표시할지
     */
    @Transactional
    public void markStatus(UUID academyId, UUID taskId, UUID accountId, Set<UUID> assignableIds, boolean done) {
        var task = assignedTask(academyId, taskId, accountId, assignableIds);
        if (task.getKind() != TaskKind.GENERAL) {
            throw new WorklogConflictException("TASK_STATUS_NOT_MANUAL", "직접 완료로 표시할 수 없는 종류의 업무입니다.");
        }
        var status = statusOf(taskId, accountId);

        // 완료로 바꿀 때만 완료 조건을 확인. 텍스트 보고를 먼저, 그다음 첨부를 봄
        if (done) {
            if (task.isReportRequired() && status.getReportText().isBlank()) {
                throw new WorklogValidationException("TASK_REPORT_REQUIRED", "텍스트 보고가 필요합니다.");
            }
            if (task.isAttachmentRequired() && attachmentStore.countForTask(taskId, accountId) == 0) {
                throw new WorklogValidationException("TASK_ATTACHMENT_REQUIRED", "첨부 파일이 필요합니다.");
            }
        }
        status.mark(done, Instant.now());
    }

    /**
     * MT 업무의 요일 묶음 체크
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @param assignableIds 지금의 배정 후보
     * @param part 월수금 또는 화목토
     * @param done 체크할지
     */
    @Transactional
    public void toggleMt(
            UUID academyId, UUID taskId, UUID accountId, Set<UUID> assignableIds, TngDayGroup part, boolean done) {
        var task = assignedTask(academyId, taskId, accountId, assignableIds);
        if (task.getKind() != TaskKind.MT) {
            throw new WorklogConflictException("TASK_NOT_MT", "MT 업무가 아닙니다.");
        }
        statusOf(taskId, accountId).toggleMt(part, done, Instant.now());
    }

    /**
     * 텍스트 보고 저장
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @param assignableIds 지금의 배정 후보
     * @param text 보고 내용
     */
    @Transactional
    public void saveReport(UUID academyId, UUID taskId, UUID accountId, Set<UUID> assignableIds, String text) {
        var task = assignedTask(academyId, taskId, accountId, assignableIds);
        var status = statusOf(taskId, accountId);
        var report = Texts.optional(text, "보고 내용", MAX_REPORT_LENGTH);

        // 완료로 표시한 뒤에 완료 조건이던 보고를 비울 수 없음
        if (report.isEmpty() && task.isReportRequired() && status.getStatus() == TaskProgress.DONE) {
            throw new WorklogConflictException("TASK_REPORT_REQUIRED", "완료한 업무의 필수 보고는 비울 수 없습니다. 먼저 미완료로 바꿔 주세요.");
        }
        status.writeReport(report, Instant.now());
    }

    /**
     * 보고에 파일 첨부
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @param assignableIds 지금의 배정 후보
     * @param fileName 파일 이름
     * @param mediaType 미디어 타입
     * @param content 본문
     * @return 첨부 정보
     */
    @Transactional
    public AttachmentView attach(
            UUID academyId,
            UUID taskId,
            UUID accountId,
            Set<UUID> assignableIds,
            String fileName,
            String mediaType,
            byte[] content) {
        assignedTask(academyId, taskId, accountId, assignableIds);
        return attachmentStore.saveForTask(academyId, accountId, taskId, fileName, mediaType, content);
    }

    /**
     * 본인이 올린 첨부 삭제
     *
     * @param academyId 학원 ID
     * @param attachmentId 첨부 ID
     * @param accountId 올린 계정 ID
     */
    @Transactional
    public void removeAttachment(UUID academyId, UUID attachmentId, UUID accountId) {
        var attachment = attachmentStore.find(academyId, attachmentId)
                .orElseThrow(() -> new WorklogNotFoundException("ATTACHMENT_NOT_FOUND", "첨부 파일을 찾을 수 없습니다."));
        if (!attachment.ownerAccountId().equals(accountId)) {
            throw new WorklogForbiddenException("본인이 올린 첨부만 지울 수 있습니다.");
        }

        // 낸 보고와 완료한 업무가 나중에 달라지지 않게, 근거가 된 첨부는 지울 수 없음
        if (attachment.taskId() == null) {
            if (attachmentStore.belongsToSubmittedReport(attachmentId)) {
                throw new WorklogConflictException("REPORT_SUBMITTED", "제출한 일일보고의 첨부는 지울 수 없습니다. 먼저 제출을 되돌려 주세요.");
            }
        } else {
            var task = find(academyId, attachment.taskId());
            var done = statusRepository.findById(new TaskAssigneeId(task.getId(), accountId))
                    .map(status -> status.getStatus() == TaskProgress.DONE)
                    .orElse(false);
            if (done && task.isAttachmentRequired() && attachmentStore.countForTask(task.getId(), accountId) == 1) {
                throw new WorklogConflictException(
                        "TASK_ATTACHMENT_REQUIRED", "완료한 업무의 필수 첨부는 지울 수 없습니다. 먼저 미완료로 바꿔 주세요.");
            }
        }
        attachmentStore.delete(attachmentId);
    }

    /**
     * 학원 안에서 업무 조회
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @return 업무
     * @throws WorklogNotFoundException 그 학원의 업무가 아닐 때
     */
    private WorklogTaskEntity find(UUID academyId, UUID taskId) {
        return taskRepository.findByIdAndAcademyId(taskId, academyId)
                .orElseThrow(() -> new WorklogNotFoundException("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
    }

    /**
     * 학원 안에서 공용 업무 조회
     *
     * 개인 상담일정은 만든 사람의 것이어서 공용 업무를 다루는 경로로는 찾을 수 없음
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @return 공용 업무
     * @throws WorklogNotFoundException 없거나 개인 상담일정일 때
     */
    private WorklogTaskEntity findShared(UUID academyId, UUID taskId) {
        var task = find(academyId, taskId);
        if (task.getKind() == TaskKind.SELF_COUNSEL) {
            throw new WorklogNotFoundException("TASK_NOT_FOUND", "업무를 찾을 수 없습니다.");
        }
        return task;
    }

    /**
     * 요청한 사람이 지금 담당자인 업무인지 확인
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param accountId 요청한 계정 ID
     * @param assignableIds 지금의 배정 후보
     * @return 업무
     * @throws WorklogForbiddenException 담당자가 아닐 때
     */
    private WorklogTaskEntity assignedTask(UUID academyId, UUID taskId, UUID accountId, Set<UUID> assignableIds) {
        var task = find(academyId, taskId);
        var picked = assigneeStore.load(List.of(taskId)).getOrDefault(taskId, Set.of());
        if (!TaskViewAssembler.assigneesOf(task, picked, assignableIds).contains(accountId)) {
            throw new WorklogForbiddenException("본인에게 배정된 업무만 처리할 수 있습니다.");
        }
        return task;
    }

    /**
     * 담당자의 처리 상태를 찾고 없으면 새로 만듦
     *
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @return 영속 상태의 처리 상태
     */
    private WorklogTaskStatusEntity statusOf(UUID taskId, UUID accountId) {
        return statusRepository.findById(new TaskAssigneeId(taskId, accountId))
                .orElseGet(() -> statusRepository.save(new WorklogTaskStatusEntity(taskId, accountId, Instant.now())));
    }
}
