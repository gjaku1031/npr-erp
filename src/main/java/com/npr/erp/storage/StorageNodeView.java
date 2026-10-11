package com.npr.erp.storage;

import java.time.Instant;
import java.util.UUID;

/**
 * 노드 조회 결과
 *
 * @param id 노드 ID
 * @param academyId 학원 ID
 * @param parentId 부모 폴더 ID. 루트는 null
 * @param type 노드 종류
 * @param name 이름
 * @param status 상태
 * @param sizeBytes 파일 크기. 폴더는 null
 * @param mediaType 파일의 미디어 타입. 폴더는 null
 * @param createdBy 만든 계정 ID
 * @param updatedAt 수정 시각
 * @param trashedAt 휴지통으로 보낸 시각. 휴지통에 없으면 null
 */
public record StorageNodeView(
        UUID id,
        UUID academyId,
        UUID parentId,
        StorageNodeType type,
        String name,
        StorageNodeStatus status,
        Long sizeBytes,
        String mediaType,
        UUID createdBy,
        Instant updatedAt,
        Instant trashedAt) {
    /**
     * 폴더인지 확인
     *
     * @return 폴더이면 true
     */
    public boolean folder() {
        return type == StorageNodeType.FOLDER;
    }
}
