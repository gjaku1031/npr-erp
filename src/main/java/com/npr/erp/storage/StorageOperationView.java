package com.npr.erp.storage;

import java.time.Instant;
import java.util.UUID;

/**
 * 작업 조회 결과
 *
 * @param id 작업 ID
 * @param academyId 학원 ID
 * @param targetNodeId 대상 노드 ID
 * @param targetName 대상의 이름. 이름 변경은 새 이름
 * @param type 작업 종류
 * @param status 작업 상태
 * @param attempts 외부 저장소를 호출한 횟수
 * @param lastErrorCode 마지막 오류 코드. 없으면 null
 * @param actorAccountId 실행한 계정 ID
 * @param createdAt 기록 시각
 * @param completedAt 완료 시각. 끝나지 않았으면 null
 */
public record StorageOperationView(
        UUID id,
        UUID academyId,
        UUID targetNodeId,
        String targetName,
        StorageOperationType type,
        StorageOperationStatus status,
        int attempts,
        String lastErrorCode,
        UUID actorAccountId,
        Instant createdAt,
        Instant completedAt) {
}
