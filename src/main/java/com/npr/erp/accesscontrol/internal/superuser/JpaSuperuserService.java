package com.npr.erp.accesscontrol.internal.superuser;

import com.npr.erp.accesscontrol.AccessControlConflictException;
import com.npr.erp.accesscontrol.AuthorizationDecision;
import com.npr.erp.accesscontrol.AuthorizationPolicy;
import com.npr.erp.accesscontrol.AuthorizationReason;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.SuperuserAccess;
import com.npr.erp.accesscontrol.SuperuserManagement;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditEvent;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditRecorder;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 플랫폼 슈퍼유저 확인과 부여·회수 구현
 */
@Service
@RequiredArgsConstructor
public class JpaSuperuserService implements SuperuserAccess, SuperuserManagement {
    /**
     * 슈퍼유저 변경을 한 줄로 세우는 advisory lock 키
     */
    private static final long MUTATION_LOCK_KEY = 6719032401L;

    /**
     * 변경 사유의 최대 길이
     */
    private static final int MAX_REASON_LENGTH = 500;

    /**
     * 슈퍼유저 등록부
     */
    private final PlatformSuperuserRepository repository;

    /**
     * 감사 기록기
     */
    private final AuthorizationAuditRecorder auditRecorder;

    /**
     * 현재 트랜잭션의 영속성 컨텍스트
     */
    private final EntityManager entityManager;

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public AuthorizationDecision authorize(AuthorizationSubject subject, String requestId) {
        var allowed = repository.existsById(subject.accountId());
        var decision = allowed
                ? AuthorizationDecision.allow(AuthorizationReason.SUPERUSER_BYPASS, AuthorizationPolicy.SUPERUSER_V1)
                : AuthorizationDecision.deny(AuthorizationReason.SUPERUSER_REQUIRED, AuthorizationPolicy.SUPERUSER_V1);
        auditRecorder.recordIndependent(AuthorizationAuditEvent.builder()
                .eventType(allowed ? "SUPERUSER_ACCESS_ALLOWED" : "SUPERUSER_ACCESS_DENIED")
                .requestId(requestId)
                .actorAccountId(subject.accountId())
                .decision(allowed ? "ALLOW" : "DENY")
                .reasonCode(decision.reason().name())
                .build());
        return decision;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public boolean isSuperuser(AuthorizationSubject subject) {
        return repository.existsById(subject.accountId());
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public boolean grant(UUID targetAccountId, UUID actorAccountId, String reason) {
        var normalizedReason = normalizeReason(reason);
        acquireMutationLock();

        // 첫 슈퍼유저는 실행자 없이, 그다음부터는 기존 슈퍼유저만 부여할 수 있음
        if (repository.count() == 0) {
            if (actorAccountId != null) {
                throw new AccessControlConflictException(
                        "FIRST_SUPERUSER_REQUIRES_BOOTSTRAP", "첫 슈퍼유저는 실행자 없는 초기 구성 명령으로만 부여할 수 있습니다.");
            }
        } else {
            if (actorAccountId == null) {
                throw new AccessControlConflictException(
                        "SUPERUSER_ACTOR_REQUIRED", "슈퍼유저를 더 부여하려면 기존 슈퍼유저가 실행해야 합니다.");
            }
            requireSuperuser(actorAccountId);
        }
        if (repository.existsById(targetAccountId)) {
            return false;
        }

        repository.save(new PlatformSuperuserEntity(targetAccountId, actorAccountId, Instant.now()));
        auditRecorder.recordInCurrentTransaction(AuthorizationAuditEvent.builder()
                .eventType("SUPERUSER_GRANTED")
                .reasonCode("SUPERUSER_GRANTED")
                .actorAccountId(actorAccountId)
                .targetAccountId(targetAccountId)
                .afterState(Map.of("superuser", true))
                .details(Map.of("reason", normalizedReason))
                .build());
        return true;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public boolean revoke(UUID targetAccountId, UUID actorAccountId, String reason) {
        var normalizedReason = normalizeReason(reason);
        acquireMutationLock();
        requireSuperuser(actorAccountId);
        if (!repository.existsById(targetAccountId)) {
            return false;
        }

        repository.deleteById(targetAccountId);
        auditRecorder.recordInCurrentTransaction(AuthorizationAuditEvent.builder()
                .eventType("SUPERUSER_REVOKED")
                .reasonCode("SUPERUSER_REVOKED")
                .actorAccountId(actorAccountId)
                .targetAccountId(targetAccountId)
                .beforeState(Map.of("superuser", true))
                .afterState(Map.of("superuser", false))
                .details(Map.of("reason", normalizedReason))
                .build());
        return true;
    }

    /**
     * 현재 트랜잭션이 끝날 때까지 슈퍼유저 변경 잠금 획득
     */
    private void acquireMutationLock() {
        entityManager.createNativeQuery("select pg_advisory_xact_lock(:key)")
                .setParameter("key", MUTATION_LOCK_KEY)
                .getSingleResult();
    }

    /**
     * 실행자가 슈퍼유저인지 확인
     *
     * @param accountId 실행자 계정 ID
     * @throws AccessControlConflictException 슈퍼유저가 아닐 때
     */
    private void requireSuperuser(UUID accountId) {
        if (!repository.existsById(accountId)) {
            throw new AccessControlConflictException("SUPERUSER_REQUIRED", "플랫폼 슈퍼유저만 실행할 수 있는 운영 명령입니다.");
        }
    }

    /**
     * 변경 사유의 공백 제거와 길이 확인
     *
     * @param reason 입력한 사유
     * @return 공백을 지운 사유
     * @throws IllegalArgumentException 비었거나 500자를 넘을 때
     */
    private static String normalizeReason(String reason) {
        var trimmed = reason == null ? "" : reason.strip();
        if (trimmed.isEmpty() || trimmed.length() > MAX_REASON_LENGTH) {
            throw new IllegalArgumentException("슈퍼유저 변경 사유는 1자 이상 " + MAX_REASON_LENGTH + "자 이하여야 합니다.");
        }
        return trimmed;
    }
}
