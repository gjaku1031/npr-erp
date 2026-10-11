package com.npr.erp.worklog;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

/**
 * 한 사람이 한 날짜에 낸 일일보고
 *
 * @param accountId 작성한 계정 ID
 * @param date 날짜
 * @param status 작성 상태
 * @param confirmed 제출됐고 확인까지 끝났는지
 * @param submittedAt 제출 시각. 제출 전이면 null
 * @param payload 내용
 */
public record DailyReportView(
        UUID accountId, LocalDate date, ReportStatus status, boolean confirmed, Instant submittedAt, ReportPayload payload) {
    /**
     * 현황판에 보이는 상태
     *
     * @return 미제출, 확인 대기, 확인 완료 중 하나
     */
    public ReportState state() {
        if (status != ReportStatus.SUBMITTED) {
            return ReportState.NOT_SUBMITTED;
        }
        return confirmed ? ReportState.CONFIRMED : ReportState.WAITING;
    }
}
