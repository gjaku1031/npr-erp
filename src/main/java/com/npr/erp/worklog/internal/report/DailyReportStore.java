package com.npr.erp.worklog.internal.report;

import com.npr.erp.worklog.DailyReportView;
import com.npr.erp.worklog.ReportPayload;
import com.npr.erp.worklog.ReportStatus;
import com.npr.erp.worklog.WorklogConflictException;
import com.npr.erp.worklog.WorklogNotFoundException;
import com.npr.erp.worklog.internal.support.WorklogJson;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.UnaryOperator;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 일일보고의 DB 쪽 처리
 *
 * 메서드 하나가 짧은 트랜잭션 하나임
 */
@Service
@RequiredArgsConstructor
public class DailyReportStore {
    /**
     * 지난 보고 목록의 최대 건수
     */
    private static final int HISTORY_LIMIT = 60;

    /**
     * 일일보고 저장소
     */
    private final WorklogDailyReportRepository repository;

    /**
     * JSON 변환
     */
    private final WorklogJson json;

    /**
     * 한 사람의 한 날짜 보고 조회
     *
     * @param academyId 학원 ID
     * @param accountId 작성한 계정 ID
     * @param date 날짜
     * @return 없으면 빈 값
     */
    @Transactional(readOnly = true)
    public Optional<DailyReportView> find(UUID academyId, UUID accountId, LocalDate date) {
        return repository.findByAcademyIdAndAccountIdAndReportDate(academyId, accountId, date).map(this::toView);
    }

    /**
     * 한 날짜에 여러 사람이 낸 보고 조회
     *
     * @param academyId 학원 ID
     * @param date 날짜
     * @param accountIds 계정 ID 목록
     * @return 보고 목록
     */
    @Transactional(readOnly = true)
    public List<DailyReportView> findAll(UUID academyId, LocalDate date, Collection<UUID> accountIds) {
        if (accountIds.isEmpty()) {
            return List.of();
        }
        return repository.findAllByAcademyIdAndReportDateAndAccountIdIn(academyId, date, accountIds).stream()
                .map(this::toView)
                .toList();
    }

    /**
     * 한 사람이 제출한 지난 보고 조회
     *
     * @param academyId 학원 ID
     * @param accountId 작성한 계정 ID
     * @return 최근 날짜부터
     */
    @Transactional(readOnly = true)
    public List<DailyReportView> history(UUID academyId, UUID accountId) {
        return repository
                .findAllByAcademyIdAndAccountIdAndStatusOrderByReportDateDesc(
                        academyId, accountId, ReportStatus.SUBMITTED, Limit.of(HISTORY_LIMIT))
                .stream()
                .map(this::toView)
                .toList();
    }

    /**
     * 작성 중인 내용을 고쳐 저장
     *
     * 보고가 아직 없으면 빈 내용에서 시작해 새로 만듦
     *
     * @param academyId 학원 ID
     * @param accountId 작성한 계정 ID
     * @param date 날짜
     * @param change 지금 내용을 받아 새 내용을 돌려주는 함수
     * @throws WorklogConflictException 이미 제출했을 때
     */
    @Transactional
    public void saveDraft(UUID academyId, UUID accountId, LocalDate date, UnaryOperator<ReportPayload> change) {
        var now = Instant.now();
        var existing = repository.findLocked(academyId, accountId, date);
        if (existing.isPresent()) {
            var report = existing.get();
            report.writeDraft(json.write(change.apply(json.read(report.getPayload(), ReportPayload.class))), now);
        } else {
            repository.save(new WorklogDailyReportEntity(
                    academyId, accountId, date, json.write(change.apply(ReportPayload.empty())), now));
        }
    }

    /**
     * 제출
     *
     * @param academyId 학원 ID
     * @param accountId 작성한 계정 ID
     * @param date 날짜
     * @param payload 제출할 때의 사실을 담은 내용
     * @return 제출한 보고
     */
    @Transactional
    public DailyReportView submit(UUID academyId, UUID accountId, LocalDate date, ReportPayload payload) {
        var now = Instant.now();
        var report = repository.findLocked(academyId, accountId, date)
                .orElseGet(() -> repository.save(
                        new WorklogDailyReportEntity(academyId, accountId, date, json.write(payload), now)));
        report.submit(json.write(payload), now);
        return toView(report);
    }

    /**
     * 제출 되돌리기
     *
     * @param academyId 학원 ID
     * @param accountId 작성한 계정 ID
     * @param date 날짜
     */
    @Transactional
    public void reopen(UUID academyId, UUID accountId, LocalDate date) {
        locked(academyId, accountId, date).reopen(Instant.now());
    }

    /**
     * 확인 처리
     *
     * @param academyId 학원 ID
     * @param accountId 작성한 계정 ID
     * @param date 날짜
     * @param reviewerId 확인하는 계정 ID
     */
    @Transactional
    public void confirm(UUID academyId, UUID accountId, LocalDate date, UUID reviewerId) {
        locked(academyId, accountId, date).confirm(reviewerId, Instant.now());
    }

    /**
     * 보고를 쓰기 잠금으로 가져옴
     *
     * @param academyId 학원 ID
     * @param accountId 작성한 계정 ID
     * @param date 날짜
     * @return 잠근 보고
     * @throws WorklogNotFoundException 보고가 없을 때
     */
    private WorklogDailyReportEntity locked(UUID academyId, UUID accountId, LocalDate date) {
        return repository.findLocked(academyId, accountId, date)
                .orElseThrow(() -> new WorklogNotFoundException("REPORT_NOT_FOUND", "보고를 찾을 수 없습니다."));
    }

    /**
     * 엔티티를 공개 조회 결과로 변환
     *
     * 확인 표시는 제출 상태일 때만 참으로 내보냄
     *
     * @param report 보고 엔티티
     * @return 보고 조회 결과
     */
    private DailyReportView toView(WorklogDailyReportEntity report) {
        return new DailyReportView(
                report.getAccountId(),
                report.getReportDate(),
                report.getStatus(),
                report.getStatus() == ReportStatus.SUBMITTED && report.isConfirmed(),
                report.getSubmittedAt(),
                json.read(report.getPayload(), ReportPayload.class));
    }
}
