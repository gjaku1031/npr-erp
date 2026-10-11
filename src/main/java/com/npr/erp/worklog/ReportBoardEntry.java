package com.npr.erp.worklog;

import java.util.UUID;

/**
 * 제출 현황판의 한 사람
 *
 * @param accountId 계정 ID
 * @param state 제출 상태
 */
public record ReportBoardEntry(UUID accountId, ReportState state) {
}
