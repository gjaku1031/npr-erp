package com.npr.erp.storage.internal.mutation;

import com.npr.erp.storage.StorageNodeStatus;
import com.npr.erp.storage.StorageNodeView;
import com.npr.erp.storage.StorageNotFoundException;
import com.npr.erp.storage.StorageOperationView;
import com.npr.erp.storage.internal.gateway.StorageGatewayException;
import com.npr.erp.storage.internal.gateway.StoredFile;
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
 * 변경의 나머지 단계: 호출 시작 표시와, 외부 저장소 결과에 따른 확정 또는 되돌리기
 *
 * 메서드 하나가 짧은 트랜잭션 하나임
 */
@Service
@RequiredArgsConstructor
public class StorageMutationCompletion {
    /**
     * 노드 저장소
     */
    private final StorageNodeRepository nodeRepository;

    /**
     * 작업 원장 저장소
     */
    private final StorageOperationRepository operationRepository;

    /**
     * 외부 저장소를 호출하기 직전에 원장을 처리 중으로 바꿈
     *
     * 이 표시가 커밋된 뒤에 프로세스가 끝나면 다시 뜰 때 확인 대상으로 잡힘
     *
     * @param operationId 작업 ID
     */
    @Transactional
    public void start(UUID operationId) {
        lockedOperation(operationId).start(Instant.now());
    }

    /**
     * 외부 저장소 호출이 성공한 뒤 노드와 원장을 확정
     *
     * @param prepared 준비된 변경
     * @param storedFile 파일 올리기의 실제 크기와 SHA-256. 다른 작업은 null
     * @return 확정된 대상 노드
     */
    @Transactional
    public StorageNodeView complete(PreparedStorageMutation prepared, StoredFile storedFile) {
        var operation = lockedOperation(prepared.operationId());
        var node = lockedNode(prepared.targetNodeId(), prepared.academyId());
        var now = Instant.now();
        switch (prepared.operationType()) {
            case INITIALIZE_ROOT, CREATE_FOLDER -> node.activate(now);
            case UPLOAD -> node.completeUpload(storedFile.sizeBytes(), storedFile.checksumSha256(), now);
            case RENAME -> node.completeRename(operation.getRequestedName(), now);
            case MOVE -> node.completeMove(operation.getDestinationParentId(), now);
            case DELETE_PERMANENTLY -> {
                for (var child : subtree(prepared)) {
                    child.completeDeletion(now);
                }
            }
            case TRASH, RESTORE -> throw new IllegalStateException("외부 저장소를 호출하지 않는 작업입니다.");
        }
        operation.complete(now);
        return node.toView();
    }

    /**
     * 외부 저장소 호출이 실패한 뒤 노드를 이전 상태로 되돌리고 원장에 실패를 남김
     *
     * @param prepared 준비된 변경
     * @param failure 외부 저장소 실패
     * @return 실패가 기록된 작업
     */
    @Transactional
    public StorageOperationView fail(PreparedStorageMutation prepared, StorageGatewayException failure) {
        var operation = lockedOperation(prepared.operationId());
        var node = lockedNode(prepared.targetNodeId(), prepared.academyId());
        var now = Instant.now();
        switch (prepared.operationType()) {
            case INITIALIZE_ROOT, CREATE_FOLDER, UPLOAD -> node.failProvisioning(now);
            case RENAME, MOVE -> node.recoverMutation(now);
            case DELETE_PERMANENTLY -> {
                for (var child : subtree(prepared)) {
                    child.recoverDeletion(now);
                }
            }
            case TRASH, RESTORE -> throw new IllegalStateException("외부 저장소를 호출하지 않는 작업입니다.");
        }
        operation.fail(failure.getCode(), failure.getMessage(), failure.isRetryable(), now);
        return operation.toView(node.getName());
    }

    /**
     * 삭제 대상 묶음의 전체 노드
     *
     * @param prepared 준비된 삭제
     * @return 최상위 항목과 그 아래의 모든 노드
     */
    private Iterable<StorageNodeEntity> subtree(PreparedStorageMutation prepared) {
        var tree = new StorageTreeSnapshot(nodeRepository.findAllByAcademyId(prepared.academyId()));
        return tree.subtree(prepared.targetNodeId());
    }

    /**
     * 노드를 쓰기 잠금으로 가져옴
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

    /**
     * 작업을 쓰기 잠금으로 가져옴
     *
     * @param operationId 작업 ID
     * @return 잠근 작업
     */
    private StorageOperationEntity lockedOperation(UUID operationId) {
        return operationRepository.findLocked(operationId)
                .orElseThrow(() -> new StorageNotFoundException("STORAGE_OPERATION_NOT_FOUND", "작업을 찾을 수 없습니다."));
    }
}
