package com.npr.erp.accesscontrol.internal.role;

import com.npr.erp.accesscontrol.AcademyRoleStatus;
import com.npr.erp.accesscontrol.AcademyRoleView;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import lombok.Getter;

/**
 * 학원이 정의한 역할
 */
@Getter
@Entity(name = "AcademyRole")
@Table(name = "academy_role")
public class AcademyRoleEntity {
    /**
     * 역할 ID
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
     * 표시 이름
     */
    @Column(name = "name", nullable = false, length = 120)
    private String name;

    /**
     * 중복 검사용 정규화 이름
     */
    @Column(name = "normalized_name", nullable = false, length = 120)
    private String normalizedName;

    /**
     * 역할 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private AcademyRoleStatus status;

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
     * JPA 인스턴스 초기화
     */
    protected AcademyRoleEntity() {
    }

    /**
     * 활성 상태의 새 역할 생성
     *
     * @param academyId 학원 ID
     * @param name 정규화한 이름
     * @param createdBy 만든 계정 ID
     * @param now 생성 시각
     */
    public AcademyRoleEntity(UUID academyId, NormalizedRoleName name, UUID createdBy, Instant now) {
        this.id = UUID.randomUUID();
        this.academyId = academyId;
        this.name = name.displayName();
        this.normalizedName = name.normalizedName();
        this.status = AcademyRoleStatus.ACTIVE;
        this.createdBy = createdBy;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /**
     * 이름 변경
     *
     * @param newName 정규화한 새 이름
     * @param now 변경 시각
     */
    public void rename(NormalizedRoleName newName, Instant now) {
        this.name = newName.displayName();
        this.normalizedName = newName.normalizedName();
        this.updatedAt = now;
    }

    /**
     * 비활성화
     *
     * @param now 변경 시각
     */
    public void deactivate(Instant now) {
        this.status = AcademyRoleStatus.INACTIVE;
        this.updatedAt = now;
    }

    /**
     * 공개 조회 결과로 변환
     *
     * @param permissions 이 역할에 연결된 권한 키
     * @return 역할 조회 결과
     */
    public AcademyRoleView toView(Set<String> permissions) {
        return new AcademyRoleView(id, academyId, name, status, Set.copyOf(permissions));
    }
}
