package com.npr.erp.storage.internal.mutation;

import com.npr.erp.storage.StorageConflictException;
import com.npr.erp.storage.StorageNodeStatus;
import com.npr.erp.storage.StorageNodeView;
import com.npr.erp.storage.StorageNotFoundException;
import com.npr.erp.storage.StorageOperationType;
import com.npr.erp.storage.internal.node.StorageNodeEntity;
import com.npr.erp.storage.internal.node.StorageNodeRepository;
import com.npr.erp.storage.internal.node.StorageTreeSnapshot;
import com.npr.erp.storage.internal.operation.StorageOperationEntity;
import com.npr.erp.storage.internal.operation.StorageOperationRepository;
import java.time.Instant;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 휴지통으로 보내기와 복원
 *
 * 둘 다 DB의 상태만 바꾸고 외부 저장소의 파일은 그대로 둠. 그래서 트랜잭션 하나로 끝나고, 원장에는 바로 완료로 남김
 */
@Service
@RequiredArgsConstructor
public class StorageTrashStore {
    /**
     * 노드 저장소
     */
    private final StorageNodeRepository nodeRepository;

    /**
     * 작업 원장 저장소
     */
    private final StorageOperationRepository operationRepository;

    /**
     * 노드와 하위 전체를 휴지통으로 보냄
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param nodeId 대상 노드 ID
     * @return 휴지통에 들어간 노드
     * @throws StorageConflictException 루트이거나, 하위에 처리 중인 항목이 있을 때
     */
    @Transactional
    public StorageNodeView trash(UUID academyId, UUID actorAccountId, UUID nodeId) {
        var node = lockedNode(nodeId, academyId);
        StorageMutationPreparation.requireMutableActiveNode(node);
        var tree = new StorageTreeSnapshot(nodeRepository.findAllByAcademyId(academyId));
        var subtree = tree.subtree(node.getId());
        for (var child : subtree) {
            if (child.getStatus() != StorageNodeStatus.ACTIVE) {
                throw new StorageConflictException("STORAGE_SUBTREE_BUSY", "처리 중인 항목이 들어 있는 폴더는 휴지통으로 보낼 수 없습니다.");
            }
        }

        // 묶음 전체에 같은 최상위 ID를 남겨, 복원과 삭제가 묶음 단위로만 일어나게 함
        var now = Instant.now();
        for (var child : subtree) {
            child.markTrashed(node.getId(), now);
        }
        recordCompleted(node, actorAccountId, StorageOperationType.TRASH, now);
        return node.toView();
    }

    /**
     * 휴지통의 묶음을 원래 폴더로 복원
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param nodeId 휴지통의 최상위 항목 ID
     * @return 복원된 노드
     * @throws StorageConflictException 최상위 항목이 아니거나, 원래 폴더를 쓸 수 없을 때
     */
    @Transactional
    public StorageNodeView restore(UUID academyId, UUID actorAccountId, UUID nodeId) {
        var node = lockedNode(nodeId, academyId);
        if (!node.isTrashRoot() || node.isSystemRoot()) {
            throw new StorageConflictException("STORAGE_NODE_NOT_TRASH_ROOT", "휴지통에 있는 항목만 복원할 수 있습니다.");
        }
        var tree = new StorageTreeSnapshot(nodeRepository.findAllByAcademyId(academyId));

        // 원래 폴더가 그 사이 휴지통에 들어갔거나 지워졌으면 복원할 자리가 없음
        StorageMutationPreparation.requireActiveFolder(tree.node(node.getParentId()));
        var subtree = tree.subtree(node.getId());
        for (var child : subtree) {
            if (child.getStatus() != StorageNodeStatus.TRASHED || !node.getId().equals(child.getTrashRootId())) {
                throw new StorageConflictException("STORAGE_TRASH_SUBTREE_CONFLICT", "휴지통 항목의 상태가 서로 달라 복원할 수 없습니다.");
            }
        }

        var now = Instant.now();
        for (var child : subtree) {
            child.restore(now);
        }
        recordCompleted(node, actorAccountId, StorageOperationType.RESTORE, now);
        return node.toView();
    }

    /**
     * 외부 저장소를 호출하지 않는 작업을 완료 상태로 원장에 남김
     *
     * @param node 대상 노드
     * @param actorAccountId 실행하는 계정 ID
     * @param type 작업 종류
     * @param now 실행 시각
     */
    private void recordCompleted(StorageNodeEntity node, UUID actorAccountId, StorageOperationType type, Instant now) {
        var operation = new StorageOperationEntity(
                node.getAcademyId(), actorAccountId, type, node.getId(), null, null, null, null, now);
        operation.complete(now);
        operationRepository.save(operation);
    }

    /**
     * 학원 안에서 노드를 쓰기 잠금으로 가져옴
     *
     * @param nodeId 노드 ID
     * @param academyId 학원 ID
     * @return 잠근 노드
     */
    private StorageNodeEntity lockedNode(UUID nodeId, UUID academyId) {
        return nodeRepository.findLocked(nodeId, academyId)
                .filter(node -> node.getStatus() != StorageNodeStatus.DELETED)
                .orElseThrow(() -> new StorageNotFoundException("STORAGE_NODE_NOT_FOUND", "파일이나 폴더를 찾을 수 없습니다."));
    }
}
