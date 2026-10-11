package com.npr.erp.accesscontrol.internal.authorization;

import com.npr.erp.accesscontrol.AcademyPolicyView;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.PermissionCatalogReader;
import com.npr.erp.accesscontrol.PermissionDefinition;
import com.npr.erp.accesscontrol.internal.scope.AcademyScopeLocker;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link PermissionCatalogReader} 구현
 */
@Service
@RequiredArgsConstructor
public class DefaultPermissionCatalogReader implements PermissionCatalogReader {
    /**
     * 인가 확인
     */
    private final PolicyGuard policyGuard;

    /**
     * 학원 정책 조회
     */
    private final AcademyScopeLocker scopeLocker;

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public AcademyPolicyView<List<PermissionDefinition>> permissionCatalog(AuthorizationSubject actor, UUID academyId) {
        policyGuard.requireAcademy(actor, academyId, PermissionCatalog.ACCESS_ROLE_READ);
        var scope = scopeLocker.get(academyId);
        return new AcademyPolicyView<>(academyId, scope.getPolicyVersion(), PermissionCatalog.definitions());
    }
}
