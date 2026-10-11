package com.npr.erp.storage;

import java.io.InputStream;

/**
 * 내려받을 파일
 *
 * @param node 파일 노드
 * @param content 파일 본문. 호출자가 닫아야 함
 */
public record StorageDownload(StorageNodeView node, InputStream content) {
}
