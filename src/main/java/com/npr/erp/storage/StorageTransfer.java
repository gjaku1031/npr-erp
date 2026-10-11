package com.npr.erp.storage;

import java.io.InputStream;
import java.util.UUID;

/**
 * 파일 전송 계약
 */
public interface StorageTransfer {
    /**
     * 파일 올리기
     *
     * 노드와 작업을 먼저 기록하고, DB 트랜잭션 밖에서 본문을 외부 저장소에 쓴 뒤, 실제로 쓰인 크기와 SHA-256으로
     * 노드를 확정함. 쓰다가 실패하면 노드를 FAILED로 남겨 같은 이름을 다시 쓸 수 있게 함
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행하는 계정 ID
     * @param parentId 올릴 폴더 ID
     * @param name 파일 이름
     * @param mediaType 미디어 타입. 비어 있으면 application/octet-stream
     * @param content 파일 본문. 이 메서드가 닫지 않음
     * @return 정상 상태가 된 파일 노드
     * @throws StorageValidationException 이름이 규칙에 맞지 않을 때
     * @throws StorageConflictException 폴더가 정상 상태가 아니거나 같은 이름이 이미 있을 때
     * @throws StorageUnavailableException 외부 저장소에 쓰지 못했을 때
     */
    StorageNodeView upload(
            UUID academyId, UUID actorAccountId, UUID parentId, String name, String mediaType, InputStream content);

    /**
     * 파일 내려받기 열기
     *
     * @param academyId 학원 ID
     * @param nodeId 파일 노드 ID
     * @return 파일 정보와 본문 스트림
     * @throws StorageConflictException 정상 상태의 파일이 아닐 때
     * @throws StorageUnavailableException 외부 저장소에서 읽지 못했을 때
     */
    StorageDownload openDownload(UUID academyId, UUID nodeId);
}
