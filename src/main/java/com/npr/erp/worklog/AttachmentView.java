package com.npr.erp.worklog;

import java.util.UUID;

/**
 * 첨부 파일의 정보
 *
 * 본문은 담지 않음
 *
 * @param id 첨부 ID
 * @param ownerAccountId 올린 계정 ID
 * @param taskId 업무 보고에 붙인 파일이면 그 업무 ID. 일일보고 체크리스트에 붙인 파일이면 null
 * @param fileName 파일 이름
 * @param mediaType 미디어 타입
 * @param sizeBytes 크기
 */
public record AttachmentView(
        UUID id, UUID ownerAccountId, UUID taskId, String fileName, String mediaType, long sizeBytes) {
}
