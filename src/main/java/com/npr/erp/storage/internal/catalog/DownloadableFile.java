package com.npr.erp.storage.internal.catalog;

import com.npr.erp.storage.StorageNodeView;

/**
 * 내려받을 수 있는 파일과 외부 저장소에서의 경로
 *
 * @param node 파일 노드
 * @param externalPath 외부 저장소에서의 경로
 */
public record DownloadableFile(StorageNodeView node, String externalPath) {
}
