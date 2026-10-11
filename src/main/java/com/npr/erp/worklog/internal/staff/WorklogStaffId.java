package com.npr.erp.worklog.internal.staff;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;
import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;
import lombok.Getter;

/**
 * 직원 설정의 복합 키
 */
@Getter
@Embeddable
public final class WorklogStaffId implements Serializable {
    /**
     * 학원 ID
     */
    @Column(name = "academy_id", nullable = false)
    private UUID academyId;

    /**
     * 계정 ID
     */
    @Column(name = "account_id", nullable = false)
    private UUID accountId;

    /**
     * JPA 인스턴스 초기화
     */
    WorklogStaffId() {
    }

    /**
     * 학원과 계정으로 복합 키 생성
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     */
    public WorklogStaffId(UUID academyId, UUID accountId) {
        this.academyId = academyId;
        this.accountId = accountId;
    }

    /**
     * 학원 ID와 계정 ID가 모두 같으면 같은 키
     */
    @Override
    public boolean equals(Object other) {
        return this == other
                || other instanceof WorklogStaffId that
                        && Objects.equals(academyId, that.academyId)
                        && Objects.equals(accountId, that.accountId);
    }

    /**
     * 학원 ID와 계정 ID 기준 해시
     */
    @Override
    public int hashCode() {
        return Objects.hash(academyId, accountId);
    }
}
