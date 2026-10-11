package com.npr.erp.identity.internal.account;

import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 계정 생성·변경을 한 줄로 세우는 트랜잭션 잠금
 *
 * 같은 아이디로 동시에 들어온 생성 요청이 서로의 결과를 보지 못하고 둘 다 저장을 시도하는 일을 막음
 */
@Component
@RequiredArgsConstructor
public class AccountMutationLock {
    /**
     * PostgreSQL advisory lock 키. 다른 잠금과 겹치지 않는 고정값
     */
    private static final long LOCK_KEY = 6719032402L;

    /**
     * 현재 트랜잭션의 영속성 컨텍스트
     */
    private final EntityManager entityManager;

    /**
     * 현재 트랜잭션이 끝날 때까지 잠금 획득
     *
     * 트랜잭션 안에서 호출해야 함
     */
    public void acquire() {
        entityManager.createNativeQuery("select pg_advisory_xact_lock(:key)")
                .setParameter("key", LOCK_KEY)
                .getSingleResult();
    }
}
