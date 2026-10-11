package com.npr.erp.worklog.internal.task;

import com.npr.erp.tng.TngDayGroup;
import com.npr.erp.worklog.TaskProgress;
import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * 담당자 한 명의 업무 처리 상태와 보고
 */
@Getter
@Entity(name = "WorklogTaskStatus")
@Table(name = "worklog_task_status")
public class WorklogTaskStatusEntity {
    /**
     * 업무 ID와 계정 ID
     */
    @EmbeddedId
    private TaskAssigneeId id;

    /**
     * 담당자가 표시한 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private TaskProgress status;

    /**
     * 텍스트 보고
     */
    @Column(name = "report_text", nullable = false)
    private String reportText;

    /**
     * MT 업무의 월수금 완료 여부
     */
    @Column(name = "mwf_done", nullable = false)
    private boolean mwfDone;

    /**
     * MT 업무의 화목토 완료 여부
     */
    @Column(name = "tts_done", nullable = false)
    private boolean ttsDone;

    /**
     * 수정 시각
     */
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * JPA 인스턴스 초기화
     */
    protected WorklogTaskStatusEntity() {
    }

    /**
     * 아직 아무것도 표시하지 않은 새 상태 생성
     *
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @param now 생성 시각
     */
    public WorklogTaskStatusEntity(UUID taskId, UUID accountId, Instant now) {
        this.id = new TaskAssigneeId(taskId, accountId);
        this.status = TaskProgress.NONE;
        this.reportText = "";
        this.updatedAt = now;
    }

    /**
     * 완료 또는 미완료로 표시
     *
     * @param done 완료로 표시할지
     * @param now 변경 시각
     */
    public void mark(boolean done, Instant now) {
        this.status = done ? TaskProgress.DONE : TaskProgress.UNDONE;
        this.updatedAt = now;
    }

    /**
     * MT 업무의 요일 묶음 하나를 체크하거나 해제하고 전체 상태를 다시 계산
     *
     * 둘 다 체크하면 완료, 하나만 체크하면 미완료, 둘 다 아니면 표시 전
     *
     * @param part 월수금 또는 화목토
     * @param done 체크할지
     * @param now 변경 시각
     */
    public void toggleMt(TngDayGroup part, boolean done, Instant now) {
        if (part == TngDayGroup.MWF) {
            this.mwfDone = done;
        } else {
            this.ttsDone = done;
        }
        if (mwfDone && ttsDone) {
            this.status = TaskProgress.DONE;
        } else {
            this.status = mwfDone || ttsDone ? TaskProgress.UNDONE : TaskProgress.NONE;
        }
        this.updatedAt = now;
    }

    /**
     * 텍스트 보고 교체
     *
     * @param text 보고 내용
     * @param now 변경 시각
     */
    public void writeReport(String text, Instant now) {
        this.reportText = text;
        this.updatedAt = now;
    }
}
