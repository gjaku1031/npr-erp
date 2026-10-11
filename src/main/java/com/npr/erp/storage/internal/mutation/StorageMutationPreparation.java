package com.npr.erp.storage.internal.mutation;

import com.npr.erp.storage.StorageConflictException;
import com.npr.erp.storage.StorageNodeStatus;
import com.npr.erp.storage.StorageNodeType;
import com.npr.erp.storage.StorageNotFoundException;
import com.npr.erp.storage.StorageOperationStatus;
import com.npr.erp.storage.StorageOperationType;
import com.npr.erp.storage.internal.node.StorageNamePolicy;
import com.npr.erp.storage.internal.node.StorageNodeEntity;
import com.npr.erp.storage.internal.node.StorageNodeRepository;
import com.npr.erp.storage.internal.node.StorageTreeSnapshot;
import com.npr.erp.storage.internal.operation.StorageOperationEntity;
import com.npr.erp.storage.internal.operation.StorageOperationRepository;
import java.time.Instant;
import java.util.Collection;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 변경의 첫 단계: 규칙을 확인하고 노드를 중간 상태로 바꾸고 원장에 기록함
 *
 * 메서드 하나가 짧은 트랜잭션 하나임. 여기서는 외부 저장소를 호출하지 않음
 */
@Service
@RequiredArgsConstructor
public class StorageMutationPreparation {
    /**
     * 파일의 기본 미디어 타입
     */
    private static final String DEFAULT_MEDIA_TYPE = "application/octet-stream";

    /**
     * 미디어 타입의 최대 길이
     */
    private static final int MAX_MEDIA_TYPE_LENGTH = 255;

    /**
     * 노드 저장소
     */
    private final StorageNodeRepository nodeRepository;

    /**
     * 작업 원장 저장소
     */
    private final StorageOperationRepository operationRepository;

    /**
     * 학원 루트 생성 준비
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param displayName 루트 폴더 이름
     * @return 준비된 변경
     * @throws StorageConflictException 살아 있는 루트가 이미 있을 때
     */
    @Transactional
    public PreparedStorageMutation prepareRoot(UUID academyId, UUID actorAccountId, String displayName) {
        if (nodeRepository.findRoot(academyId).isPresent()) {
            throw new StorageConflictException("STORAGE_ROOT_ALREADY_EXISTS", "학원 자료실 루트가 이미 있습니다.");
        }
        var name = StorageNamePolicy.validate(displayName);
        // 루트의 실제 디렉터리 이름은 표시 이름이 아니라 학원 ID로 고정해, 이름을 바꿔도 경로가 흔들리지 않게 함
        var locator = "academies/" + academyId;
        var now = Instant.now();
        var root = nodeRepository.save(new StorageNodeEntity(
                academyId, null, StorageNodeType.FOLDER, name, locator, null, actorAccountId, now));
        return record(root, actorAccountId, StorageOperationType.INITIALIZE_ROOT, null, locator, null, name, now);
    }

    /**
     * 폴더 생성 준비
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param parentId 부모 폴더 ID
     * @param rawName 새 폴더 이름
     * @return 준비된 변경
     */
    @Transactional
    public PreparedStorageMutation prepareCreateFolder(
            UUID academyId, UUID actorAccountId, UUID parentId, String rawName) {
        return prepareChild(
                academyId, actorAccountId, parentId, rawName, StorageNodeType.FOLDER, null,
                StorageOperationType.CREATE_FOLDER);
    }

    /**
     * 파일 올리기 준비
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param parentId 올릴 폴더 ID
     * @param rawName 파일 이름
     * @param mediaType 미디어 타입. 비어 있으면 기본값
     * @return 준비된 변경
     */
    @Transactional
    public PreparedStorageMutation prepareUpload(
            UUID academyId, UUID actorAccountId, UUID parentId, String rawName, String mediaType) {
        var normalizedMediaType = mediaType == null || mediaType.isBlank() ? DEFAULT_MEDIA_TYPE : mediaType.strip();
        if (normalizedMediaType.length() > MAX_MEDIA_TYPE_LENGTH) {
            normalizedMediaType = DEFAULT_MEDIA_TYPE;
        }
        return prepareChild(
                academyId, actorAccountId, parentId, rawName, StorageNodeType.FILE, normalizedMediaType,
                StorageOperationType.UPLOAD);
    }

    /**
     * 이름 변경 준비
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param nodeId 대상 노드 ID
     * @param rawName 새 이름
     * @return 준비된 변경
     */
    @Transactional
    public PreparedStorageMutation prepareRename(UUID academyId, UUID actorAccountId, UUID nodeId, String rawName) {
        var node = lockedNode(nodeId, academyId);
        requireMutableActiveNode(node);
        var nodes = nodeRepository.findAllByAcademyId(academyId);
        var tree = new StorageTreeSnapshot(nodes);
        var name = StorageNamePolicy.validate(rawName);
        ensureNameAvailable(nodes, node.getParentId(), StorageNamePolicy.normalize(name), node.getId());

        var sourcePath = tree.externalPath(node.getId());
        var destinationPath = tree.externalPath(node.getParentId()) + "/" + name;
        var now = Instant.now();
        node.beginMutation(now);
        return record(node, actorAccountId, StorageOperationType.RENAME, sourcePath, destinationPath, null, name, now);
    }

