package com.npr.erp.worklog;

import java.time.LocalDate;

/**
 * 날짜 목록에 보여 주는 일일보고 요약
 *
 * @param date 날짜
 * @param specialPeriod 특강기간에 만든 것인지
 * @param itemCount 체크리스트 항목 수
 * @param submittedCount 제출한 사람 수
 * @param confirmedCount 확인까지 끝난 사람 수
 * @param phase 오늘을 기준으로 본 시기
 */
public record JournalSummary(
        LocalDate date, boolean specialPeriod, int itemCount, int submittedCount, int confirmedCount, JournalPhase phase) {
}
