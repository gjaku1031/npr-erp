package com.npr.erp.identity;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 계정 조회 계약
 */
public interface AccountDirectory {
    /**
     * 로그인 아이디로 자격 정보 조회
     *
     * @param username 로그인 아이디
     * @return 계정이 없으면 빈 값
     */
    Optional<AccountCredentials> findCredentialsByUsername(String username);

    /**
     * 활성 계정 확인
     *
     * @param accountId 계정 ID
     * @return 활성 계정 정보
     * @throws AccountNotFoundException 계정이 없을 때
     * @throws AccountInactiveException 계정이 활성 상태가 아닐 때
     */
    AuthenticatedAccount requireActive(UUID accountId);

    /**
     * 계정 조회
     *
     * @param accountId 계정 ID
     * @return 계정이 없으면 빈 값
     */
    Optional<AuthenticatedAccount> find(UUID accountId);

    /**
     * 여러 계정을 한 번에 조회
     *
     * 화면에서 계정 ID를 이름으로 바꿀 때 사용. 없는 ID는 결과에서 빠짐
     *
     * @param accountIds 계정 ID 목록
     * @return 찾은 계정 목록. 순서는 보장하지 않음
     */
    List<AuthenticatedAccount> findAll(Collection<UUID> accountIds);

    /**
     * 전체 계정을 로그인 아이디 순으로 조회
     *
     * @return 계정 목록
     */
    List<AuthenticatedAccount> list();
}