    /**
     * 이동 준비
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param nodeId 대상 노드 ID
     * @param destinationParentId 옮겨 갈 폴더 ID
     * @return 준비된 변경
     */
    @Transactional
    public PreparedStorageMutation prepareMove(
            UUID academyId, UUID actorAccountId, UUID nodeId, UUID destinationParentId) {
        var node = lockedNode(nodeId, academyId);
        var destination = lockedNode(destinationParentId, academyId);
        requireMutableActiveNode(node);
        requireActiveFolder(destination);
        var nodes = nodeRepository.findAllByAcademyId(academyId);
        var tree = new StorageTreeSnapshot(nodes);
        if (tree.wouldCreateCycle(node.getId(), destination.getId())) {
            throw new StorageConflictException("STORAGE_MOVE_CYCLE", "폴더를 자기 자신이나 자기 하위 폴더로 옮길 수 없습니다.");
        }
        ensureNameAvailable(nodes, destination.getId(), node.getNormalizedName(), node.getId());

        var sourcePath = tree.externalPath(node.getId());
        var destinationPath = tree.externalPath(destination.getId()) + "/" + node.getName();
        var now = Instant.now();
        node.beginMutation(now);
        return record(
                node, actorAccountId, StorageOperationType.MOVE, sourcePath, destinationPath, destination.getId(),
                null, now);
    }

    /**
     * 영구 삭제 준비
     *
     * 묶음 전체를 DELETING으로 바꿈
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param nodeId 휴지통의 최상위 항목 ID
     * @return 준비된 변경
     * @throws StorageConflictException 휴지통의 최상위 항목이 아니거나 묶음의 상태가 서로 다를 때
     */
    @Transactional
    public PreparedStorageMutation prepareDelete(UUID academyId, UUID actorAccountId, UUID nodeId) {
        var node = lockedNode(nodeId, academyId);
        if (!node.isTrashRoot() || node.isSystemRoot()) {
            throw new StorageConflictException("STORAGE_DELETE_REQUIRES_TRASH", "휴지통에 있는 항목만 영구 삭제할 수 있습니다.");
        }
        var tree = new StorageTreeSnapshot(nodeRepository.findAllByAcademyId(academyId));
        var subtree = tree.subtree(node.getId());
        for (var child : subtree) {
            if (child.getStatus() != StorageNodeStatus.TRASHED || !node.getId().equals(child.getTrashRootId())) {
                throw new StorageConflictException("STORAGE_TRASH_SUBTREE_CONFLICT", "휴지통 항목의 상태가 서로 달라 삭제할 수 없습니다.");
            }
        }

        var path = tree.externalPath(node.getId());
        var now = Instant.now();
        for (var child : subtree) {
            child.beginDeleting(now);
        }
        return record(node, actorAccountId, StorageOperationType.DELETE_PERMANENTLY, null, path, null, null, now);
    }

    /**
     * 확인 대상인 작업을 다시 실행할 수 있게 준비
     *
     * @param academyId 학원 ID
     * @param operationId 작업 ID
     * @return 원장에 적힌 경로로 다시 만든 변경
     * @throws StorageNotFoundException 그 학원의 작업이 아닐 때
     * @throws StorageConflictException 확인 대상 상태가 아닐 때
     */
    @Transactional(readOnly = true)
    public PreparedStorageMutation prepareReconcile(UUID academyId, UUID operationId) {
        var operation = operationRepository.findById(operationId)
                .filter(candidate -> candidate.getAcademyId().equals(academyId))
                .orElseThrow(() -> new StorageNotFoundException("STORAGE_OPERATION_NOT_FOUND", "작업을 찾을 수 없습니다."));
        if (operation.getStatus() != StorageOperationStatus.VERIFY) {
            throw new StorageConflictException("STORAGE_OPERATION_NOT_VERIFIABLE", "결과 확인이 필요한 작업이 아닙니다.");
        }
        return new PreparedStorageMutation(
                operation.getId(),
                operation.getAcademyId(),
                operation.getTargetNodeId(),
                operation.getOperationType(),
                operation.getSourcePath(),
                operation.getDestinationPath());
    }

