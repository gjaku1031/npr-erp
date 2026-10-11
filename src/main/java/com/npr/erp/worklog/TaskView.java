package com.npr.erp.worklog;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 업무 조회 결과
 *
 * @param id 업무 ID
 * @param title 업무 이름
 * @param description 내용
 * @param tag 태그
 * @param startDate 시작일
 * @param dueDate 마감일
 * @param kind 업무 종류
 * @param assignAll 배정 후보 전원에게 배정했는지
 * @param reportRequired 완료에 텍스트 보고가 필요한지
 * @param attachmentRequired 완료에 첨부가 필요한지
 * @param archived 보관했는지
 * @param links 참고 링크
 * @param ownerAccountId 개인 상담일정의 소유자. 다른 종류는 null
 * @param assignees 담당자별 진행. 담당자 본인에게 보여 줄 때는 본인 것만 들어 있음
 * @param assigneeCount 전체 담당자 수
 * @param doneCount 완료한 담당자 수
 */
public record TaskView(
        UUID id,
        String title,
        String description,
        TagView tag,
        LocalDate startDate,
        LocalDate dueDate,
        TaskKind kind,
        boolean assignAll,
        boolean reportRequired,
        boolean attachmentRequired,
        boolean archived,
        List<TaskLink> links,
        UUID ownerAccountId,
        List<AssigneeProgress> assignees,
        int assigneeCount,
        int doneCount) {
    /**
     * 담당자 한 명의 진행 조회
     *
     * @param accountId 계정 ID
     * @return 담당자가 아니거나 가려진 담당자이면 빈 값
     */
    public Optional<AssigneeProgress> progressOf(UUID accountId) {
        return assignees.stream().filter(progress -> progress.accountId().equals(accountId)).findFirst();
    }

    /**
     * 마감까지 남은 날 수
     *
     * @param today 기준 날짜
     * @return 오늘이 마감이면 0, 지났으면 음수
     */
    public long daysLeft(LocalDate today) {
        return ChronoUnit.DAYS.between(today, dueDate);
    }

    /**
     * 기준 날짜가 업무 기간 안인지
     *
     * @param date 기준 날짜
     * @return 시작일 이상 마감일 이하이면 true
     */
    public boolean activeOn(LocalDate date) {
        return !date.isBefore(startDate) && !date.isAfter(dueDate);
    }

    /**
     * 모든 담당자가 완료했는지
     *
     * @return 담당자가 한 명 이상이고 전원이 완료했으면 true
     */
    public boolean allDone() {
        return assigneeCount > 0 && doneCount >= assigneeCount;
    }
}
