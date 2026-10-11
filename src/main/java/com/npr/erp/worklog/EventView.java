package com.npr.erp.worklog;

import java.time.LocalDate;
import java.util.UUID;

/**
 * 일정
 *
 * @param id 일정 ID
 * @param kind 일정 종류
 * @param ownerAccountId 개인일정의 소유자. 팀 일정은 null
 * @param tag 팀 일정의 태그. 없으면 null
 * @param title 제목
 * @param memo 메모
 * @param startDate 시작일
 * @param endDate 종료일
 */
public record EventView(
        UUID id,
        EventKind kind,
        UUID ownerAccountId,
        TagView tag,
        String title,
        String memo,
        LocalDate startDate,
        LocalDate endDate) {
}
