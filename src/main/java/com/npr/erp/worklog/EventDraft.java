package com.npr.erp.worklog;

import java.time.LocalDate;
import java.util.UUID;

/**
 * 일정을 만들거나 고칠 때의 입력
 *
 * @param title 제목
 * @param memo 메모
 * @param startDate 시작일
 * @param endDate 종료일
 * @param tagId 팀 일정에 붙일 태그 ID. 없으면 null. 개인일정은 무시
 */
public record EventDraft(String title, String memo, LocalDate startDate, LocalDate endDate, UUID tagId) {
}
