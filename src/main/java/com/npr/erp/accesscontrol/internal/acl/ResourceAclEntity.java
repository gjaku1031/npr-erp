package com.npr.erp.accesscontrol.internal.acl;

import com.npr.erp.accesscontrol.ResourceAclSubject;
import com.npr.erp.accesscontrol.ResourceAclView;
import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.accesscontrol.ResourceType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;

/**
 * 리소스에 걸린 ACL 한 건
 */
@Getter
@Entity(name = "ResourceAcl")
@Table(name = "resource_acl")
public class ResourceAclEntity {
    /**
     * ACL ID
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
     * 리소스 종류
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "resource_type", nullable = false, updatable = false, length = 64)
    private ResourceType resourceType;

    /**
     * 리소스 ID
     */
    @Column(name = "resource_id", nullable = false, updatable = false)
    private UUID resourceId;

    /**
     * 주체가 계정일 때의 계정 ID. 역할 주체이면 null
     */
    @Column(name = "subject_account_id", updatable = false)
    private UUID subjectAccountId;

    /**
     * 주체가 역할일 때의 역할 ID. 계정 주체이면 null
     */
    @Column(name = "subject_role_id", updatable = false)
    private UUID subjectRoleId;

    /**
     * 허용하는 작업
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "action", nullable = false, updatable = false, length = 64)
    private ResourceAction action;

    /**
     * 하위 리소스에도 적용할지
     */
    @Column(name = "inherit_to_children", nullable = false)
    private boolean inheritToChildren;

    /**
     * 부여한 계정 ID
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
    protected ResourceAclEntity() {
    }

    /**
     * 새 ACL 생성
     *
     * @param academyId 학원 ID
     * @param resourceType 리소스 종류
     * @param resourceId 리소스 ID
     * @param subject 허용을 받는 주체
     * @param action 허용하는 작업
     * @param inheritToChildren 하위 리소스에도 적용할지
     * @param createdBy 부여한 계정 ID
     * @param now 생성 시각
     */
    public ResourceAclEntity(
            UUID academyId,
            ResourceType resourceType,
            UUID resourceId,
            ResourceAclSubject subject,
            ResourceAction action,
            boolean inheritToChildren,
            UUID createdBy,
            Instant now) {
        this.id = UUID.randomUUID();
        this.academyId = academyId;
        this.resourceType = resourceType;
        this.resourceId = resourceId;
        switch (subject) {
            case ResourceAclSubject.Account account -> this.subjectAccountId = account.accountId();
            case ResourceAclSubject.Role role -> this.subjectRoleId = role.roleId();
        }
        this.action = action;
        this.inheritToChildren = inheritToChildren;
        this.createdBy = createdBy;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /**
     * 상속 설정 변경
     *
     * @param inherit 하위 리소스에도 적용할지
     * @param now 변경 시각
     */
    public void changeInheritance(boolean inherit, Instant now) {
        this.inheritToChildren = inherit;
        this.updatedAt = now;
    }

    /**
     * 공개 조회 결과로 변환
     *
     * @return ACL 조회 결과
     */
    public ResourceAclView toView() {
        ResourceAclSubject subject = subjectAccountId != null
                ? new ResourceAclSubject.Account(subjectAccountId)
                : new ResourceAclSubject.Role(subjectRoleId);
        return new ResourceAclView(
                id, academyId, resourceType, resourceId, subject, action, inheritToChildren, createdAt);
    }
}
