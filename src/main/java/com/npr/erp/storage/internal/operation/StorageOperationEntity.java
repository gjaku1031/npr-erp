package com.npr.erp.storage.internal.operation;

import com.npr.erp.storage.StorageConflictException;
import com.npr.erp.storage.StorageOperationStatus;
import com.npr.erp.storage.StorageOperationType;
import com.npr.erp.storage.StorageOperationView;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * 외부 저장소 작업 원장의 한 줄
 *
 * 외부 저장소를 호출하기 전에 무엇을 하려는지 기록하고, 호출 결과에 따라 상태를 바꿈
 */
@Getter
@Entity(name = "StorageOperation")
@Table(name = "storage_operation")
public class StorageOperationEntity {
    /**
     * 오류 설명의 최대 길이
     */
    private static final int MAX_ERROR_MESSAGE_LENGTH = 1000;

    /**
     * 작업 ID. 외부 저장소 호출에도 같은 값을 넘김
     */
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * 학원 ID
     */
    @Column(name = "academy_id", nullable = false, updatable = false)
    private UUID academyId;

    /**
     * 실행한 계정 ID
     */
    @Column(name = "actor_account_id", nullable = false, updatable = false)
    private UUID actorAccountId;

    /**
     * 작업 종류
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "operation_type", nullable = false, updatable = false, length = 40)
    private StorageOperationType operationType;

    /**
     * 대상 노드 ID
     */
    @Column(name = "target_node_id", nullable = false, updatable = false)
    private UUID targetNodeId;

    /**
     * 작업 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 40)
    private StorageOperationStatus status;

    /**
     * 외부 저장소에서의 원본 경로. 옮기는 작업만 가짐
     */
    @Column(name = "source_path", updatable = false, length = 2000)
    private String sourcePath;

    /**
     * 외부 저장소에서의 대상 경로
     */
    @Column(name = "destination_path", updatable = false, length = 2000)
    private String destinationPath;

    /**
     * 이동할 폴더 ID. 이동만 가짐
     */
    @Column(name = "destination_parent_id", updatable = false)
    private UUID destinationParentId;

    /**
     * 새 이름. 이름 변경만 가짐
     */
    @Column(name = "requested_name", updatable = false, length = 180)
    private String requestedName;

    /**
     * 외부 저장소를 호출한 횟수
     */
    @Column(name = "attempts", nullable = false)
    private int attempts;

    /**
     * 마지막 오류 코드
     */
    @Column(name = "last_error_code", length = 100)
    private String lastErrorCode;

    /**
     * 마지막 오류 설명
     */
    @Column(name = "last_error_message", length = 1000)
    private String lastErrorMessage;

    /**
     * 기록 시각
     */
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /**
     * 마지막으로 호출을 시작한 시각
     */
    @Column(name = "started_at")
    private Instant startedAt;

    /**
     * 완료 시각
     */
    @Column(name = "completed_at")
    private Instant completedAt;

    /**
     * 수정 시각
     */
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * 낙관적 잠금 버전
     */
    @Version
    @Column(name = "version", nullable = false)
    private long version;

    /**
     * JPA 인스턴스 초기화
     */
    protected StorageOperationEntity() {
    }

    /**
     * 대기 상태의 새 작업 기록
     *
     * @param academyId 학원 ID
     * @param actorAccountId 실행한 계정 ID
     * @param operationType 작업 종류
     * @param targetNodeId 대상 노드 ID
     * @param sourcePath 원본 경로. 없으면 null
     * @param destinationPath 대상 경로. 없으면 null
     * @param destinationParentId 이동할 폴더 ID. 없으면 null
     * @param requestedName 새 이름. 없으면 null
     * @param now 기록 시각
     */
    public StorageOperationEntity(
            UUID academyId,
            UUID actorAccountId,
            StorageOperationType operationType,
            UUID targetNodeId,
            String sourcePath,
            String destinationPath,
            UUID destinationParentId,
            String requestedName,
            Instant now) {
        this.id = UUID.randomUUID();
        this.academyId = academyId;
        this.actorAccountId = actorAccountId;
        this.operationType = operationType;
        this.targetNodeId = targetNodeId;
        this.status = StorageOperationStatus.PENDING;
        this.sourcePath = sourcePath;
        this.destinationPath = destinationPath;
        this.destinationParentId = destinationParentId;
        this.requestedName = requestedName;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /**
     * 외부 저장소 호출 시작: PENDING 또는 VERIFY → PROCESSING
     *
     * @param now 시작 시각
     */
    public void start(Instant now) {
        require(status == StorageOperationStatus.PENDING || status == StorageOperationStatus.VERIFY);
        this.status = StorageOperationStatus.PROCESSING;
        this.attempts += 1;
        this.startedAt = now;
        this.updatedAt = now;
        this.lastErrorCode = null;
        this.lastErrorMessage = null;
    }

    /**
     * 완료: PENDING 또는 PROCESSING → COMPLETED
     *
     * 외부 저장소를 건드리지 않는 작업은 PENDING에서 바로 끝남
     *
     * @param now 완료 시각
     */
    public void complete(Instant now) {
        require(status == StorageOperationStatus.PENDING || status == StorageOperationStatus.PROCESSING);
        this.status = StorageOperationStatus.COMPLETED;
        this.completedAt = now;
        this.updatedAt = now;
    }

    /**
     * 실패: PROCESSING → RETRYABLE_FAILED 또는 MANUAL_REVIEW
     *
     * @param code 오류 코드
     * @param message 오류 설명
     * @param retryable 다시 시도할 수 있는 실패인지
     * @param now 실패 시각
     */
    public void fail(String code, String message, boolean retryable, Instant now) {
        require(status == StorageOperationStatus.PROCESSING);
        this.status = retryable ? StorageOperationStatus.RETRYABLE_FAILED : StorageOperationStatus.MANUAL_REVIEW;
        this.lastErrorCode = code;
        this.lastErrorMessage =
                message.length() > MAX_ERROR_MESSAGE_LENGTH ? message.substring(0, MAX_ERROR_MESSAGE_LENGTH) : message;
        this.updatedAt = now;
    }

    /**
     * 호출 도중 프로세스가 끝난 작업을 확인 대상으로 표시: PROCESSING → VERIFY
     *
     * @param now 표시 시각
     */
    public void requireVerification(Instant now) {
        require(status == StorageOperationStatus.PROCESSING || status == StorageOperationStatus.PENDING);
        this.status = StorageOperationStatus.VERIFY;
        this.lastErrorCode = "STORAGE_PROCESS_RESTARTED";
        this.lastErrorMessage = "작업 도중 서버가 다시 시작돼 결과를 확인해야 합니다.";
        this.updatedAt = now;
    }

    /**
     * 공개 조회 결과로 변환
     *
     * @param targetName 대상의 이름
     * @return 작업 조회 결과
     */
    public StorageOperationView toView(String targetName) {
        return new StorageOperationView(
                id,
                academyId,
                targetNodeId,
                requestedName != null ? requestedName : targetName,
                operationType,
                status,
                attempts,
                lastErrorCode,
                actorAccountId,
                createdAt,
                completedAt);
    }

    /**
     * 허용된 상태 전이인지 확인
     *
     * @param allowed 지금 상태에서 요청한 전이가 허용되는지
     * @throws StorageConflictException 허용되지 않을 때
     */
    private static void require(boolean allowed) {
        if (!allowed) {
            throw new StorageConflictException("STORAGE_OPERATION_STATE_CONFLICT", "작업 상태가 요청한 처리와 맞지 않습니다.");
        }
    }
}
