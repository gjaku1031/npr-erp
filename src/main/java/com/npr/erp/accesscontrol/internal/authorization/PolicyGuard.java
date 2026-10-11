package com.npr.erp.accesscontrol.internal.authorization;

import com.npr.erp.accesscontrol.AuthorizationDeniedException;
import com.npr.erp.accesscontrol.AuthorizationRequest;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.AuthorizationTarget;
import com.npr.erp.accesscontrol.Authorizer;
import com.npr.erp.accesscontrol.PermissionDefinition;
import com.npr.erp.accesscontrol.ResourceContext;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;

/**
 * 권한 관리 기능 자신이 쓰는 인가 확인
 *
 * 소속·역할·ACL을 관리하는 기능도 일반 업무와 같은 {@link Authorizer}를 통과함
 */
@Component
@RequiredArgsConstructor
public class PolicyGuard {
    /**
     * 요청 추적 ID를 담는 로그 문맥 키
     */
    private static final String REQUEST_ID_KEY = "requestId";

    /**
     * 공개 인가 경계
     */
    private final Authorizer authorizer;

    /**
     * 학원 범위 권한 요구
     *
     * @param actor 요청 주체
     * @param academyId 학원 ID
     * @param permission 필요한 학원 권한
     * @throws AuthorizationDeniedException 거부되었을 때
     */
    public void requireAcademy(AuthorizationSubject actor, UUID academyId, PermissionDefinition permission) {
        authorizer.require(new AuthorizationRequest(
                actor, permission.key(), new AuthorizationTarget.Academy(academyId), MDC.get(REQUEST_ID_KEY)));
    }

    /**
     * 리소스 권한과 그 권한이 요구하는 ACL 작업 요구
     *
     * @param actor 요청 주체
     * @param context 리소스 문맥
     * @param permission 필요한 리소스 권한
     * @throws AuthorizationDeniedException 거부되었을 때
     */
    public void requireResource(AuthorizationSubject actor, ResourceContext context, PermissionDefinition permission) {
        authorizer.require(new AuthorizationRequest(
                actor,
                permission.key(),
                new AuthorizationTarget.Resource(context, permission.resourceAction()),
                MDC.get(REQUEST_ID_KEY)));
    }
}
