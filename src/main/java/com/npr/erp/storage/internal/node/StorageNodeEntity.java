package com.npr.erp.storage.internal.node;

import com.npr.erp.storage.StorageConflictException;
import com.npr.erp.storage.StorageNodeStatus;
import com.npr.erp.storage.StorageNodeType;
import com.npr.erp.storage.StorageNodeView;
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
 * 자료실의 파일 또는 폴더
 *
 * 상태 전이는 모두 이 클래스의 메서드로만 하며, 허용되지 않은 전이는 예외로 막음
 */
@Getter
@Entity(name = "StorageNode")
@Table(name = "storage_node")
public class StorageNodeEntity {
    /**
     * 노드 ID
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
     * 부모 폴더 ID. 루트는 null
     */
    @Column(name = "parent_id")
    private UUID parentId;

    /**
     * 노드 종류
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "node_type", nullable = false, updatable = false, length = 32)
    private StorageNodeType nodeType;

    /**
     * 이름
     */
    @Column(name = "name", nullable = false, length = 180)
    private String name;

    /**
     * 중복 검사용 이름
     */
    @Column(name = "normalized_name", nullable = false, length = 180)
    private String normalizedName;

    /**
     * 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private StorageNodeStatus status;

    /**
     * 외부 저장소에서의 기준 경로. 루트만 가짐
     */
    @Column(name = "external_locator", length = 1000)
    private String externalLocator;

    /**
     * 파일 크기. 폴더와 올리는 중인 파일은 null
     */
    @Column(name = "size_bytes")
    private Long sizeBytes;

    /**
     * 파일의 미디어 타입. 폴더는 null
     */
    @Column(name = "media_type", length = 255)
    private String mediaType;

    /**
     * 파일 본문의 SHA-256. 폴더와 올리는 중인 파일은 null
     */
    @Column(name = "checksum_sha256", length = 64)
    private String checksumSha256;

    /**
     * 함께 버려진 묶음의 최상위 노드 ID. 휴지통에 없으면 null
     */
    @Column(name = "trash_root_id")
    private UUID trashRootId;

    /**
     * 만든 계정 ID
     */
    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    /**
     * 생성 시각
     */
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /**
     * 수정 시각
     */
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * 휴지통으로 보낸 시각
     */
    @Column(name = "trashed_at")
    private Instant trashedAt;

    /**
     * 영구 삭제한 시각
     */
    @Column(name = "deleted_at")
    private Instant deletedAt;

    /**
     * 낙관적 잠금 버전
     */
    @Version
    @Column(name = "version", nullable = false)
    private long version;

    /**
     * JPA 인스턴스 초기화
     */
    protected StorageNodeEntity() {
    }

