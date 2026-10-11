package com.npr.erp.worklog;

import java.time.LocalDate;
import java.util.UUID;

/**
 * 공지
 *
 * @param id 공지 ID
 * @param body 본문. 마크다운
 * @param active 화면 위쪽 띠에 노출하는지
 * @param authorAccountId 쓴 계정 ID
 * @param postedOn 쓴 날짜
 */
public record NoticeView(UUID id, String body, boolean active, UUID authorAccountId, LocalDate postedOn) {
}
