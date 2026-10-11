package com.npr.erp.integration.worklog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.npr.erp.integration.IntegrationTest;
import com.npr.erp.tng.TngDayGroup;
import com.npr.erp.tng.TngGateway;
import com.npr.erp.worklog.AssigneeProgress;
import com.npr.erp.worklog.CounselDelivery;
import com.npr.erp.worklog.CounselDesk;
import com.npr.erp.worklog.CounselEntryView;
import com.npr.erp.worklog.TagCatalog;
import com.npr.erp.worklog.TaskBoard;
import com.npr.erp.worklog.TaskDraft;
import com.npr.erp.worklog.TaskKind;
import com.npr.erp.worklog.TaskProgress;
import com.npr.erp.worklog.TaskView;
import com.npr.erp.worklog.WorklogForbiddenException;
import com.npr.erp.worklog.internal.counsel.CounselStore;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 업무 배정, 완료 조건, 보고 격리, 상담 전송 검사
 */
@IntegrationTest
class WorklogTaskIntegrationTest extends WorklogIntegrationSupport {
    /**
     * 업무 원장
     */
    @Autowired
    private TaskBoard taskBoard;

    /**
     * 상담 처리
     */
    @Autowired
    private CounselDesk counselDesk;

    /**
     * 전송이 중단된 상황을 만들기 위한 DB 쪽 처리
     */
    @Autowired
    private CounselStore counselStore;

    /**
     * 외부 시스템 포트
     */
    @Autowired
    private TngGateway tngGateway;

    /**
     * 텍스트 보고가 필수인 업무는 보고를 쓴 뒤에만 완료로 표시되는지 확인
     */
    @Test
    void generalTaskNeedsReportBeforeDone() {
        var task = taskBoard.create(academyId, leadId, general("채점 결과 정리", true, false, null), teachers);

        assertThatThrownBy(() -> taskBoard.markStatus(academyId, task.id(), teacherA, teachers, true))
                .satisfies(code("TASK_REPORT_REQUIRED"));

        taskBoard.saveReport(academyId, task.id(), teacherA, teachers, "3반 채점 끝");
        taskBoard.markStatus(academyId, task.id(), teacherA, teachers, true);

        var view = taskBoard.task(academyId, task.id(), teachers);
        assertThat(view.assigneeCount()).isEqualTo(2);
        assertThat(view.doneCount()).isEqualTo(1);
        assertThat(view.progressOf(teacherA).orElseThrow().status()).isEqualTo(TaskProgress.DONE);
    }

    /**
     * 첨부가 필수인 업무는 파일을 올린 뒤에만 완료로 표시되는지 확인
     */
    @Test
    void generalTaskNeedsAttachmentBeforeDone() {
        var task = taskBoard.create(academyId, leadId, general("교재 사진 제출", false, true, null), teachers);

        assertThatThrownBy(() -> taskBoard.markStatus(academyId, task.id(), teacherA, teachers, true))
                .satisfies(code("TASK_ATTACHMENT_REQUIRED"));

        var file = taskBoard.attach(
                academyId, task.id(), teacherA, teachers, "C:\\사진\\교재.png", "image/png", new byte[] {1, 2, 3});
        taskBoard.markStatus(academyId, task.id(), teacherA, teachers, true);

        assertThat(file.fileName()).isEqualTo("교재.png");
        assertThat(taskBoard.attachment(academyId, file.id()).content()).containsExactly(1, 2, 3);
        assertThatThrownBy(() -> taskBoard.removeAttachment(academyId, file.id(), teacherB))
                .isInstanceOf(WorklogForbiddenException.class);
    }

    /**
     * 담당자가 아닌 사람은 업무를 처리할 수 없는지 확인
     */
    @Test
    void onlyAssigneeCanProcessTask() {
        var task = taskBoard.create(academyId, leadId, general("개별 업무", false, false, Set.of(teacherA)), teachers);

        assertThatThrownBy(() -> taskBoard.markStatus(academyId, task.id(), teacherB, teachers, true))
                .isInstanceOf(WorklogForbiddenException.class);
        assertThatThrownBy(() -> taskBoard.saveReport(academyId, task.id(), teacherB, teachers, "남의 업무"))
                .isInstanceOf(WorklogForbiddenException.class);
    }

