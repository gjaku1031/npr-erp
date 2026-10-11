package com.npr.erp.worklog.internal.report;

import com.npr.erp.worklog.ReportStatus;
import com.npr.erp.worklog.WorklogConflictException;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 한 사람이 한 날짜에 낸 일일보고
 *
 * 상태 전이 규칙을 이 엔티티가 가짐: 작성 중 → 제출 → 확인, 확인 전에만 제출을 되돌림
 */
@Getter
@Entity(name = "WorklogDailyReport")
@Table(name = "worklog_daily_report")
public class WorklogDailyReportEntity {
    /**
     * 보고 ID
     */
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * 학원 ID
     */
    @Column(name = "academy_id", nullable = false, updatable = false)
    private UUID academyId;

    /**
     * 작성한 계정 ID
     */
    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    /**
     * 날짜
     */
    @Column(name = "report_date", nullable = false, updatable = false)
    private LocalDate reportDate;

    /**
     * 작성 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 16)
    private ReportStatus status;

    /**
     * 확인이 끝났는지
     */
    @Column(name = "confirmed", nullable = false)
    private boolean confirmed;

    /**
     * 확인한 계정 ID
     */
    @Column(name = "confirmed_by")
    private UUID confirmedBy;

    /**
     * 내용의 JSON
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "payload", columnDefinition = "jsonb", nullable = false)
    private String payload;

    /**
     * 제출 시각
     */
    @Column(name = "submitted_at")
    private Instant submittedAt;

    /**
     * 수정 시각
     */
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * JPA 인스턴스 초기화
     */
    protected WorklogDailyReportEntity() {
    }

    /**
     * 작성 중인 새 보고 생성
     *
     * @param academyId 학원 ID
     * @param accountId 작성한 계정 ID
     * @param reportDate 날짜
     * @param payloadJson 내용의 JSON
     * @param now 생성 시각
     */
    public WorklogDailyReportEntity(
            UUID academyId, UUID accountId, LocalDate reportDate, String payloadJson, Instant now) {
        this.id = UUID.randomUUID();
        this.academyId = academyId;
        this.accountId = accountId;
        this.reportDate = reportDate;
        this.status = ReportStatus.DRAFT;
        this.payload = payloadJson;
        this.updatedAt = now;
    }

    /**
     * 작성 중인 내용 교체
     *
     * @param payloadJson 내용의 JSON
     * @param now 변경 시각
     * @throws WorklogConflictException 이미 제출했을 때
     */
    public void writeDraft(String payloadJson, Instant now) {
        requireDraft();
        this.payload = payloadJson;
        this.updatedAt = now;
    }

    /**
     * 제출: 작성 중 → 제출
     *
     * 확인 표시는 항상 지움
     *
     * @param payloadJson 제출할 때의 사실을 담은 내용의 JSON
     * @param now 제출 시각
     * @throws WorklogConflictException 이미 제출했을 때
     */
    public void submit(String payloadJson, Instant now) {
        requireDraft();
        this.payload = payloadJson;
        this.status = ReportStatus.SUBMITTED;
        this.confirmed = false;
        this.confirmedBy = null;
        this.submittedAt = now;
        this.updatedAt = now;
    }

    /**
     * 제출 되돌리기: 제출 → 작성 중
     *
     * @param now 변경 시각
     * @throws WorklogConflictException 제출하지 않았거나 확인이 끝났을 때
     */
    public void reopen(Instant now) {
        if (status != ReportStatus.SUBMITTED) {
            throw new WorklogConflictException("REPORT_NOT_SUBMITTED", "제출한 보고가 아닙니다.");
        }
        if (confirmed) {
            throw new WorklogConflictException("REPORT_CONFIRMED", "확인이 끝난 보고는 고칠 수 없습니다.");
        }
        this.status = ReportStatus.DRAFT;
        this.submittedAt = null;
        this.updatedAt = now;
    }

    /**
     * 확인 처리
     *
     * @param reviewerId 확인하는 계정 ID
     * @param now 확인 시각
     * @throws WorklogConflictException 제출되지 않은 보고일 때
     */
    public void confirm(UUID reviewerId, Instant now) {
        if (status != ReportStatus.SUBMITTED) {
            throw new WorklogConflictException("REPORT_NOT_SUBMITTED", "제출된 보고만 확인할 수 있습니다.");
        }
        this.confirmed = true;
        this.confirmedBy = reviewerId;
        this.updatedAt = now;
    }

    /**
     * 작성 중인지 확인
     *
     * @throws WorklogConflictException 이미 제출했을 때
     */
    private void requireDraft() {
        if (status != ReportStatus.DRAFT) {
            throw new WorklogConflictException("REPORT_SUBMITTED", "이미 제출한 보고입니다. 고치려면 제출을 되돌려 주세요.");
        }
    }
}
