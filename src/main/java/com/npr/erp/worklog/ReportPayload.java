package com.npr.erp.worklog;

import com.npr.erp.tng.TngClassroom;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 일일보고의 내용
 *
 * 앞의 세 값은 작성하는 동안 계속 바뀌고, 나머지는 제출하는 순간의 사실을 적어 둔 것임. 제출한 뒤에 담당 반을 다시
 * 가져오거나 업무 상태가 바뀌어도 낸 보고의 내용은 달라지지 않음
 *
 * @param checklist 항목 ID별 답
 * @param counselChecked 상담 내용을 확인했는지
 * @param attendanceChecked 출결 기록을 확인했는지
 * @param specialPeriod 제출할 때 특강기간 보고였는지
 * @param classrooms 제출할 때 처리한 반
 * @param notebooks 제출할 때의 반별 알림장 게시 여부
 * @param tasks 제출할 때의 업무별 처리 상태
 */
public record ReportPayload(
        Map<UUID, ChecklistAnswer> checklist,
        boolean counselChecked,
        boolean attendanceChecked,
        boolean specialPeriod,
        List<TngClassroom> classrooms,
        List<NotebookMark> notebooks,
        List<TaskMark> tasks) {
    /**
     * 아무것도 적지 않은 내용
     *
     * @return 빈 내용
     */
    public static ReportPayload empty() {
        return new ReportPayload(Map.of(), false, false, false, List.of(), List.of(), List.of());
    }

    /**
     * 항목 하나의 답
     *
     * @param itemId 항목 ID
     * @return 적은 답. 없으면 체크하지 않은 빈 답
     */
    public ChecklistAnswer answerOf(UUID itemId) {
        var answer = checklist.get(itemId);
        return answer == null ? new ChecklistAnswer(false, "") : answer;
    }
}