    /**
     * 배정 후보가 아닌 사람을 담당자로 고를 수 없는지 확인
     */
    @Test
    void rejectsAssigneeOutsideCandidates() {
        assertThatThrownBy(() -> taskBoard.create(
                        academyId, leadId, general("잘못된 배정", false, false, Set.of(leadId)), teachers))
                .satisfies(code("TASK_ASSIGNEE_INVALID"));
    }

    /**
     * 전원 배정 업무의 담당자가 조회할 때의 후보를 따르는지 확인
     */
    @Test
    void assignAllFollowsCurrentCandidates() {
        var task = taskBoard.create(academyId, leadId, general("전원 업무", false, false, null), teachers);

        assertThat(taskBoard.task(academyId, task.id(), teachers).assigneeCount()).isEqualTo(2);
        assertThat(taskBoard.task(academyId, task.id(), Set.of(teacherA)).assigneeCount()).isEqualTo(1);
        assertThat(taskBoard.tasksOf(academyId, teacherB, Set.of(teacherA))).isEmpty();
    }

    /**
     * 담당자에게 내려가는 업무에는 본인의 보고만 들어 있는지 확인
     */
    @Test
    void assigneeSeesOnlyOwnReport() {
        var task = taskBoard.create(academyId, leadId, general("보고 격리", false, false, null), teachers);
        taskBoard.saveReport(academyId, task.id(), teacherA, teachers, "A만 아는 내용");

        var forB = taskBoard.tasksOf(academyId, teacherB, teachers).getFirst();

        assertThat(forB.assignees()).hasSize(1);
        assertThat(forB.assignees().getFirst().accountId()).isEqualTo(teacherB);
        assertThat(forB.assignees().getFirst().reportText()).isEmpty();
        assertThat(forB.assigneeCount()).isEqualTo(2);
    }

    /**
     * MT 업무는 월수금과 화목토를 모두 체크해야 완료되는지 확인
     */
    @Test
    void mtTaskCompletesWhenBothPartsAreChecked() {
        var task = taskBoard.create(academyId, leadId, draft("MT 채점", TaskKind.MT, null), teachers);

        taskBoard.toggleMt(academyId, task.id(), teacherA, teachers, TngDayGroup.MWF, true);
        assertThat(progress(task, teacherA).status()).isEqualTo(TaskProgress.UNDONE);
        assertThat(progress(task, teacherA).complete()).isFalse();

        taskBoard.toggleMt(academyId, task.id(), teacherA, teachers, TngDayGroup.TTS, true);
        assertThat(progress(task, teacherA).complete()).isTrue();

        assertThatThrownBy(() -> taskBoard.markStatus(academyId, task.id(), teacherA, teachers, true))
                .satisfies(code("TASK_STATUS_NOT_MANUAL"));
    }

    /**
     * 전체 상담 업무는 명단을 가져오기 전에는 완료가 아니고, 전원에게 보내면 완료되는지 확인
     */
    @Test
    void counselTaskCompletesWhenEveryStudentIsSent() {
        var task = taskBoard.create(academyId, leadId, draft("10월 전체 상담", TaskKind.COUNSEL, null), teachers);
        assertThat(task.tag().name()).isEqualTo(TagCatalog.COUNSEL_TAG);
        assertThat(progress(task, teacherA).complete()).isFalse();

        var classroom = counselDesk.rosterClassrooms(academyId, task.id(), teacherA).getFirst();
        var entries = counselDesk.syncRoster(academyId, task.id(), teacherA, classroom.code());
        assertThat(entries).isNotEmpty();
        for (var entry : entries) {
            counselDesk.send(academyId, entry.id(), teacherA, today, "학습 태도", "수업 참여가 좋아짐");
        }

        var progress = progress(task, teacherA);
        assertThat(progress.counselTotal()).isEqualTo(entries.size());
        assertThat(progress.counselSent()).isEqualTo(entries.size());
        assertThat(progress.complete()).isTrue();
        assertThat(taskBoard.task(academyId, task.id(), teachers).doneCount()).isEqualTo(1);
    }

