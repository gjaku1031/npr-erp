package com.npr.erp.accesscontrol.internal.assignment;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 역할 배정 저장소
 */
public interface RoleAssignmentRepository extends JpaRepository<RoleAssignmentEntity, UUID> {
    /**
     * 한 소속의 유효한 배정을 배정 순으로 조회
     *
     * @param staffMembershipId 소속 ID
     * @return 회수되지 않은 배정
     */
    List<RoleAssignmentEntity> findAllByStaffMembershipIdAndRevokedAtIsNullOrderByAssignedAtAsc(
            UUID staffMembershipId);

    /**
     * 학원 전체의 유효한 배정을 배정 순으로 조회
     *
     * @param academyId 학원 ID
     * @return 회수되지 않은 배정
     */
    List<RoleAssignmentEntity> findAllByAcademyIdAndRevokedAtIsNullOrderByAssignedAtAsc(UUID academyId);
}
