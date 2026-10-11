package com.npr.erp.worklog;

import com.npr.erp.tng.TngClassroom;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 일일보고 작성 화면에 필요한 것 전부
 *
 * @param journal 그 날짜의 일일보고 정의
 * @param report 지금까지 저장한 보고. 아직 없으면 null
 * @param payload 저장한 내용. 아직 없으면 빈 내용
 * @param checklistFiles 항목 ID별 첨부
 * @param classrooms 그날 처리할 반. 제출한 보고는 제출할 때의 반
 * @param notebooks 반별 알림장 게시 여부
 * @param tasks 그날이 기간에 드는 본인 업무
 * @param gate 단계별 완료 여부
 * @param editable 고칠 수 있는 상태인지. 제출한 보고는 되돌린 뒤에 고침
 */
public record WizardView(
        JournalView journal,
        DailyReportView report,
        ReportPayload payload,
        Map<UUID, List<AttachmentView>> checklistFiles,
        List<TngClassroom> classrooms,
        List<NotebookMark> notebooks,
        List<TaskView> tasks,
        WizardGate gate,
        boolean editable) {
    /**
     * 항목 하나에 붙인 파일
     *
     * @param itemId 항목 ID
     * @return 첨부 목록. 없으면 빈 목록
     */
    public List<AttachmentView> filesOf(UUID itemId) {
        return checklistFiles.getOrDefault(itemId, List.of());
    }
}