    /**
     * 보낸 상담을 다시 보내거나 고칠 수 없는지 확인
     */
    @Test
    void sentCounselCannotBeSentAgain() {
        var entry = firstEntry(taskBoard.create(academyId, leadId, draft("상담", TaskKind.COUNSEL, null), teachers));

        var sent = counselDesk.send(academyId, entry.id(), teacherA, today, "주제", "내용");

        assertThat(sent.delivery()).isEqualTo(CounselDelivery.SENT);
        assertThatThrownBy(() -> counselDesk.send(academyId, entry.id(), teacherA, today, "주제", "내용"))
                .satisfies(code("COUNSEL_ALREADY_SENT"));
        assertThatThrownBy(() -> counselDesk.saveDraft(academyId, entry.id(), teacherA, "다른 주제", "다른 내용"))
                .satisfies(code("COUNSEL_ALREADY_SENT"));
    }

    /**
     * 외부 시스템에 쓰기 전에 중단된 전송은 대조 뒤에 보내기 전으로 돌아가는지 확인
     */
    @Test
    void pendingDeliveryWithoutExternalRecordIsReleased() {
        var entry = firstEntry(taskBoard.create(academyId, leadId, draft("상담", TaskKind.COUNSEL, null), teachers));
        counselStore.claim(entry.id(), teacherA, today, "중단 전", "외부 시스템에 닿지 못한 내용 " + UUID.randomUUID());

        // 전송 중인 상담은 다시 보낼 수 없음
        assertThatThrownBy(() -> counselDesk.send(academyId, entry.id(), teacherA, today, "주제", "내용"))
                .satisfies(code("COUNSEL_DELIVERY_PENDING"));

        var resolved = counselDesk.resolvePending(academyId, entry.id(), teacherA);

        assertThat(resolved.delivery()).isEqualTo(CounselDelivery.IDLE);
    }

    /**
     * 외부 시스템에는 기록됐지만 확정하지 못한 전송은 대조 뒤에 보낸 것으로 확정되는지 확인
     */
    @Test
    void pendingDeliveryWithExternalRecordIsConfirmed() {
        var entry = firstEntry(taskBoard.create(academyId, leadId, draft("상담", TaskKind.COUNSEL, null), teachers));
        var content = "외부 시스템에만 남은 내용 " + UUID.randomUUID();
        counselStore.claim(entry.id(), teacherA, today, "확정 전 중단", content);
        tngGateway.postCounsel("S01", entry.studentCode(), today, "확정 전 중단", content);

        var resolved = counselDesk.resolvePending(academyId, entry.id(), teacherA);

        assertThat(resolved.delivery()).isEqualTo(CounselDelivery.SENT);
        assertThat(resolved.sentAt()).isNotNull();
    }

    /**
     * 명단을 다시 가져와도 써 둔 주제와 내용이 남는지 확인
     */
    @Test
    void rosterSyncKeepsDrafts() {
        var task = taskBoard.create(academyId, leadId, draft("상담", TaskKind.COUNSEL, null), teachers);
        var entry = firstEntry(task);
        counselDesk.saveDraft(academyId, entry.id(), teacherA, "써 둔 주제", "써 둔 내용");

        var again = counselDesk.syncRoster(academyId, task.id(), teacherA, entry.classCode());

        assertThat(again).filteredOn(candidate -> candidate.id().equals(entry.id()))
                .singleElement()
                .satisfies(kept -> {
                    assertThat(kept.subject()).isEqualTo("써 둔 주제");
                    assertThat(kept.content()).isEqualTo("써 둔 내용");
                });
    }

