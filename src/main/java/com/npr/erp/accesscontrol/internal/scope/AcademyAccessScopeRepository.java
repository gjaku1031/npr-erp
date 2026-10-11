package com.npr.erp.accesscontrol.internal.scope;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 학원 권한 정책 저장소
 */
public interface AcademyAccessScopeRepository extends JpaRepository<AcademyAccessScopeEntity, UUID> {
    /**
     * 정책 행을 쓰기 잠금으로 조회
     *
     * @param academyId 학원 ID
     * @return 초기화되지 않은 학원이면 빈 값
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select scope from AcademyAccessScope scope where scope.academyId = :academyId")
    Optional<AcademyAccessScopeEntity> findForUpdate(@Param("academyId") UUID academyId);
}
