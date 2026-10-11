package com.npr.erp.worklog;

import java.util.Map;
import java.util.UUID;

/**
 * 일일보고를 임시저장할 때 사람이 직접 넣는 값
 *
 * 알림장 게시 여부와 업무 처리 상태는 받지 않음. 서버가 외부 시스템과 업무 원장에서 직접 읽음
 *
 * @param checklist 항목 ID별 답
 * @param counselChecked 오늘 상담 내용을 모두 확인했는지
 * @param attendanceChecked 오늘 출결 기록을 모두 확인했는지
 */
public record ReportInput(Map<UUID, ChecklistAnswer> checklist, boolean counselChecked, boolean attendanceChecked) {
}