    /**
     * 다른 사람의 상담과 담당하지 않는 반의 명단을 다룰 수 없는지 확인
     */
    @Test
    void counselIsBoundToOwner() {
        var task = taskBoard.create(academyId, leadId, draft("상담", TaskKind.COUNSEL, null), teachers);
        var entry = firstEntry(task);
        var classOfB = counselDesk.rosterClassrooms(academyId, task.id(), teacherB).getFirst();

        assertThatThrownBy(() -> counselDesk.saveDraft(academyId, entry.id(), teacherB, "주제", "내용"))
                .isInstanceOf(WorklogForbiddenException.class);
        assertThatThrownBy(() -> counselDesk.syncRoster(academyId, task.id(), teacherA, classOfB.code()))
                .isInstanceOf(WorklogForbiddenException.class);
    }

    /**
     * 특강상담은 만들 때의 담당자와 명단이 고정되는지 확인
     */
    @Test
    void specialCounselFreezesAssigneesAndRoster() {
        var task = taskBoard.create(academyId, leadId, draft("겨울 특강상담", TaskKind.SPECIAL_COUNSEL, null), teachers);

        var entries = counselDesk.entries(academyId, task.id(), teacherA);
        assertThat(entries).isNotEmpty();
        assertThat(entries).allSatisfy(entry -> assertThat(entry.classCode()).startsWith("X"));
        assertThatThrownBy(() -> counselDesk.syncRoster(academyId, task.id(), teacherA, entries.getFirst().classCode()))
                .satisfies(code("COUNSEL_ROSTER_FIXED"));

        // 후보에서 빠져도 고정한 담당자는 그대로임
        assertThat(taskBoard.task(academyId, task.id(), Set.of()).assigneeCount()).isEqualTo(2);
    }

    /**
     * 개인 상담일정은 만든 사람만 보고 다루는지 확인
     */
    @Test
    void selfCounselBelongsToOwner() {
        var task = taskBoard.createSelfCounsel(academyId, teacherA, "내 상담일정", today, today.plusDays(7));

        assertThat(taskBoard.allTasks(academyId, teachers)).isEmpty();
        assertThat(taskBoard.selfCounselTasks(academyId, teacherA)).extracting(TaskView::id).containsExactly(task.id());
        assertThat(taskBoard.selfCounselTasks(academyId, teacherB)).isEmpty();
        assertThat(counselDesk.entries(academyId, task.id(), teacherA)).isNotEmpty();
        assertThatThrownBy(() -> counselDesk.entries(academyId, task.id(), teacherB))
                .isInstanceOf(WorklogForbiddenException.class);
    }

    /**
     * 개인 상담일정은 공용 업무를 다루는 경로로는 찾거나 지울 수 없고, 만든 사람만 지울 수 있는지 확인
     */
    @Test
    void selfCounselCannotBeManagedAsSharedTask() {
        var task = taskBoard.createSelfCounsel(academyId, teacherA, "내 상담일정", today, today.plusDays(7));

        assertThatThrownBy(() -> taskBoard.task(academyId, task.id(), teachers)).satisfies(code("TASK_NOT_FOUND"));
        assertThatThrownBy(() -> taskBoard.delete(academyId, task.id())).satisfies(code("TASK_NOT_FOUND"));
        assertThatThrownBy(() -> taskBoard.setArchived(academyId, task.id(), true)).satisfies(code("TASK_NOT_FOUND"));
        assertThatThrownBy(() -> taskBoard.deleteSelfCounsel(academyId, task.id(), teacherB))
                .isInstanceOf(WorklogForbiddenException.class);

        taskBoard.deleteSelfCounsel(academyId, task.id(), teacherA);

        assertThat(taskBoard.selfCounselTasks(academyId, teacherA)).isEmpty();
    }

