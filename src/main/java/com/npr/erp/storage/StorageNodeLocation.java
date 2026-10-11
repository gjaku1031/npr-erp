package com.npr.erp.storage;

import java.util.List;
import java.util.UUID;

/**
 * 노드와 그 조상
 *
 * 호출자가 인가 문맥을 만들 수 있도록 원장에서 읽은 조상 목록을 함께 돌려줌
 *
 * @param node 노드
 * @param ancestors 루트부터 직접 부모까지의 조상. 루트 자신은 빈 목록
 */
public record StorageNodeLocation(StorageNodeView node, List<StorageNodeView> ancestors) {
    /**
     * 조상의 ID만 추림
     *
     * @return 루트부터 직접 부모까지의 ID
     */
    public List<UUID> ancestorIds() {
        return ancestors.stream().map(StorageNodeView::id).toList();
    }
}
