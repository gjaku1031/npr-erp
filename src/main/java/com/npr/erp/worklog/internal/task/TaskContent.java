package com.npr.erp.worklog.internal.task;

import com.npr.erp.worklog.TaskKind;
import java.time.LocalDate;
import java.util.UUID;

/**
 * 검증과 정리를 마친 업무 내용
 *
 * @param title 업무 이름
 * @param description 내용
 * @param tagId 태그 ID
 * @param startDate 시작일
 * @param dueDate 마감일
 * @param kind 업무 종류
 * @param assignAll 배정 후보 전원에게 배정할지
 * @param reportRequired 완료에 텍스트 보고가 필요한지
 * @param attachmentRequired 완료에 첨부가 필요한지
 * @param linksJson 참고 링크 목록의 JSON
 */
public record TaskContent(
        String title,
        String description,
        UUID tagId,
        LocalDate startDate,
        LocalDate dueDate,
        TaskKind kind,
        boolean assignAll,
        boolean reportRequired,
        boolean attachmentRequired,
        String linksJson) {
}
