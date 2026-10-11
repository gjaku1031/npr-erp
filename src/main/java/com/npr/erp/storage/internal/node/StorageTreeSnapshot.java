package com.npr.erp.storage.internal.node;

import com.npr.erp.storage.StorageConflictException;
import com.npr.erp.storage.StorageNodeLocation;
import com.npr.erp.storage.StorageNodeStatus;
import com.npr.erp.storage.StorageNotFoundException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 한 학원의 노드 전체를 메모리에 올린 트리
 *
 * 조상·하위·경로 계산을 DB 재귀 조회 없이 함. 부모 고리가 순환하면 무한히 돌지 않고 예외로 멈춤
 */
public final class StorageTreeSnapshot {
    /**
     * ID로 찾는 색인
     */
    private final Map<UUID, StorageNodeEntity> nodesById = new HashMap<>();

    /**
     * 부모 ID로 자식을 찾는 색인
     */
    private final Map<UUID, List<StorageNodeEntity>> childrenByParent = new HashMap<>();

    /**
     * 학원의 전체 노드로 트리 구성
     *
     * @param nodes 한 학원의 전체 노드
     */
    public StorageTreeSnapshot(Collection<StorageNodeEntity> nodes) {
        for (var node : nodes) {
            nodesById.put(node.getId(), node);
            if (node.getParentId() != null) {
                childrenByParent.computeIfAbsent(node.getParentId(), ignored -> new ArrayList<>()).add(node);
            }
        }
    }

    /**
     * 영구 삭제되지 않은 노드 조회
     *
     * @param nodeId 노드 ID
     * @return 노드
     * @throws StorageNotFoundException 없거나 영구 삭제된 노드일 때
     */
    public StorageNodeEntity node(UUID nodeId) {
        var node = nodesById.get(nodeId);
        if (node == null || node.getStatus() == StorageNodeStatus.DELETED) {
            throw new StorageNotFoundException("STORAGE_NODE_NOT_FOUND", "파일이나 폴더를 찾을 수 없습니다.");
        }
        return node;
    }

    /**
     * 폴더 바로 아래의 정상 상태 항목
     *
     * @param parentId 폴더 ID
     * @return 정렬하지 않은 하위 항목
     */
    public List<StorageNodeEntity> activeChildren(UUID parentId) {
        return childrenByParent.getOrDefault(parentId, List.of()).stream()
                .filter(child -> child.getStatus() == StorageNodeStatus.ACTIVE)
                .toList();
    }

    /**
     * 노드와 그 아래의 모든 노드
     *
     * @param rootId 시작 노드 ID
     * @return 시작 노드부터 너비 우선 순서
     * @throws StorageConflictException 부모 고리가 순환할 때
     */
    public List<StorageNodeEntity> subtree(UUID rootId) {
        var result = new ArrayList<StorageNodeEntity>();
        var visited = new HashSet<UUID>();
        var queue = new ArrayDeque<StorageNodeEntity>();
        queue.add(node(rootId));
        while (!queue.isEmpty()) {
            var current = queue.removeFirst();
            if (!visited.add(current.getId())) {
                throw treeCycle();
            }
            result.add(current);
            queue.addAll(childrenByParent.getOrDefault(current.getId(), List.of()));
        }
        return result;
    }

    /**
     * 루트부터 노드 자신까지의 계보
     *
     * @param nodeId 노드 ID
     * @return 루트가 첫 번째, 노드 자신이 마지막
     * @throws StorageConflictException 부모 고리가 순환할 때
     */
    public List<StorageNodeEntity> lineage(UUID nodeId) {
        var lineage = new ArrayList<StorageNodeEntity>();
        var visited = new HashSet<UUID>();
        var current = node(nodeId);
        while (true) {
            if (!visited.add(current.getId())) {
                throw treeCycle();
            }
            lineage.addFirst(current);
            if (current.getParentId() == null) {
                return lineage;
            }
            current = node(current.getParentId());
        }
    }

    /**
     * 노드와 조상을 공개 조회 결과로 변환
     *
     * @param nodeId 노드 ID
     * @return 노드와 루트부터 직접 부모까지의 조상
     */
    public StorageNodeLocation location(UUID nodeId) {
        var lineage = lineage(nodeId);
        var ancestors = lineage.subList(0, lineage.size() - 1).stream().map(StorageNodeEntity::toView).toList();
        return new StorageNodeLocation(lineage.getLast().toView(), ancestors);
    }

    /**
     * 노드를 후보 폴더 아래로 옮기면 순환이 생기는지 확인
     *
     * @param nodeId 옮길 노드 ID
     * @param candidateParentId 옮겨 갈 폴더 ID
     * @return 후보 폴더가 노드 자신이거나 그 하위이면 true
     */
    public boolean wouldCreateCycle(UUID nodeId, UUID candidateParentId) {
        return lineage(candidateParentId).stream().anyMatch(ancestor -> ancestor.getId().equals(nodeId));
    }

    /**
     * 외부 저장소에서의 경로 조립
     *
     * @param nodeId 노드 ID
     * @return 루트의 기준 경로 뒤에 계보의 이름을 이어 붙인 경로
     * @throws StorageConflictException 루트에 기준 경로가 없을 때
     */
    public String externalPath(UUID nodeId) {
        var lineage = lineage(nodeId);
        var rootLocator = lineage.getFirst().getExternalLocator();
        if (rootLocator == null) {
            throw new StorageConflictException("STORAGE_ROOT_LOCATOR_MISSING", "자료실 루트의 저장 위치가 설정되지 않았습니다.");
        }
        var path = new StringBuilder(rootLocator);
        for (var node : lineage.subList(1, lineage.size())) {
            path.append('/').append(node.getName());
        }
        return path.toString();
    }

    /**
     * 순환 발견 예외 생성
     *
     * @return 던질 예외
     */
    private static StorageConflictException treeCycle() {
        return new StorageConflictException("STORAGE_TREE_CYCLE", "자료실 트리에서 순환 참조가 발견됐습니다.");
    }
}
