package com.npr.erp.accesscontrol.internal.scope;

import jakarta.persistence.EntityManager;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 한 학원의 정책 변경을 한 줄로 세우는 트랜잭션 잠금
 *
 * 정책 행이 아직 없는 초기화 경쟁도 막아야 하므로 행 잠금이 아니라 학원 ID로 만든 advisory lock을 씀
 */
@Component
@RequiredArgsConstructor
public class AcademyPolicyMutationLock {
    /**
     * 현재 트랜잭션의 영속성 컨텍스트
     */
    private final EntityManager entityManager;

    /**
     * 현재 트랜잭션이 끝날 때까지 학원의 정책 변경 잠금 획득
     *
     * 트랜잭션 안에서 호출해야 함
     *
     * @param academyId 학원 ID
     */
    public void acquire(UUID academyId) {
        // advisory lock 키는 64비트 정수라 UUID의 두 절반을 XOR해 만듦
        var lockKey = academyId.getMostSignificantBits() ^ academyId.getLeastSignificantBits();
        entityManager.createNativeQuery("select pg_advisory_xact_lock(:lockKey)")
                .setParameter("lockKey", lockKey)
                .getSingleResult();
    }
}
