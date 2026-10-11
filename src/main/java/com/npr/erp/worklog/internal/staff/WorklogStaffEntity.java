package com.npr.erp.worklog.internal.staff;

import jakarta.persistence.Column;
import jakarta.persistence.EmbeddedId;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.Getter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 직원의 업무일지 설정
 */
@Getter
@Entity(name = "WorklogStaff")
@Table(name = "worklog_staff")
public class WorklogStaffEntity {
    /**
     * 담당 반이 없을 때의 JSON
     */
    private static final String NO_CLASSROOMS = "[]";

    /**
     * 학원 ID와 계정 ID
     */
    @EmbeddedId
    private WorklogStaffId id;

    /**
     * 연결한 외부 시스템 직원 코드
     */
    @Column(name = "tng_staff_code", length = 32)
    private String tngStaffCode;

    /**
     * 가져온 담당 반 목록의 JSON
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "classrooms", columnDefinition = "jsonb", nullable = false)
    private String classrooms;

    /**
     * 담당 반을 마지막으로 가져온 시각
     */
    @Column(name = "classrooms_synced_at")
    private Instant classroomsSyncedAt;

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
    protected WorklogStaffEntity() {
    }

    /**
     * 연결과 담당 반이 빈 새 설정 생성
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     * @param now 생성 시각
     */
    public WorklogStaffEntity(UUID academyId, UUID accountId, Instant now) {
        this.id = new WorklogStaffId(academyId, accountId);
        this.classrooms = NO_CLASSROOMS;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /**
     * 외부 시스템 직원 코드 변경
     *
     * 다른 직원의 반이 남지 않도록 이전에 가져온 담당 반을 비움
     *
     * @param staffCode 새 직원 코드. 연결 해제는 null
     * @param now 변경 시각
     */
    public void linkTngStaff(String staffCode, Instant now) {
        this.tngStaffCode = staffCode;
        this.classrooms = NO_CLASSROOMS;
        this.classroomsSyncedAt = null;
        this.updatedAt = now;
    }

    /**
     * 가져온 담당 반으로 교체
     *
     * @param classroomsJson 담당 반 목록의 JSON
     * @param now 가져온 시각
     */
    public void replaceClassrooms(String classroomsJson, Instant now) {
        this.classrooms = classroomsJson;
        this.classroomsSyncedAt = now;
        this.updatedAt = now;
    }
}
