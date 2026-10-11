package com.npr.erp.integration.accesscontrol;

import static com.npr.generated.jooq.Tables.PLATFORM_SUPERUSER;

import com.npr.erp.accesscontrol.AcademyAccessInitializer;
import com.npr.erp.accesscontrol.AcademyCapabilityReader;
import com.npr.erp.accesscontrol.AuthorizationDecision;
import com.npr.erp.accesscontrol.AuthorizationRequest;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.AuthorizationTarget;
import com.npr.erp.accesscontrol.Authorizer;
import com.npr.erp.accesscontrol.InitializeAcademyAccessCommand;
import com.npr.erp.accesscontrol.MembershipAdministration;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.PermissionDefinition;
import com.npr.erp.accesscontrol.PermissionKey;
import com.npr.erp.accesscontrol.ResourceAclLifecycle;
import com.npr.erp.accesscontrol.ResourceAclManagement;
import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.accesscontrol.ResourceContext;
import com.npr.erp.accesscontrol.ResourceType;
import com.npr.erp.accesscontrol.RoleAdministration;
import com.npr.erp.accesscontrol.RoleAssignmentAdministration;
import com.npr.erp.accesscontrol.SuperuserManagement;
import com.npr.erp.identity.AccountAdministration;
import com.npr.erp.identity.CreateAccountCommand;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.jooq.DSLContext;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 권한 통합 테스트의 공통 준비
 */
abstract class AccessControlIntegrationSupport {
    /**
     * 테스트용 슈퍼유저의 고정 계정 ID
     */
    private static final UUID SUPERUSER_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");

    /**
     * 계정 관리
     */
    @Autowired
    protected AccountAdministration accountAdministration;

    /**
     * 슈퍼유저 관리
     */
    @Autowired
    protected SuperuserManagement superuserManagement;

    /**
     * 학원 권한 초기화
     */
    @Autowired
    protected AcademyAccessInitializer initializer;

    /**
     * 소속 관리
     */
    @Autowired
    protected MembershipAdministration membershipAdministration;

    /**
     * 역할 관리
     */
    @Autowired
    protected RoleAdministration roleAdministration;

    /**
     * 역할 배정 관리
     */
    @Autowired
    protected RoleAssignmentAdministration roleAssignmentAdministration;

    /**
     * ACL 관리
     */
    @Autowired
    protected ResourceAclManagement aclManagement;

    /**
     * ACL 생명주기 정리
     */
    @Autowired
    protected ResourceAclLifecycle aclLifecycle;

    /**
     * 기능 권한 요약 조회
     */
    @Autowired
    protected AcademyCapabilityReader capabilityReader;

    /**
     * 인가 경계
     */
    @Autowired
    protected Authorizer authorizer;

    /**
     * 검증용 직접 조회
     */
    @Autowired
    protected DSLContext dsl;

    /**
     * 전체 권한을 가진 관리자 한 명이 있는 새 학원 준비
     *
     * 테스트마다 새 학원 ID를 써서 서로의 데이터에 영향을 주지 않음
     *
     * @param label 첫 역할 이름에 넣을 구분 문구
     * @return 학원과 첫 관리자의 식별자. 정책 버전은 1
     */
    protected AcademySetup initializedAcademy(String label) {
        var adminAccountId = createAccount("academy-admin-" + UUID.randomUUID());
        var academyId = UUID.randomUUID();
        var rootResourceId = UUID.randomUUID();
        var result = initializer.initialize(new InitializeAcademyAccessCommand(
                new AuthorizationSubject(superuserAccountId()),
                academyId,
                rootResourceId,
                adminAccountId,
                label + " 관리자",
                allPermissions(),
                UUID.randomUUID().toString()));
        return new AcademySetup(academyId, rootResourceId, adminAccountId, result.membershipId(), result.roleId());
    }