    /**
     * 완료로 표시한 뒤에는 완료 조건이던 보고를 비우거나 마지막 첨부를 지울 수 없는지 확인
     */
    @Test
    void completionEvidenceCannotBeRemovedWhileDone() {
        var task = taskBoard.create(academyId, leadId, general("증빙이 필요한 업무", true, true, null), teachers);
        taskBoard.saveReport(academyId, task.id(), teacherA, teachers, "처리함");
        var file = taskBoard.attach(academyId, task.id(), teacherA, teachers, "증빙.png", "image/png", new byte[] {1});
        taskBoard.markStatus(academyId, task.id(), teacherA, teachers, true);

        assertThatThrownBy(() -> taskBoard.saveReport(academyId, task.id(), teacherA, teachers, " "))
                .satisfies(code("TASK_REPORT_REQUIRED"));
        assertThatThrownBy(() -> taskBoard.removeAttachment(academyId, file.id(), teacherA))
                .satisfies(code("TASK_ATTACHMENT_REQUIRED"));

        // 미완료로 되돌리면 지울 수 있음
        taskBoard.markStatus(academyId, task.id(), teacherA, teachers, false);
        taskBoard.removeAttachment(academyId, file.id(), teacherA);
    }

    /**
     * 태그를 지우면 그 태그를 쓰던 업무가 행정 태그로 옮겨지고, 고정 태그는 지울 수 없는지 확인
     */
    @Test
    void deletingTagMovesTasksToFallback() {
        var custom = tagCatalog.create(academyId, "임시", "#336699", "🧪");
        var task = taskBoard.create(
                academyId,
                leadId,
                new TaskDraft("임시 업무", "", custom.id(), today, today, TaskKind.GENERAL, true, null, false, false, List.of()),
                teachers);

        tagCatalog.delete(academyId, custom.id());

        assertThat(taskBoard.task(academyId, task.id(), teachers).tag().name()).isEqualTo(TagCatalog.FALLBACK_TAG);
        var counselTag = tag(TagCatalog.COUNSEL_TAG);
        assertThatThrownBy(() -> tagCatalog.delete(academyId, counselTag.id())).satisfies(code("TAG_FIXED"));
        assertThatThrownBy(() -> tagCatalog.update(academyId, counselTag.id(), "면담", "blue", "💬"))
                .satisfies(code("TAG_FIXED"));
    }

    /**
     * 일반 업무 입력 생성
     *
     * @param title 업무 이름
     * @param reportRequired 텍스트 보고가 필수인지
     * @param attachmentRequired 첨부가 필수인지
     * @param assignees 골라서 배정할 담당자. 전원 배정이면 null
     * @return 업무 입력
     */
    private TaskDraft general(String title, boolean reportRequired, boolean attachmentRequired, Set<UUID> assignees) {
        return new TaskDraft(
                title,
                "",
                tag("행정").id(),
                today,
                today.plusDays(3),
                TaskKind.GENERAL,
                assignees == null,
                assignees,
                reportRequired,
                attachmentRequired,
                List.of());
    }

    /**
     * 종류만 다른 전원 배정 업무 입력 생성
     *
     * @param title 업무 이름
     * @param kind 업무 종류
     * @param assignees 골라서 배정할 담당자. 전원 배정이면 null
     * @return 업무 입력
     */
    private TaskDraft draft(String title, TaskKind kind, Set<UUID> assignees) {
        return new TaskDraft(
                title,
                "",
                tag("행정").id(),
                today,
                today.plusDays(3),
                kind,
                assignees == null,
                assignees,
                false,
                false,
                List.of());
    }

    /**
     * 강사 A가 첫 담당 반의 명단을 가져와 얻은 첫 상담
     *
     * @param task 상담 업무
     * @return 상담
     */
    private CounselEntryView firstEntry(TaskView task) {
        var classroom = counselDesk.rosterClassrooms(academyId, task.id(), teacherA).getFirst();
        return counselDesk.syncRoster(academyId, task.id(), teacherA, classroom.code()).getFirst();
    }

    /**
     * 담당자 한 명의 지금 진행 조회
     *
     * @param task 업무
     * @param accountId 담당자 계정 ID
     * @return 담당자 진행
     */
    private AssigneeProgress progress(TaskView task, UUID accountId) {
        return taskBoard.task(academyId, task.id(), teachers).progressOf(accountId).orElseThrow();
    }
}
