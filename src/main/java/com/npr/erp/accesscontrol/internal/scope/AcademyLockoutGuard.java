package com.npr.erp.accesscontrol.internal.scope;

import com.npr.erp.accesscontrol.AccessControlConflictException;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditEvent;
import com.npr.erp.accesscontrol.internal.audit.AuthorizationAuditRecorder;
import jakarta.persistence.EntityManager;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 마지막 ACL 관리자 보호
 *
 * 역할 비활성화, 권한 교체, 배정 회수, 소속 종료, ACL 회수로 학원 안에서 ACL을 관리할 수 있는 마지막 경로가
 * 사라지면 변경 전체를 롤백시킴
 */
@Component
@RequiredArgsConstructor
public class AcademyLockoutGuard {
    /**
     * 현재 트랜잭션의 영속성 컨텍스트
     */
    private final EntityManager entityManager;

    /**
     * 관리자 존재 확인 조회
     */
    private final LockoutGuardQuery query;

    /**
     * 감사 기록기
     */
    private final AuthorizationAuditRecorder auditRecorder;

    /**
     * 변경을 적용한 상태에서 ACL 관리자가 남아 있는지 확인
     *
     * @param scope 잠근 정책 행
     * @param actor 변경하는 주체
     * @param operation 감사 기록에 남길 변경 종류
     * @throws AccessControlConflictException 관리자가 한 명도 남지 않을 때
     */
    public void requireLocalAclManager(AcademyAccessScopeEntity scope, AuthorizationSubject actor, String operation) {
        // jOOQ 조회가 아직 DB에 쓰이지 않은 JPA 변경을 보도록 먼저 flush
        entityManager.flush();
        if (query.hasEffectiveRootAclManager(scope.getAcademyId(), scope.getStorageRootResourceId())) {
            return;
        }

        // 거부 사실은 변경이 롤백돼도 남도록 별도 트랜잭션으로 기록
        auditRecorder.recordIndependent(AuthorizationAuditEvent.builder()
                .eventType("LOCKOUT_CHANGE_DENIED")
                .actorAccountId(actor.accountId())
                .academyId(scope.getAcademyId())
                .reasonCode("LAST_ACL_MANAGER_REMOVAL")
                .policyVersion(scope.getPolicyVersion())
                .details(Map.of("operation", operation))
                .build());
        throw new AccessControlConflictException("LAST_ACL_MANAGER_REMOVAL", "학원의 마지막 ACL 관리자를 없앨 수 없습니다.");
    }
}
