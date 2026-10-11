package com.npr.erp.identity.internal.account;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * 계정 저장소
 */
public interface AccountRepository extends JpaRepository<AccountEntity, UUID> {
    /**
     * 로그인 아이디로 조회
     *
     * @param username 정규화한 로그인 아이디
     * @return 계정이 없으면 빈 값
     */
    Optional<AccountEntity> findByUsername(String username);

    /**
     * 전체 계정을 로그인 아이디 순으로 조회
     *
     * @return 계정 목록
     */
    List<AccountEntity> findAllByOrderByUsernameAsc();
}
