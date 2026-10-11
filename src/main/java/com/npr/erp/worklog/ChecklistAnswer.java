package com.npr.erp.worklog;

/**
 * 체크리스트 항목 하나에 대한 답
 *
 * @param checked 체크했는지
 * @param note 확인 결과
 */
public record ChecklistAnswer(boolean checked, String note) {
}
