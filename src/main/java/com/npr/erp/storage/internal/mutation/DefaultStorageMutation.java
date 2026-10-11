package com.npr.erp.storage.internal.mutation;

import com.npr.erp.storage.StorageDownload;
import com.npr.erp.storage.StorageMutation;
import com.npr.erp.storage.StorageNodeView;
import com.npr.erp.storage.StorageOperationType;
import com.npr.erp.storage.StorageOperationView;
import com.npr.erp.storage.StorageTransfer;
import com.npr.erp.storage.StorageUnavailableException;
import com.npr.erp.storage.internal.catalog.JpaStorageCatalog;
import com.npr.erp.storage.internal.gateway.StorageGateway;
import com.npr.erp.storage.internal.gateway.StorageGatewayException;
import com.npr.erp.storage.internal.gateway.StoredFile;
import java.io.InputStream;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * 트리 변경과 파일 전송의 진행 순서를 맡는 구현
 *
 * 이 클래스의 메서드는 트랜잭션이 아님. 준비(트랜잭션) → 외부 저장소 호출(트랜잭션 밖) → 확정 또는 되돌리기(트랜잭션)를
 * 순서대로 부름. 외부 호출이 느려도 DB 연결과 행 잠금을 붙잡지 않기 위해서임
 */
@Service
@RequiredArgsConstructor
public class DefaultStorageMutation implements StorageMutation, StorageTransfer {
    /**
     * 준비 단계
     */
    private final StorageMutationPreparation preparation;

    /**
     * 확정·되돌리기 단계
     */
    private final StorageMutationCompletion completion;

    /**
     * 휴지통 처리
     */
    private final StorageTrashStore trashStore;

    /**
     * 조회
     */
    private final JpaStorageCatalog catalog;

    /**
     * 외부 저장소 포트
     */
    private final StorageGateway gateway;

    /**
     * {@inheritDoc}
     */
    @Override
    public StorageNodeView initializeRoot(UUID academyId, UUID actorAccountId, String displayName) {
        var existing = catalog.findRoot(academyId);
        if (existing.isPresent()) {
            return existing.get();
        }
        return execute(preparation.prepareRoot(academyId, actorAccountId, displayName), null);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public StorageNodeView createFolder(UUID academyId, UUID actorAccountId, UUID parentId, String name) {
        return execute(preparation.prepareCreateFolder(academyId, actorAccountId, parentId, name), null);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public StorageNodeView rename(UUID academyId, UUID actorAccountId, UUID nodeId, String name) {
        return execute(preparation.prepareRename(academyId, actorAccountId, nodeId, name), null);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public StorageNodeView move(UUID academyId, UUID actorAccountId, UUID nodeId, UUID destinationParentId) {
        return execute(preparation.prepareMove(academyId, actorAccountId, nodeId, destinationParentId), null);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public StorageNodeView trash(UUID academyId, UUID actorAccountId, UUID nodeId) {
        return trashStore.trash(academyId, actorAccountId, nodeId);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public StorageNodeView restore(UUID academyId, UUID actorAccountId, UUID nodeId) {
        return trashStore.restore(academyId, actorAccountId, nodeId);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void deletePermanently(UUID academyId, UUID actorAccountId, UUID nodeId) {
        execute(preparation.prepareDelete(academyId, actorAccountId, nodeId), null);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public StorageOperationView reconcile(UUID academyId, UUID operationId) {
        var prepared = preparation.prepareReconcile(academyId, operationId);
        if (prepared.operationType() == StorageOperationType.UPLOAD) {
            // 올리던 본문은 다시 구할 수 없으므로 남은 파일을 지우고 실패로 정리함. 사용자가 다시 올려야 함
            completion.start(prepared.operationId());
            try {
                gateway.deleteRecursively(prepared.operationId(), prepared.destinationPath());
            } catch (StorageGatewayException ignored) {
                // 남은 파일을 지우지 못해도 노드는 실패로 정리해 이름을 다시 쓸 수 있게 함
            }
            return completion.fail(prepared, new StorageGatewayException(
                    "STORAGE_UPLOAD_INTERRUPTED", false, "올리던 중 서버가 다시 시작돼 취소됐습니다. 다시 올려 주세요.", null));
        }
        try {
            execute(prepared, null);
        } catch (StorageUnavailableException ignored) {
            // 실패 내용은 원장에 남았으므로 아래에서 원장의 상태를 그대로 돌려줌
        }
        return catalog.operation(academyId, operationId);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public StorageNodeView upload(
            UUID academyId, UUID actorAccountId, UUID parentId, String name, String mediaType, InputStream content) {
        return execute(preparation.prepareUpload(academyId, actorAccountId, parentId, name, mediaType), content);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public StorageDownload openDownload(UUID academyId, UUID nodeId) {
        var file = catalog.downloadableFile(academyId, nodeId);
        try {
            return new StorageDownload(file.node(), gateway.open(file.externalPath()));
        } catch (StorageGatewayException failure) {
            throw new StorageUnavailableException(failure.getCode(), failure.getMessage());
        }
    }

    /**
     * 준비된 변경을 외부 저장소에 반영하고 결과에 따라 확정하거나 되돌림
     *
     * @param prepared 준비된 변경
     * @param content 파일 올리기의 본문. 다른 작업은 null
     * @return 확정된 대상 노드
     * @throws StorageUnavailableException 외부 저장소 호출이 실패했을 때. 노드는 이전 상태로 되돌려져 있음
     */
    private StorageNodeView execute(PreparedStorageMutation prepared, InputStream content) {
        completion.start(prepared.operationId());
        StoredFile storedFile = null;
        try {
            var operationId = prepared.operationId();
            switch (prepared.operationType()) {
                case INITIALIZE_ROOT, CREATE_FOLDER -> gateway.createDirectory(operationId, prepared.destinationPath());
                case RENAME, MOVE -> gateway.move(operationId, prepared.sourcePath(), prepared.destinationPath());
                case DELETE_PERMANENTLY -> gateway.deleteRecursively(operationId, prepared.destinationPath());
                case UPLOAD -> storedFile = gateway.write(operationId, prepared.destinationPath(), content);
                case TRASH, RESTORE -> throw new IllegalStateException("외부 저장소를 호출하지 않는 작업입니다.");
            }
        } catch (StorageGatewayException failure) {
            completion.fail(prepared, failure);
            throw new StorageUnavailableException(failure.getCode(), failure.getMessage());
        }
        return completion.complete(prepared, storedFile);
    }
}
