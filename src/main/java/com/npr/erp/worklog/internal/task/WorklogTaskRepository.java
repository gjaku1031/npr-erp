package com.npr.erp.worklog.internal.task;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 업무 저장소
 */
public interface WorklogTaskRepository extends JpaRepository<WorklogTaskEntity, UUID> {
    /**
     * 학원의 전체 업무를 시작일, 마감일, 생성 순으로 조회
     *
     * @param academyId 학원 ID
     * @return 업무 목록
     */
    List<WorklogTaskEntity> findAllByAcademyIdOrderByStartDateAscDueDateAscCreatedAtAsc(UUID academyId);

    /**
     * 학원 안에서 ID로 조회
     *
     * @param id 업무 ID
     * @param academyId 학원 ID
     * @return 다른 학원의 업무이면 빈 값
     */
    Optional<WorklogTaskEntity> findByIdAndAcademyId(UUID id, UUID academyId);
}
