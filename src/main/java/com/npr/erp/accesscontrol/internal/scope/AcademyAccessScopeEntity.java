package com.npr.erp.accesscontrol.internal.scope;

import com.npr.erp.accesscontrol.AccessControlConflictException;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * 학원별 권한 정책의 뿌리
 *
 * 정책 버전은 소속·역할·권한·배정·ACL 중 무엇이든 실제로 바뀔 때마다 1씩 오름
 */
@Getter
@Entity(name = "AcademyAccessScope")
@Table(name = "academy_access_scope")
public class AcademyAccessScopeEntity {
    /**
     * 학원 ID
     */
    @Id
    @Column(name = "academy_id", nullable = false, updatable = false)
    private UUID academyId;

    /**
     * 학원 저장소 루트 폴더 ID
     */
    @Column(name = "storage_root_resource_id", nullable = false, updatable = false)
    private UUID storageRootResourceId;

    /**
     * 정책 버전
     */
    @Column(name = "policy_version", nullable = false)
    private long policyVersion;

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
     * JPA 인스턴스 초기화
     */
    protected AcademyAccessScopeEntity() {
    }

    /**
     * 버전 1의 새 정책 생성
     *
     * @param academyId 학원 ID
     * @param storageRootResourceId 저장소 루트 폴더 ID
     * @param now 생성 시각
     */
    public AcademyAccessScopeEntity(UUID academyId, UUID storageRootResourceId, Instant now) {
        this.academyId = academyId;
        this.storageRootResourceId = storageRootResourceId;
        this.policyVersion = 1;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /**
     * 화면이 읽었던 버전과 현재 버전이 같은지 확인
     *
     * 다르면 그 사이 다른 관리자가 정책을 바꾼 것이므로, 화면이 최신 정책을 다시 읽고 변경을 재검토해야 함
     *
     * @param expectedPolicyVersion 화면이 읽었던 정책 버전
     * @throws AccessControlConflictException 버전이 다를 때
     */
    public void requireVersion(long expectedPolicyVersion) {
        if (policyVersion != expectedPolicyVersion) {
            throw new AccessControlConflictException(
                    "POLICY_VERSION_MISMATCH", "권한 정책이 그 사이 바뀌었습니다. 현재 버전은 " + policyVersion + "입니다.");
        }
    }

    /**
     * 정책 버전을 1 올림
     *
     * @param now 변경 시각
     * @return 올라간 버전
     */
    public long advance(Instant now) {
        policyVersion += 1;
        updatedAt = now;
        return policyVersion;
    }
}
