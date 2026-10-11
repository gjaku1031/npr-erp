package com.npr.erp.accesscontrol.internal.scope;

import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.PermissionDefinition;
import com.npr.erp.accesscontrol.internal.authorization.PolicyGuard;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 학원 범위 정책 변경의 공통 진입 절차
 */
@Component
@RequiredArgsConstructor
public class AcademyPolicyMutationGate {
    /**
     * 학원별 정책 변경 잠금
     */
    private final AcademyPolicyMutationLock mutationLock;

    /**
     * 인가 확인
     */
    private final PolicyGuard policyGuard;

    /**
     * 정책 행 잠금
     */
    private final AcademyScopeLocker scopeLocker;

    /**
     * 잠금 → 인가 → 정책 행 잠금 → 버전 확인을 순서대로 실행
     *
     * 잠금을 먼저 잡아야 인가에 쓴 정책과 변경할 정책이 같은 상태임이 보장됨
     *
     * @param actor 변경하는 주체
     * @param academyId 학원 ID
     * @param permission 필요한 학원 권한
     * @param expectedPolicyVersion 화면이 읽었던 정책 버전
     * @return 쓰기 잠금을 잡은 정책 행
     */
    public AcademyAccessScopeEntity open(
            AuthorizationSubject actor, UUID academyId, PermissionDefinition permission, long expectedPolicyVersion) {
        mutationLock.acquire(academyId);
        policyGuard.requireAcademy(actor, academyId, permission);
        var scope = scopeLocker.lock(academyId);
        scope.requireVersion(expectedPolicyVersion);
        return scope;
    }
}
