package com.npr.erp.storage;

import java.util.UUID;

/**
 * 자료실 트리 변경 계약
 *
 * 외부 저장소를 바꾸는 작업은 원장에 먼저 기록하고, DB 트랜잭션 밖에서 외부 저장소를 호출한 뒤, 결과에 따라 확정함.
 * 외부 호출이 실패하면 노드를 이전 상태로 되돌리고 {@link StorageUnavailableException}을 던짐
 */
public interface StorageMutation {
    /**
     * 학원 루트 폴더 생성
     *
     * 이미 있으면 새로 만들지 않고 기존 루트를 돌려줌
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param displayName 루트 폴더 이름
     * @return 정상 상태의 루트
     */
    StorageNodeView initializeRoot(UUID academyId, UUID actorAccountId, String displayName);

    /**
     * 폴더 생성
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param parentId 부모 폴더 ID
     * @param name 새 폴더 이름
     * @return 만든 폴더
     * @throws StorageValidationException 이름이 규칙에 맞지 않을 때
     * @throws StorageConflictException 부모가 정상 폴더가 아니거나 같은 이름이 이미 있을 때
     */
    StorageNodeView createFolder(UUID academyId, UUID actorAccountId, UUID parentId, String name);

    /**
     * 이름 변경
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param nodeId 대상 노드 ID
     * @param name 새 이름
     * @return 이름이 바뀐 노드
     * @throws StorageConflictException 루트이거나, 정상 상태가 아니거나, 같은 이름이 이미 있을 때
     */
    StorageNodeView rename(UUID academyId, UUID actorAccountId, UUID nodeId, String name);

    /**
     * 다른 폴더로 이동
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param nodeId 대상 노드 ID
     * @param destinationParentId 옮겨 갈 폴더 ID
     * @return 옮겨진 노드
     * @throws StorageConflictException 자기 자신이나 자기 하위로 옮기려 하거나, 대상 폴더에 같은 이름이 있을 때
     */
    StorageNodeView move(UUID academyId, UUID actorAccountId, UUID nodeId, UUID destinationParentId);

    /**
     * 휴지통으로 보내기
     *
     * 외부 저장소의 파일은 그대로 두고 상태만 바꿈. 폴더는 하위 항목 전체가 함께 감
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param nodeId 대상 노드 ID
     * @return 휴지통에 들어간 노드
     * @throws StorageConflictException 루트이거나, 하위에 처리 중인 항목이 있을 때
     */
    StorageNodeView trash(UUID academyId, UUID actorAccountId, UUID nodeId);

    /**
     * 휴지통에서 원래 폴더로 복원
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param nodeId 휴지통의 최상위 항목 ID
     * @return 복원된 노드
     * @throws StorageConflictException 원래 폴더가 정상 상태가 아니거나 같은 이름이 생겼을 때
     */
    StorageNodeView restore(UUID academyId, UUID actorAccountId, UUID nodeId);

    /**
     * 휴지통의 항목을 영구 삭제
     *
     * 외부 저장소에서 지운 것을 확인한 뒤 행을 DELETED로 남김
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param nodeId 휴지통의 최상위 항목 ID
     * @throws StorageConflictException 휴지통의 최상위 항목이 아닐 때
     */
    void deletePermanently(UUID academyId, UUID actorAccountId, UUID nodeId);

    /**
     * 끝나지 않은 작업을 외부 저장소의 실제 상태에 맞춰 마무리
     *
     * 같은 변경을 그대로 다시 보내지 않고, 이미 반영됐는지 먼저 확인하는 어댑터 계약에 기대어 다시 실행함
     *
     * @param academyId 학원 ID
     * @param operationId 작업 ID
     * @return 다시 확인한 뒤의 작업 상태
     * @throws StorageConflictException 끝나지 않은 상태의 작업이 아닐 때
     */
    StorageOperationView reconcile(UUID academyId, UUID operationId);
}
