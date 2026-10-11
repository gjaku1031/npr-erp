package com.npr.erp.storage.internal.mutation;

import com.npr.erp.storage.StorageOperationType;
import java.util.UUID;

/**
 * 원장에 기록을 마치고 외부 저장소 호출을 기다리는 변경
 *
 * 준비 트랜잭션이 끝난 뒤 트랜잭션 밖에서 쓰는 값이라 엔티티가 아니라 값으로 넘김
 *
 * @param operationId 작업 ID
 * @param academyId 학원 ID
 * @param targetNodeId 대상 노드 ID
 * @param operationType 작업 종류
 * @param sourcePath 원본 경로. 옮기는 작업만 가짐
 * @param destinationPath 대상 경로
 */
public record PreparedStorageMutation(
        UUID operationId,
        UUID academyId,
        UUID targetNodeId,
        StorageOperationType operationType,
        String sourcePath,
        String destinationPath) {
}
