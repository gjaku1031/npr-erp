package com.npr.erp.worklog.internal.tag;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 태그 저장소
 */
public interface WorklogTagRepository extends JpaRepository<WorklogTagEntity, UUID> {
    /**
     * 학원의 태그를 정렬 순서대로 조회
     *
     * @param academyId 학원 ID
     * @return 태그 목록
     */
    List<WorklogTagEntity> findAllByAcademyIdOrderBySortOrderAscNameAsc(UUID academyId);

    /**
     * 학원 안에서 ID로 조회
     *
     * @param id 태그 ID
     * @param academyId 학원 ID
     * @return 다른 학원의 태그이면 빈 값
     */
    Optional<WorklogTagEntity> findByIdAndAcademyId(UUID id, UUID academyId);

    /**
     * 학원 안에서 이름으로 조회
     *
     * @param academyId 학원 ID
     * @param name 이름
     * @return 없으면 빈 값
     */
    Optional<WorklogTagEntity> findByAcademyIdAndName(UUID academyId, String name);
}
