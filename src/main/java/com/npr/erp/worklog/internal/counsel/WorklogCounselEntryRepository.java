package com.npr.erp.worklog.internal.counsel;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 상담 저장소
 */
public interface WorklogCounselEntryRepository extends JpaRepository<WorklogCounselEntryEntity, UUID> {
    /**
     * 담당자의 상담 대상을 반 이름, 학생 이름 순으로 조회
     *
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @return 상담 목록
     */
    List<WorklogCounselEntryEntity> findAllByTaskIdAndAccountIdOrderByClassNameAscStudentNameAsc(
            UUID taskId, UUID accountId);

    /**
     * 담당자의 한 반 상담 대상 조회
     *
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @param classCode 반 코드
     * @return 상담 목록
     */
    List<WorklogCounselEntryEntity> findAllByTaskIdAndAccountIdAndClassCodeOrderByStudentNameAsc(
            UUID taskId, UUID accountId, String classCode);

    /**
     * 상담을 쓰기 잠금으로 조회
     *
     * @param id 상담 ID
     * @return 없으면 빈 값
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select e from WorklogCounselEntry e where e.id = :id")
    Optional<WorklogCounselEntryEntity> findLocked(@Param("id") UUID id);
}
