package com.npr.erp.storage.internal.catalog;

import com.npr.erp.storage.StorageCatalog;
import com.npr.erp.storage.StorageConflictException;
import com.npr.erp.storage.StorageFolderView;
import com.npr.erp.storage.StorageNodeLocation;
import com.npr.erp.storage.StorageNodeStatus;
import com.npr.erp.storage.StorageNodeType;
import com.npr.erp.storage.StorageNodeView;
import com.npr.erp.storage.StorageNotFoundException;
import com.npr.erp.storage.StorageOperationView;
import com.npr.erp.storage.StorageValidationException;
import com.npr.erp.storage.internal.node.StorageNodeEntity;
import com.npr.erp.storage.internal.node.StorageNodeRepository;
import com.npr.erp.storage.internal.node.StorageTreeSnapshot;
import com.npr.erp.storage.internal.operation.StorageOperationRepository;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link StorageCatalog} 구현
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class JpaStorageCatalog implements StorageCatalog {
    /**
     * 검색 결과의 최대 건수
     */
    private static final int MAX_SEARCH_RESULTS = 200;

    /**
     * 검색어의 최대 길이
     */
    private static final int MAX_QUERY_LENGTH = 100;

    /**
     * 한 번에 가져올 수 있는 작업의 최대 건수
     */
    private static final int MAX_OPERATIONS = 200;

    /**
     * 목록 표시 순서: 폴더 먼저, 그다음 이름(대소문자 무시), 같으면 ID
     */
    private static final Comparator<StorageNodeEntity> DISPLAY_ORDER = Comparator
            .comparing((StorageNodeEntity node) -> node.getNodeType() == StorageNodeType.FOLDER ? 0 : 1)
            .thenComparing(StorageNodeEntity::getNormalizedName)
            .thenComparing(StorageNodeEntity::getId);

    /**
     * 노드 저장소
     */
    private final StorageNodeRepository nodeRepository;

    /**
     * 작업 원장 저장소
     */
    private final StorageOperationRepository operationRepository;

    /**
     * {@inheritDoc}
     */
    @Override
    public Optional<StorageNodeView> findRoot(UUID academyId) {
        return nodeRepository.findRoot(academyId)
                .filter(root -> root.getStatus() == StorageNodeStatus.ACTIVE)
                .map(StorageNodeEntity::toView);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public StorageFolderView folder(UUID academyId, UUID folderId) {
        var tree = tree(academyId);
        var folder = tree.node(folderId);
        if (folder.getNodeType() != StorageNodeType.FOLDER || folder.getStatus() != StorageNodeStatus.ACTIVE) {
            throw new StorageConflictException("STORAGE_FOLDER_NOT_ACTIVE", "열 수 있는 폴더가 아닙니다.");
        }
        var children = tree.activeChildren(folderId).stream()
                .sorted(DISPLAY_ORDER)
                .map(StorageNodeEntity::toView)
                .toList();
        return new StorageFolderView(tree.location(folderId), children);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public StorageNodeLocation locate(UUID academyId, UUID nodeId) {
        return tree(academyId).location(nodeId);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<UUID> subtreeIds(UUID academyId, UUID nodeId) {
        return tree(academyId).subtree(nodeId).stream().map(StorageNodeEntity::getId).toList();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public Map<UUID, StorageNodeLocation> locateAll(UUID academyId, Collection<UUID> nodeIds) {
        if (nodeIds.isEmpty()) {
            return Map.of();
        }
        var tree = tree(academyId);
        var locations = new LinkedHashMap<UUID, StorageNodeLocation>();
        for (var nodeId : nodeIds) {
            try {
                locations.put(nodeId, tree.location(nodeId));
            } catch (StorageNotFoundException ignored) {
                // 계약대로 없는 노드는 결과에서 뺌
            }
        }
        return locations;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<StorageNodeView> search(UUID academyId, String query) {
        var keyword = query == null ? "" : query.strip().toLowerCase(Locale.ROOT);
        if (keyword.isEmpty() || keyword.length() > MAX_QUERY_LENGTH) {
            throw new StorageValidationException("INVALID_STORAGE_SEARCH_QUERY", "검색어는 1자 이상 100자 이하여야 합니다.");
        }
        return nodeRepository.findAllByAcademyId(academyId).stream()
                .filter(node -> node.getStatus() == StorageNodeStatus.ACTIVE && !node.isSystemRoot())
                .filter(node -> node.getNormalizedName().contains(keyword))
                .sorted(DISPLAY_ORDER)
                .limit(MAX_SEARCH_RESULTS)
                .map(StorageNodeEntity::toView)
                .toList();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<StorageNodeView> trash(UUID academyId) {
        return nodeRepository.findAllByAcademyId(academyId).stream()
                .filter(StorageNodeEntity::isTrashRoot)
                .sorted(Comparator.comparing(StorageNodeEntity::getTrashedAt).reversed())
                .map(StorageNodeEntity::toView)
                .toList();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<StorageOperationView> recentOperations(UUID academyId, int limit) {
        var operations = operationRepository.findAllByAcademyIdOrderByCreatedAtDesc(
                academyId, Limit.of(Math.clamp(limit, 1, MAX_OPERATIONS)));

        // 대상 이름을 작업 수만큼 조회하지 않도록 한 번에 읽음
        var nodeIds = new HashSet<UUID>();
        for (var operation : operations) {
            nodeIds.add(operation.getTargetNodeId());
        }
        var names = new HashMap<UUID, String>();
        for (var node : nodeRepository.findAllById(nodeIds)) {
            names.put(node.getId(), node.getName());
        }
        return operations.stream()
                .map(operation -> operation.toView(names.getOrDefault(operation.getTargetNodeId(), "")))
                .toList();
    }

    /**
     * 작업 하나 조회
     *
     * @param academyId 학원 ID
     * @param operationId 작업 ID
     * @return 작업
     * @throws StorageNotFoundException 그 학원의 작업이 아닐 때
     */
    public StorageOperationView operation(UUID academyId, UUID operationId) {
        var operation = operationRepository.findById(operationId)
                .filter(candidate -> candidate.getAcademyId().equals(academyId))
                .orElseThrow(() -> new StorageNotFoundException("STORAGE_OPERATION_NOT_FOUND", "작업을 찾을 수 없습니다."));
        var name = nodeRepository.findById(operation.getTargetNodeId()).map(StorageNodeEntity::getName).orElse("");
        return operation.toView(name);
    }

    /**
     * 내려받을 파일과 외부 저장소 경로 조회
     *
     * @param academyId 학원 ID
     * @param nodeId 파일 노드 ID
     * @return 파일과 경로
     * @throws StorageConflictException 정상 상태의 파일이 아닐 때
     */
    public DownloadableFile downloadableFile(UUID academyId, UUID nodeId) {
        var tree = tree(academyId);
        var node = tree.node(nodeId);
        if (node.getNodeType() != StorageNodeType.FILE || node.getStatus() != StorageNodeStatus.ACTIVE) {
            throw new StorageConflictException("STORAGE_FILE_NOT_ACTIVE", "내려받을 수 있는 파일이 아닙니다.");
        }
        return new DownloadableFile(node.toView(), tree.externalPath(nodeId));
    }

    /**
     * 학원의 전체 노드로 트리 구성
     *
     * @param academyId 학원 ID
     * @return 메모리 트리
     */
    private StorageTreeSnapshot tree(UUID academyId) {
        return new StorageTreeSnapshot(nodeRepository.findAllByAcademyId(academyId));
    }
}
