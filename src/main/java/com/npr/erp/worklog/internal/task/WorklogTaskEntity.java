package com.npr.erp.worklog.internal.task;

import com.npr.erp.worklog.TaskKind;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 업무
 */
@Getter
@Entity(name = "WorklogTask")
@Table(name = "worklog_task")
public class WorklogTaskEntity {
    /**
     * 업무 ID
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
     * 업무 이름
     */
    @Column(name = "title", nullable = false, length = 200)
    private String title;

    /**
     * 내용
     */
    @Column(name = "description", nullable = false)
    private String description;

    /**
     * 태그 ID
     */
    @Column(name = "tag_id", nullable = false)
    private UUID tagId;

    /**
     * 시작일
     */
    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    /**
     * 마감일
     */
    @Column(name = "due_date", nullable = false)
    private LocalDate dueDate;

    /**
     * 업무 종류
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "kind", nullable = false, updatable = false, length = 32)
    private TaskKind kind;

    /**
     * 배정 후보 전원에게 배정했는지
     */
    @Column(name = "assign_all", nullable = false)
    private boolean assignAll;

    /**
     * 완료에 텍스트 보고가 필요한지
     */
    @Column(name = "report_required", nullable = false)
    private boolean reportRequired;

    /**
     * 완료에 첨부가 필요한지
     */
    @Column(name = "attachment_required", nullable = false)
    private boolean attachmentRequired;

    /**
     * 보관했는지
     */
    @Column(name = "archived", nullable = false)
    private boolean archived;

    /**
     * 참고 링크 목록의 JSON
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "links", columnDefinition = "jsonb", nullable = false)
    private String links;

    /**
     * 개인 상담일정의 소유자 계정 ID
     */
    @Column(name = "owner_account_id", updatable = false)
    private UUID ownerAccountId;

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
    protected WorklogTaskEntity() {
    }

    /**
     * 새 업무 생성
     *
     * @param academyId 학원 ID
     * @param content 검증을 마친 입력
     * @param ownerAccountId 개인 상담일정의 소유자. 다른 종류는 null
     * @param createdBy 만든 계정 ID
     * @param now 생성 시각
     */
    public WorklogTaskEntity(UUID academyId, TaskContent content, UUID ownerAccountId, UUID createdBy, Instant now) {
        this.id = UUID.randomUUID();
        this.academyId = academyId;
        this.kind = content.kind();
        this.ownerAccountId = ownerAccountId;
        this.createdBy = createdBy;
        this.createdAt = now;
        apply(content, now);
    }

    /**
     * 고칠 수 있는 내용을 입력으로 교체
     *
     * 종류와 소유자는 바꾸지 않음
     *
     * @param content 검증을 마친 입력
     * @param now 변경 시각
     */
    public final void apply(TaskContent content, Instant now) {
        this.title = content.title();
        this.description = content.description();
        this.tagId = content.tagId();
        this.startDate = content.startDate();
        this.dueDate = content.dueDate();
        this.assignAll = content.assignAll();
        this.reportRequired = content.reportRequired();
        this.attachmentRequired = content.attachmentRequired();
        this.links = content.linksJson();
        this.updatedAt = now;
    }

    /**
     * 보관 여부 변경
     *
     * @param value 보관할지
     * @param now 변경 시각
     */
    public void archive(boolean value, Instant now) {
        this.archived = value;
        this.updatedAt = now;
    }
}
