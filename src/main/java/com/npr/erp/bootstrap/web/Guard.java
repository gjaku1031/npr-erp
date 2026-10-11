package com.npr.erp.bootstrap.web;

import com.npr.erp.accesscontrol.AcademyCapabilityReader;
import com.npr.erp.accesscontrol.AuthorizationDeniedException;
import com.npr.erp.accesscontrol.AuthorizationRequest;
import com.npr.erp.accesscontrol.AuthorizationTarget;
import com.npr.erp.accesscontrol.Authorizer;
import com.npr.erp.accesscontrol.PermissionDefinition;
import com.npr.erp.accesscontrol.ResourceContext;
import java.util.Collection;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;

/**
 * 화면 요청이 권한 엔진을 거치는 한 곳
 *
 * 컨트롤러는 모듈의 공개 계약을 부르기 전에 여기서 허용 여부를 확인함. 권한 판단 규칙은 여기에 두지 않고 요청을
 * 만들어 엔진에 넘기기만 함
 */
@Component
@RequiredArgsConstructor
public class Guard {
    /**
     * 권한 엔진
     */
    private final Authorizer authorizer;

    /**
     * 권한을 가진 계정 조회
     */
    private final AcademyCapabilityReader capabilityReader;

    /**
     * 학원 범위의 권한 확인
     *
     * @param context 요청 문맥
     * @param permission 필요한 권한
     * @throws AuthorizationDeniedException 허용되지 않을 때
     */
    public void require(AcademyContext context, PermissionDefinition permission) {
        authorizer.require(new AuthorizationRequest(
                context.subject(), permission.key(), new AuthorizationTarget.Academy(context.academyId()), requestId()));
    }

    /**
     * 여러 권한 가운데 하나라도 있는지 확인
     *
     * 가진 권한이 있으면 그 권한으로, 하나도 없으면 첫 권한으로 엔진에 물어 거부 기록이 남게 함
     *
     * @param context 요청 문맥
     * @param permissions 하나라도 있으면 되는 권한들
     * @throws AuthorizationDeniedException 하나도 허용되지 않을 때
     */
    public void requireAny(AcademyContext context, PermissionDefinition... permissions) {
        for (var permission : permissions) {
            if (context.can(permission)) {
                require(context, permission);
                return;
            }
        }
        require(context, permissions[0]);
    }

    /**
     * 리소스 하나에 대한 권한 확인
     *
     * @param context 요청 문맥
     * @param permission 필요한 권한. 리소스 종류와 작업이 정해져 있음
     * @param resource 대상 리소스와 그 조상
     * @throws AuthorizationDeniedException 허용되지 않을 때
     */
    public void require(AcademyContext context, PermissionDefinition permission, ResourceContext resource) {
        authorizer.require(new AuthorizationRequest(
                context.subject(),
                permission.key(),
                new AuthorizationTarget.Resource(resource, permission.resourceAction()),
                requestId()));
    }

    /**
     * 리소스 하나에 대한 권한이 있는지 확인. 버튼을 보여 줄지 정할 때 씀
     *
     * @param context 요청 문맥
     * @param permission 확인할 권한
     * @param resource 대상 리소스와 그 조상
     * @return 허용되면 true
     */
    public boolean allows(AcademyContext context, PermissionDefinition permission, ResourceContext resource) {
        return !permitted(context, permission, Set.of(resource)).isEmpty();
    }

    /**
     * 여러 리소스 가운데 허용된 것만 고름
     *
     * 역할에 그 권한이 아예 없으면 엔진에 묻지 않고 빈 결과를 돌려줌. 버튼을 보여 줄지 정하려고 물은 것이 거부
     * 기록으로 쌓이지 않게 함. 실제 요청은 {@link #require}가 엔진에 다시 묻고, 거부되면 기록됨
     *
     * @param context 요청 문맥
     * @param permission 확인할 권한
     * @param resources 후보 리소스
     * @return 허용된 리소스의 ID
     */
    public Set<UUID> permitted(
            AcademyContext context, PermissionDefinition permission, Collection<ResourceContext> resources) {
        if (resources.isEmpty() || !context.can(permission)) {
            return Set.of();
        }
        return authorizer.filterPermitted(
                context.subject(), permission.key(), permission.resourceAction(), resources, requestId());
    }

    /**
     * 이 학원에서 권한을 가진 계정
     *
     * @param context 요청 문맥
     * @param permission 권한
     * @return 계정 ID 집합
     */
    public Set<UUID> holders(AcademyContext context, PermissionDefinition permission) {
        return capabilityReader.accountIdsWith(context.academyId(), permission);
    }

    /**
     * 지금 요청의 식별자
     *
     * @return 요청 식별자. 요청 밖이면 null
     */
    private static String requestId() {
        return MDC.get(RequestIdFilter.MDC_KEY);
    }
}
