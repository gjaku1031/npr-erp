package com.npr.erp.worklog.internal.task;

import static com.npr.generated.jooq.Tables.WORKLOG_TASK_ASSIGNEE;

import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * 업무에 골라서 배정한 담당자의 저장
 */
@Repository
@RequiredArgsConstructor
public class TaskAssigneeStore {
    /**
     * jOOQ 실행 문맥
     */
    private final DSLContext dsl;

    /**
     * 업무의 담당자를 주어진 집합으로 교체
     *
     * @param taskId 업무 ID
     * @param accountIds 담당자 계정 ID
     */
    public void replace(UUID taskId, Set<UUID> accountIds) {
        dsl.deleteFrom(WORKLOG_TASK_ASSIGNEE).where(WORKLOG_TASK_ASSIGNEE.TASK_ID.eq(taskId)).execute();
        for (var accountId : accountIds) {
            dsl.insertInto(WORKLOG_TASK_ASSIGNEE)
                    .set(WORKLOG_TASK_ASSIGNEE.TASK_ID, taskId)
                    .set(WORKLOG_TASK_ASSIGNEE.ACCOUNT_ID, accountId)
                    .execute();
        }
    }

    /**
     * 여러 업무의 담당자를 한 번에 조회
     *
     * @param taskIds 업무 ID 목록
     * @return 업무 ID별 담당자 계정 ID. 골라서 배정한 사람이 없는 업무는 키가 없음
     */
    public Map<UUID, Set<UUID>> load(Collection<UUID> taskIds) {
        var result = new HashMap<UUID, Set<UUID>>();
        if (taskIds.isEmpty()) {
            return result;
        }
        dsl.selectFrom(WORKLOG_TASK_ASSIGNEE)
                .where(WORKLOG_TASK_ASSIGNEE.TASK_ID.in(taskIds))
                .forEach(record -> result
                        .computeIfAbsent(record.getTaskId(), ignored -> new HashSet<>())
                        .add(record.getAccountId()));
        return result;
    }
}
