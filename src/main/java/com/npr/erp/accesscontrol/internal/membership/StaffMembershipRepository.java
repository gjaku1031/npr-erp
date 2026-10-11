package com.npr.erp.accesscontrol.internal.membership;

import com.npr.erp.accesscontrol.MembershipStatus;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 소속 저장소
 */
public interface StaffMembershipRepository extends JpaRepository<StaffMembershipEntity, UUID> {
    /**
     * 학원의 전체 소속을 생성 순으로 조회
     *
     * @param academyId 학원 ID
     * @return 소속 목록
     */
    List<StaffMembershipEntity> findAllByAcademyIdOrderByCreatedAtAsc(UUID academyId);

    /**
     * 학원 안에서 ID로 조회
     *
     * @param id 소속 ID
     * @param academyId 학원 ID
     * @return 다른 학원의 소속이면 빈 값
     */
    Optional<StaffMembershipEntity> findByIdAndAcademyId(UUID id, UUID academyId);

    /**
     * 계정의 특정 상태 소속 조회
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     * @param status 소속 상태
     * @return 없으면 빈 값
     */
    Optional<StaffMembershipEntity> findByAcademyIdAndAccountIdAndStatus(
            UUID academyId, UUID accountId, MembershipStatus status);
}
