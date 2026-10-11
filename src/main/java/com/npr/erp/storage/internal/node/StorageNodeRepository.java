package com.npr.erp.storage.internal.node;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 노드 저장소
 */
public interface StorageNodeRepository extends JpaRepository<StorageNodeEntity, UUID> {
    /**
     * 학원의 전체 노드 조회
     *
     * 트리 계산은 이 결과를 메모리에 올려서 함
     *
     * @param academyId 학원 ID
     * @return 삭제된 것까지 포함한 전체 노드
     */
    List<StorageNodeEntity> findAllByAcademyId(UUID academyId);

    /**
     * 학원의 살아 있는 루트 조회
     *
     * @param academyId 학원 ID
     * @return 루트가 없으면 빈 값
     */
    @Query("select n from StorageNode n where n.academyId = :academyId and n.parentId is null "
            + "and n.status <> com.npr.erp.storage.StorageNodeStatus.DELETED "
            + "and n.status <> com.npr.erp.storage.StorageNodeStatus.FAILED")
    Optional<StorageNodeEntity> findRoot(@Param("academyId") UUID academyId);

    /**
     * 학원 안에서 노드를 쓰기 잠금으로 조회
     *
     * @param id 노드 ID
     * @param academyId 학원 ID
     * @return 다른 학원의 노드이면 빈 값
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select n from StorageNode n where n.id = :id and n.academyId = :academyId")
    Optional<StorageNodeEntity> findLocked(@Param("id") UUID id, @Param("academyId") UUID academyId);
}
