package com.npr.erp.worklog.internal.task;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;
import lombok.Getter;

/**
 * 업무와 계정을 묶는 복합 키
 *
 * 담당자별 처리 상태의 키로 씀
 */
@Getter
@Embeddable
public final class TaskAssigneeId implements Serializable {
    /**
     * 업무 ID
     */
    @Column(name = "task_id", nullable = false)
    private UUID taskId;

    /**
     * 계정 ID
     */
    @Column(name = "account_id", nullable = false)
    private UUID accountId;

    /**
     * JPA 인스턴스 초기화
     */
    TaskAssigneeId() {
    }

    /**
     * 업무와 계정으로 복합 키 생성
     *
     * @param taskId 업무 ID
     * @param accountId 계정 ID
     */
    public TaskAssigneeId(UUID taskId, UUID accountId) {
        this.taskId = taskId;
        this.accountId = accountId;
    }

    /**
     * 업무 ID와 계정 ID가 모두 같으면 같은 키
     */
    @Override
    public boolean equals(Object other) {
        return this == other
                || other instanceof TaskAssigneeId that
                        && Objects.equals(taskId, that.taskId)
                        && Objects.equals(accountId, that.accountId);
    }

    /**
     * 업무 ID와 계정 ID 기준 해시
     */
    @Override
    public int hashCode() {
        return Objects.hash(taskId, accountId);
    }
}
