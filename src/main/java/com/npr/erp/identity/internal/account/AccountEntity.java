package com.npr.erp.identity.internal.account;

import com.npr.erp.identity.AccountStatus;
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
 * 로그인 계정
 */
@Getter
@Entity(name = "IdentityAccount")
@Table(name = "account")
public class AccountEntity {
    /**
     * 계정 ID
     */
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * 로그인 아이디
     */
    @Column(name = "username", nullable = false, updatable = false, unique = true, length = 255)
    private String username;

    /**
     * 화면에 보이는 이름
     */
    @Column(name = "display_name", nullable = false, length = 120)
    private String displayName;

    /**
     * BCrypt 해시. 비밀번호를 설정하기 전에는 null
     */
    @Column(name = "password_hash", length = 100)
    private String passwordHash;

    /**
     * 계정 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 32)
    private AccountStatus status;

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
    protected AccountEntity() {
    }

    /**
     * 활성 상태의 새 계정 생성
     *
     * @param id 계정 ID
     * @param username 정규화한 로그인 아이디
     * @param displayName 화면에 보이는 이름
     * @param passwordHash BCrypt 해시
     * @param now 생성 시각
     */
    public AccountEntity(UUID id, String username, String displayName, String passwordHash, Instant now) {
        this.id = id;
        this.username = username;
        this.displayName = displayName;
        this.passwordHash = passwordHash;
        this.status = AccountStatus.ACTIVE;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /**
     * 비밀번호 해시 교체
     *
     * @param newPasswordHash 새 BCrypt 해시
     * @param now 변경 시각
     */
    public void changePassword(String newPasswordHash, Instant now) {
        this.passwordHash = newPasswordHash;
        this.updatedAt = now;
    }

    /**
     * ID가 같으면 같은 계정으로 봄
     */
    @Override
    public boolean equals(Object other) {
        return this == other || other instanceof AccountEntity that && id.equals(that.getId());
    }

    /**
     * ID 기준 해시
     */
    @Override
    public int hashCode() {
        return id.hashCode();
    }
}
