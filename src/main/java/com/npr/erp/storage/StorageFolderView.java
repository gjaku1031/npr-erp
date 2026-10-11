package com.npr.erp.storage;

import java.util.List;

/**
 * 폴더를 열었을 때의 조회 결과
 *
 * @param location 폴더와 그 조상
 * @param children 정상 상태의 하위 항목. 폴더 먼저, 그다음 이름 순
 */
public record StorageFolderView(StorageNodeLocation location, List<StorageNodeView> children) {
}
