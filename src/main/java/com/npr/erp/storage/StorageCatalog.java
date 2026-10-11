package com.npr.erp.storage;

import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 자료실 조회 계약
 *
 * 권한으로 결과를 거르지 않음. 호출자가 돌려받은 조상 목록으로 인가한 뒤 보여 줄 항목을 정함
 */
public interface StorageCatalog {
    /**
     * 학원 루트 폴더 조회
     *
     * @param academyId 학원 ID
     * @return 루트가 아직 없으면 빈 값
     */
    Optional<StorageNodeView> findRoot(UUID academyId);

    /**
     * 폴더와 하위 항목 조회
     *
     * @param academyId 학원 ID
     * @param folderId 폴더 ID
     * @return 폴더, 조상, 정상 상태의 하위 항목
     * @throws StorageNotFoundException 그 학원에 없는 노드일 때
     * @throws StorageConflictException 정상 상태의 폴더가 아닐 때
     */
    StorageFolderView folder(UUID academyId, UUID folderId);

    /**
     * 노드 하나와 조상 조회
     *
     * @param academyId 학원 ID
     * @param nodeId 노드 ID
     * @return 노드와 조상
     * @throws StorageNotFoundException 그 학원에 없거나 영구 삭제된 노드일 때
     */
    StorageNodeLocation locate(UUID academyId, UUID nodeId);

    /**
     * 노드와 그 아래 모든 노드의 ID
     *
     * 영구 삭제하기 전에 함께 정리할 대상을 구하는 데 씀
     *
     * @param academyId 학원 ID
     * @param nodeId 시작 노드 ID
     * @return 시작 노드부터 너비 우선 순서의 ID
     * @throws StorageNotFoundException 시작 노드가 없을 때
     */
    List<UUID> subtreeIds(UUID academyId, UUID nodeId);

    /**
     * 여러 노드의 조상을 한 번에 조회
     *
     * @param academyId 학원 ID
     * @param nodeIds 노드 ID 목록
     * @return 노드 ID별 위치. 없는 노드는 빠짐
     */
    Map<UUID, StorageNodeLocation> locateAll(UUID academyId, Collection<UUID> nodeIds);

    /**
     * 이름으로 정상 상태의 항목 검색
     *
     * @param academyId 학원 ID
     * @param query 이름에 들어 있어야 하는 문자열. 대소문자 구분 없음
     * @return 최대 200건
     * @throws StorageValidationException 검색어가 1~100자가 아닐 때
     */
    List<StorageNodeView> search(UUID academyId, String query);

    /**
     * 휴지통의 최상위 항목 조회
     *
     * 폴더를 버리면 그 안의 항목은 폴더와 함께 다니므로 목록에는 버린 폴더만 나옴
     *
     * @param academyId 학원 ID
     * @return 최근에 버린 것부터
     */
    List<StorageNodeView> trash(UUID academyId);

    /**
     * 최근 작업 조회
     *
     * @param academyId 학원 ID
     * @param limit 가져올 최대 건수
     * @return 최근 것부터
     */
    List<StorageOperationView> recentOperations(UUID academyId, int limit);
}
