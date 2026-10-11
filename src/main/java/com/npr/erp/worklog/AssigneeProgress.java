package com.npr.erp.worklog;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 담당자 한 명의 업무 진행
 *
 * @param accountId 담당자 계정 ID
 * @param status 담당자가 표시한 상태
 * @param reportText 텍스트 보고
 * @param mwfDone MT 업무의 월수금 완료 여부
 * @param ttsDone MT 업무의 화목토 완료 여부
 * @param attachments 보고에 붙인 파일
 * @param counselSent 보낸 상담 수
 * @param counselPending 보냈지만 결과를 확인하지 못한 상담 수
 * @param counselTotal 상담 대상 학생 수
 * @param complete 업무 종류의 완료 조건을 채웠는지
 * @param updatedAt 마지막으로 상태를 바꾼 시각. 바꾼 적이 없으면 null
 */
public record AssigneeProgress(
        UUID accountId,
        TaskProgress status,
        String reportText,
        boolean mwfDone,
        boolean ttsDone,
        List<AttachmentView> attachments,
        int counselSent,
        int counselPending,
        int counselTotal,
        boolean complete,
        Instant updatedAt) {
    /**
     * 특강상담에서 맡은 학생이 한 명도 없는 담당자인지
     *
     * @return 상담 대상이 0명이면 true
     */
    public boolean noCounselTarget() {
        return counselTotal == 0;
    }
}
