package com.npr.erp.worklog;

import java.time.LocalDate;
import java.util.List;

/**
 * 한 날짜의 일일보고 정의
 *
 * @param date 날짜
 * @param specialPeriod 만들 때 특강기간이었는지. 나중에 설정을 꺼도 바뀌지 않음
 * @param items 체크리스트 항목
 * @param phase 오늘을 기준으로 본 시기
 */
public record JournalView(LocalDate date, boolean specialPeriod, List<JournalItemView> items, JournalPhase phase) {
}
