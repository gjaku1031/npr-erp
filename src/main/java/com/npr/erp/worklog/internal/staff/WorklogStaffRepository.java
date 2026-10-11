package com.npr.erp.worklog.internal.staff;

import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 직원 설정 저장소
 */
public interface WorklogStaffRepository extends JpaRepository<WorklogStaffEntity, WorklogStaffId> {
    /**
     * 학원 안에서 여러 계정의 설정 조회
     *
     * @param academyId 학원 ID
     * @param accountIds 계정 ID 목록
     * @return 저장된 설정만
     */
    List<WorklogStaffEntity> findAllByIdAcademyIdAndIdAccountIdIn(UUID academyId, Collection<UUID> accountIds);
}
