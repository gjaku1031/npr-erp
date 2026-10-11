package com.npr.erp.worklog;

import java.util.UUID;

/**
 * 제출할 때 적어 둔 업무 하나의 처리 상태
 *
 * @param taskId 업무 ID
 * @param title 업무 이름
 * @param kind 업무 종류
 * @param status 그때의 처리 상태
 */
public record TaskMark(UUID taskId, String title, TaskKind kind, TaskProgress status) {
}
