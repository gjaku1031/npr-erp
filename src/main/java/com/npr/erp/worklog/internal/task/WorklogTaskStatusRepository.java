package com.npr.erp.worklog.internal.task;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 업무 처리 상태 저장소
 */
public interface WorklogTaskStatusRepository extends JpaRepository<WorklogTaskStatusEntity, TaskAssigneeId> {
    /**
     * 여러 업무의 처리 상태를 한 번에 조회
     *
     * @param taskIds 업무 ID 목록
     * @return 처리 상태 목록
     */
    List<WorklogTaskStatusEntity> findAllByIdTaskIdIn(Collection<UUID> taskIds);
}