    /**
     * 테스트용 슈퍼유저를 보장하고 그 계정 ID 반환
     *
     * 다른 테스트가 슈퍼유저를 지웠거나 바꿨어도 다시 맞춤
     *
     * @return 슈퍼유저 계정 ID
     */
    protected UUID superuserAccountId() {
        var accountId = createAccount("integration-superuser", SUPERUSER_ID);
        var existing = dsl.select(PLATFORM_SUPERUSER.ACCOUNT_ID)
                .from(PLATFORM_SUPERUSER)
                .orderBy(PLATFORM_SUPERUSER.GRANTED_AT)
                .limit(1)
                .fetchOne(PLATFORM_SUPERUSER.ACCOUNT_ID);
        if (existing == null) {
            superuserManagement.grant(accountId, null, "통합 테스트 첫 슈퍼유저");
        } else if (!existing.equals(accountId)) {
            superuserManagement.grant(accountId, existing, "통합 테스트 슈퍼유저 통일");
        }
        return accountId;
    }

    /**
     * 임의 ID의 계정 생성
     *
     * @param username 로그인 아이디
     * @return 계정 ID
     */
    protected UUID createAccount(String username) {
        return createAccount(username, UUID.randomUUID());
    }

    /**
     * 지정한 ID의 계정 생성
     *
     * @param username 로그인 아이디
     * @param accountId 계정 ID
     * @return 계정 ID
     */
    protected UUID createAccount(String username, UUID accountId) {
        return accountAdministration
                .createAccount(new CreateAccountCommand(accountId, username, username, "test-password", "통합 테스트 계정"))
                .accountId();
    }

    /**
     * 파일 읽기 인가 요청
     *
     * @param accountId 요청 계정
     * @param context 파일 문맥
     * @return 판단 결과
     */
    protected AuthorizationDecision authorizeFileRead(UUID accountId, ResourceContext context) {
        return authorizer.authorize(new AuthorizationRequest(
                new AuthorizationSubject(accountId),
                PermissionCatalog.STORAGE_FILE_READ.key(),
                new AuthorizationTarget.Resource(context, ResourceAction.READ)));
    }

    /**
     * 저장소 노드 문맥 생성
     *
     * @param setup 학원
     * @param resourceId 리소스 ID
     * @param ancestors 루트부터 직접 부모까지의 조상
     * @return 리소스 문맥
     */
    protected static ResourceContext node(AcademySetup setup, UUID resourceId, List<UUID> ancestors) {
        return new ResourceContext(setup.academyId(), ResourceType.STORAGE_NODE, resourceId, ancestors);
    }

    /**
     * 학원 루트 폴더의 문맥 생성
     *
     * @param setup 학원
     * @return 조상이 없는 루트 문맥
     */
    protected static ResourceContext root(AcademySetup setup) {
        return node(setup, setup.rootResourceId(), List.of());
    }

    /**
     * 루트 바로 아래에 있는 임의 리소스의 문맥 생성
     *
     * @param setup 학원
     * @return 루트를 부모로 둔 새 리소스 문맥
     */
    protected static ResourceContext childOfRoot(AcademySetup setup) {
        return node(setup, UUID.randomUUID(), List.of(setup.rootResourceId()));
    }

    /**
     * 코드에 정의된 전체 권한 키
     *
     * @return 바꿀 수 있는 새 집합
     */
    protected static Set<PermissionKey> allPermissions() {
        var keys = new HashSet<PermissionKey>();
        for (var definition : PermissionCatalog.definitions()) {
            keys.add(definition.key());
        }
        return keys;
    }

    /**
     * 전체 권한에서 하나를 뺀 집합
     *
     * @param excluded 뺄 권한
     * @return 나머지 권한 키
     */
    protected static Set<PermissionKey> allPermissionsExcept(PermissionDefinition excluded) {
        var keys = allPermissions();
        keys.remove(excluded.key());
        return keys;
    }

    /**
     * 준비한 학원의 식별자
     *
     * @param academyId 학원 ID
     * @param rootResourceId 저장소 루트 폴더 ID
     * @param adminAccountId 첫 관리자 계정 ID
     * @param membershipId 첫 관리자의 소속 ID
     * @param roleId 첫 관리자 역할 ID
     */
    protected record AcademySetup(
            UUID academyId, UUID rootResourceId, UUID adminAccountId, UUID membershipId, UUID roleId) {
    }
}
