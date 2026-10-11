package com.npr.erp.worklog;

import java.util.UUID;

/**
 * 일일보고 체크리스트 항목
 *
 * @param id 항목 ID
 * @param text 내용
 * @param required 체크와 함께 확인 결과를 꼭 적어야 하는 항목인지
 */
public record JournalItemView(UUID id, String text, boolean required) {
}
