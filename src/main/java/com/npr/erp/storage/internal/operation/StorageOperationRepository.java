package com.npr.erp.storage.internal.operation;

import com.npr.erp.storage.StorageOperationStatus;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 작업 원장 저장소
 */
public interface StorageOperationRepository extends JpaRepository<StorageOperationEntity, UUID> {
    /**
     * 특정 상태의 작업을 기록 순으로 조회
     *
     * @param status 작업 상태
     * @return 작업 목록
     */
    List<StorageOperationEntity> findAllByStatusOrderByCreatedAtAsc(StorageOperationStatus status);

    /**
     * 학원의 최근 작업 조회
     *
     * @param academyId 학원 ID
     * @param limit 최대 건수
     * @return 최근 것부터
     */
    List<StorageOperationEntity> findAllByAcademyIdOrderByCreatedAtDesc(UUID academyId, Limit limit);

    /**
     * 작업을 쓰기 잠금으로 조회
     *
     * @param id 작업 ID
     * @return 없으면 빈 값
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select o from StorageOperation o where o.id = :id")
    Optional<StorageOperationEntity> findLocked(@Param("id") UUID id);
}
