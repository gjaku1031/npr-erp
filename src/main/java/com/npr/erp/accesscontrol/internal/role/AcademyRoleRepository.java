package com.npr.erp.accesscontrol.internal.role;

import com.npr.erp.accesscontrol.AcademyRoleStatus;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 역할 저장소
 */
public interface AcademyRoleRepository extends JpaRepository<AcademyRoleEntity, UUID> {
    /**
     * 학원의 전체 역할을 생성 순으로 조회
     *
     * @param academyId 학원 ID
     * @return 역할 목록
     */
    List<AcademyRoleEntity> findAllByAcademyIdOrderByCreatedAtAsc(UUID academyId);

    /**
     * 학원 안에서 ID로 조회
     *
     * @param id 역할 ID
     * @param academyId 학원 ID
     * @return 다른 학원의 역할이면 빈 값
     */
    Optional<AcademyRoleEntity> findByIdAndAcademyId(UUID id, UUID academyId);

    /**
     * 같은 학원의 특정 상태 역할을 ID 목록으로 조회
     *
     * @param ids 역할 ID 목록
     * @param academyId 학원 ID
     * @param status 역할 상태
     * @return 조건에 맞는 역할만
     */
    List<AcademyRoleEntity> findAllByIdInAndAcademyIdAndStatus(
            Collection<UUID> ids, UUID academyId, AcademyRoleStatus status);

    /**
     * 같은 정규화 이름의 역할이 있는지 확인
     *
     * @param academyId 학원 ID
     * @param normalizedName 정규화 이름
     * @return 있으면 true
     */
    boolean existsByAcademyIdAndNormalizedName(UUID academyId, String normalizedName);

    /**
     * 자기 자신을 뺀 같은 정규화 이름의 역할이 있는지 확인
     *
     * @param academyId 학원 ID
     * @param normalizedName 정규화 이름
     * @param id 제외할 역할 ID
     * @return 있으면 true
     */
    boolean existsByAcademyIdAndNormalizedNameAndIdNot(UUID academyId, String normalizedName, UUID id);
}
