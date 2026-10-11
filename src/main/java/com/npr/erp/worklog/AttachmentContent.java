package com.npr.erp.worklog;

/**
 * 내려받을 첨부 파일
 *
 * @param info 파일 정보
 * @param content 본문
 */
public record AttachmentContent(AttachmentView info, byte[] content) {
}