    /**
     * 폴더 아래에 새 노드를 만드는 변경의 공통 준비
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param parentId 부모 폴더 ID
     * @param rawName 새 이름
     * @param nodeType 만들 노드 종류
     * @param mediaType 파일의 미디어 타입. 폴더는 null
     * @param operationType 원장에 남길 작업 종류
     * @return 준비된 변경
     */
    private PreparedStorageMutation prepareChild(
            UUID academyId,
            UUID actorAccountId,
            UUID parentId,
            String rawName,
            StorageNodeType nodeType,
            String mediaType,
            StorageOperationType operationType) {
        // 부모를 잠가 같은 폴더에 같은 이름을 동시에 만드는 두 요청을 한 줄로 세움
        var parent = lockedNode(parentId, academyId);
        requireActiveFolder(parent);
        var nodes = nodeRepository.findAllByAcademyId(academyId);
        var tree = new StorageTreeSnapshot(nodes);
        var name = StorageNamePolicy.validate(rawName);
        ensureNameAvailable(nodes, parent.getId(), StorageNamePolicy.normalize(name), null);

        var now = Instant.now();
        var node = nodeRepository.save(new StorageNodeEntity(
                academyId, parent.getId(), nodeType, name, null, mediaType, actorAccountId, now));
        var destinationPath = tree.externalPath(parent.getId()) + "/" + name;
        return record(node, actorAccountId, operationType, null, destinationPath, parent.getId(), name, now);
    }

    /**
     * 원장에 대기 상태의 작업을 기록
     *
     * @param node 대상 노드
     * @param actorAccountId 실행하는 계정 ID
     * @param type 작업 종류
     * @param sourcePath 원본 경로. 없으면 null
     * @param destinationPath 대상 경로
     * @param destinationParentId 이동할 폴더 ID. 없으면 null
     * @param requestedName 새 이름. 없으면 null
     * @param now 기록 시각
     * @return 준비된 변경
     */
    private PreparedStorageMutation record(
            StorageNodeEntity node,
            UUID actorAccountId,
            StorageOperationType type,
            String sourcePath,
            String destinationPath,
            UUID destinationParentId,
            String requestedName,
            Instant now) {
        var operation = operationRepository.save(new StorageOperationEntity(
                node.getAcademyId(),
                actorAccountId,
                type,
                node.getId(),
                sourcePath,
                destinationPath,
                destinationParentId,
                requestedName,
                now));
        return new PreparedStorageMutation(
                operation.getId(), node.getAcademyId(), node.getId(), type, sourcePath, destinationPath);
    }

    /**
     * 학원 안에서 노드를 쓰기 잠금으로 가져옴
     *
     * @param nodeId 노드 ID
     * @param academyId 학원 ID
     * @return 잠근 노드
     * @throws StorageNotFoundException 그 학원에 없는 노드일 때
     */
    private StorageNodeEntity lockedNode(UUID nodeId, UUID academyId) {
        return nodeRepository.findLocked(nodeId, academyId)
                .filter(node -> node.getStatus() != StorageNodeStatus.DELETED)
                .orElseThrow(() -> new StorageNotFoundException("STORAGE_NODE_NOT_FOUND", "파일이나 폴더를 찾을 수 없습니다."));
    }

    /**
     * 루트가 아니고 정상 상태인지 확인
     *
     * @param node 확인할 노드
     * @throws StorageConflictException 루트이거나 정상 상태가 아닐 때
     */
    static void requireMutableActiveNode(StorageNodeEntity node) {
        if (node.isSystemRoot()) {
            throw new StorageConflictException("STORAGE_ROOT_IMMUTABLE", "자료실 루트는 바꿀 수 없습니다.");
        }
        if (node.getStatus() != StorageNodeStatus.ACTIVE) {
            throw new StorageConflictException("STORAGE_NODE_NOT_ACTIVE", "다른 작업이 처리 중이거나 휴지통에 있는 항목입니다.");
        }
    }

    /**
     * 정상 상태의 폴더인지 확인
     *
     * @param node 확인할 노드
     * @throws StorageConflictException 폴더가 아니거나 정상 상태가 아닐 때
     */
    static void requireActiveFolder(StorageNodeEntity node) {
        if (node.getNodeType() != StorageNodeType.FOLDER || node.getStatus() != StorageNodeStatus.ACTIVE) {
            throw new StorageConflictException("STORAGE_FOLDER_NOT_ACTIVE", "사용할 수 있는 폴더가 아닙니다.");
        }
    }

    /**
     * 폴더 안에 같은 이름의 살아 있는 항목이 없는지 확인
     *
     * 휴지통에 있는 항목도 복원될 수 있으므로 이름을 차지한 것으로 봄
     *
     * @param nodes 학원의 전체 노드
     * @param parentId 폴더 ID
     * @param normalizedName 중복 검사용 이름
     * @param excludedNodeId 비교에서 뺄 노드 ID. 없으면 null
     * @throws StorageConflictException 같은 이름이 이미 있을 때
     */
    static void ensureNameAvailable(
            Collection<StorageNodeEntity> nodes, UUID parentId, String normalizedName, UUID excludedNodeId) {
        for (var candidate : nodes) {
            var live = candidate.getStatus() != StorageNodeStatus.DELETED
                    && candidate.getStatus() != StorageNodeStatus.FAILED;
            if (live
                    && !candidate.getId().equals(excludedNodeId)
                    && parentId.equals(candidate.getParentId())
                    && candidate.getNormalizedName().equals(normalizedName)) {
                throw new StorageConflictException("STORAGE_NAME_CONFLICT", "같은 폴더에 같은 이름의 항목이 이미 있습니다. 휴지통도 확인해 주세요.");
            }
        }
    }
}
