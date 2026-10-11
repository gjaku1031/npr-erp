package com.npr.erp.worklog;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 업무를 만들거나 고칠 때의 입력
 *
 * @param title 업무 이름
 * @param description 내용. 마크다운
 * @param tagId 태그 ID. 상담 종류는 무시하고 상담 태그를 씀
 * @param startDate 시작일
 * @param dueDate 마감일
 * @param kind 업무 종류. 만든 뒤에는 바꿀 수 없음
 * @param assignAll 배정 후보 전원에게 배정할지
 * @param assigneeIds 골라서 배정할 계정 ID. 전원 배정이면 무시
 * @param reportRequired 완료하려면 텍스트 보고가 있어야 하는지
 * @param attachmentRequired 완료하려면 첨부가 있어야 하는지
 * @param links 참고 링크
 */
public record TaskDraft(
        String title,
        String description,
        UUID tagId,
        LocalDate startDate,
        LocalDate dueDate,
        TaskKind kind,
        boolean assignAll,
        Set<UUID> assigneeIds,
        boolean reportRequired,
        boolean attachmentRequired,
        List<TaskLink> links) {
}
