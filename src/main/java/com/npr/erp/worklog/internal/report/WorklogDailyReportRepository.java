package com.npr.erp.worklog.internal.report;

import com.npr.erp.worklog.ReportStatus;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/**
 * 일일보고 저장소
 */
public interface WorklogDailyReportRepository extends JpaRepository<WorklogDailyReportEntity, UUID> {
    /**
     * 한 사람의 한 날짜 보고 조회
     *
     * @param academyId 학원 ID
     * @param accountId 작성한 계정 ID
     * @param reportDate 날짜
     * @return 없으면 빈 값
     */
    Optional<WorklogDailyReportEntity> findByAcademyIdAndAccountIdAndReportDate(
            UUID academyId, UUID accountId, LocalDate reportDate);

    /**
     * 한 사람의 한 날짜 보고를 쓰기 잠금으로 조회
     *
     * @param academyId 학원 ID
     * @param accountId 작성한 계정 ID
     * @param reportDate 날짜
     * @return 없으면 빈 값
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select r from WorklogDailyReport r
            where r.academyId = :academyId and r.accountId = :accountId and r.reportDate = :reportDate
            """)
    Optional<WorklogDailyReportEntity> findLocked(
            @Param("academyId") UUID academyId,
            @Param("accountId") UUID accountId,
            @Param("reportDate") LocalDate reportDate);

    /**
     * 한 날짜에 여러 사람이 낸 보고 조회
     *
     * @param academyId 학원 ID
     * @param reportDate 날짜
     * @param accountIds 계정 ID 목록
     * @return 보고 목록
     */
    List<WorklogDailyReportEntity> findAllByAcademyIdAndReportDateAndAccountIdIn(
            UUID academyId, LocalDate reportDate, Collection<UUID> accountIds);

    /**
     * 한 사람의 보고를 상태로 걸러 최근 날짜부터 조회
     *
     * @param academyId 학원 ID
     * @param accountId 작성한 계정 ID
     * @param status 작성 상태
     * @param limit 최대 건수
     * @return 보고 목록
     */
    List<WorklogDailyReportEntity> findAllByAcademyIdAndAccountIdAndStatusOrderByReportDateDesc(
            UUID academyId, UUID accountId, ReportStatus status, Limit limit);
}