    /**
     * 만드는 중 상태의 새 노드 생성
     *
     * @param academyId 학원 ID
     * @param parentId 부모 폴더 ID. 루트는 null
     * @param nodeType 노드 종류
     * @param name 검증한 이름
     * @param externalLocator 외부 저장소의 기준 경로. 루트가 아니면 null
     * @param mediaType 파일의 미디어 타입. 폴더는 null
     * @param createdBy 만든 계정 ID
     * @param now 생성 시각
     */
    public StorageNodeEntity(
            UUID academyId,
            UUID parentId,
            StorageNodeType nodeType,
            String name,
            String externalLocator,
            String mediaType,
            UUID createdBy,
            Instant now) {
        this.id = UUID.randomUUID();
        this.academyId = academyId;
        this.parentId = parentId;
        this.nodeType = nodeType;
        this.name = name;
        this.normalizedName = StorageNamePolicy.normalize(name);
        this.status = StorageNodeStatus.PROVISIONING;
        this.externalLocator = externalLocator;
        this.mediaType = mediaType;
        this.createdBy = createdBy;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /**
     * 만들기 완료: PROVISIONING → ACTIVE
     *
     * @param now 변경 시각
     */
    public void activate(Instant now) {
        transition(StorageNodeStatus.PROVISIONING, StorageNodeStatus.ACTIVE, now);
    }

    /**
     * 파일 올리기 완료: PROVISIONING → ACTIVE
     *
     * @param actualSize 외부 저장소에 실제로 쓰인 크기
     * @param actualChecksum 실제로 쓰인 본문의 SHA-256
     * @param now 변경 시각
     */
    public void completeUpload(long actualSize, String actualChecksum, Instant now) {
        transition(StorageNodeStatus.PROVISIONING, StorageNodeStatus.ACTIVE, now);
        this.sizeBytes = actualSize;
        this.checksumSha256 = actualChecksum;
    }

    /**
     * 만들기 실패: PROVISIONING → FAILED. 이름을 다시 쓸 수 있게 됨
     *
     * @param now 변경 시각
     */
    public void failProvisioning(Instant now) {
        transition(StorageNodeStatus.PROVISIONING, StorageNodeStatus.FAILED, now);
    }

    /**
     * 이름 변경·이동 시작: ACTIVE → MUTATING
     *
     * @param now 변경 시각
     */
    public void beginMutation(Instant now) {
        transition(StorageNodeStatus.ACTIVE, StorageNodeStatus.MUTATING, now);
    }

    /**
     * 이름 변경 완료: MUTATING → ACTIVE
     *
     * @param newName 검증한 새 이름
     * @param now 변경 시각
     */
    public void completeRename(String newName, Instant now) {
        transition(StorageNodeStatus.MUTATING, StorageNodeStatus.ACTIVE, now);
        this.name = newName;
        this.normalizedName = StorageNamePolicy.normalize(newName);
    }

    /**
     * 이동 완료: MUTATING → ACTIVE
     *
     * @param newParentId 옮겨 간 폴더 ID
     * @param now 변경 시각
     */
    public void completeMove(UUID newParentId, Instant now) {
        transition(StorageNodeStatus.MUTATING, StorageNodeStatus.ACTIVE, now);
        this.parentId = newParentId;
    }

    /**
     * 이름 변경·이동 실패: MUTATING → ACTIVE. 이름과 위치는 그대로
     *
     * @param now 변경 시각
     */
    public void recoverMutation(Instant now) {
        transition(StorageNodeStatus.MUTATING, StorageNodeStatus.ACTIVE, now);
    }

    /**
     * 휴지통으로 보내기: ACTIVE → TRASHED
     *
     * @param rootId 함께 버려진 묶음의 최상위 노드 ID
     * @param now 변경 시각
     */
    public void markTrashed(UUID rootId, Instant now) {
        transition(StorageNodeStatus.ACTIVE, StorageNodeStatus.TRASHED, now);
        this.trashRootId = rootId;
        this.trashedAt = now;
    }

    /**
     * 복원: TRASHED → ACTIVE
     *
     * @param now 변경 시각
     */
    public void restore(Instant now) {
        transition(StorageNodeStatus.TRASHED, StorageNodeStatus.ACTIVE, now);
        this.trashRootId = null;
        this.trashedAt = null;
    }

    /**
     * 영구 삭제 시작: TRASHED → DELETING
     *
     * @param now 변경 시각
     */
    public void beginDeleting(Instant now) {
        transition(StorageNodeStatus.TRASHED, StorageNodeStatus.DELETING, now);
    }

    /**
     * 영구 삭제 완료: DELETING → DELETED
     *
     * @param now 변경 시각
     */
    public void completeDeletion(Instant now) {
        transition(StorageNodeStatus.DELETING, StorageNodeStatus.DELETED, now);
        this.trashRootId = null;
        this.deletedAt = now;
    }

    /**
     * 영구 삭제 실패: DELETING → TRASHED. 휴지통에 그대로 남음
     *
     * @param now 변경 시각
     */
    public void recoverDeletion(Instant now) {
        transition(StorageNodeStatus.DELETING, StorageNodeStatus.TRASHED, now);
    }

    /**
     * 학원 루트인지 확인
     *
     * @return 부모가 없으면 true
     */
    public boolean isSystemRoot() {
        return parentId == null;
    }

    /**
     * 휴지통에서 직접 고를 수 있는 묶음의 최상위 항목인지 확인
     *
     * @return 휴지통에 있고 자기 자신이 묶음의 최상위이면 true
     */
    public boolean isTrashRoot() {
        return status == StorageNodeStatus.TRASHED && id.equals(trashRootId);
    }

    /**
     * 공개 조회 결과로 변환
     *
     * @return 노드 조회 결과
     */
    public StorageNodeView toView() {
        return new StorageNodeView(
                id, academyId, parentId, nodeType, name, status, sizeBytes, mediaType, createdBy, updatedAt, trashedAt);
    }

    /**
     * 기대한 상태일 때만 다음 상태로 바꿈
     *
     * @param expected 지금이어야 하는 상태
     * @param next 바꿀 상태
     * @param now 변경 시각
     * @throws StorageConflictException 지금 상태가 기대와 다를 때
     */
    private void transition(StorageNodeStatus expected, StorageNodeStatus next, Instant now) {
        if (status != expected) {
            throw new StorageConflictException("STORAGE_NODE_STATE_CONFLICT", "다른 작업이 처리 중이거나 상태가 바뀐 항목입니다.");
        }
        this.status = next;
        this.updatedAt = now;
    }
}
