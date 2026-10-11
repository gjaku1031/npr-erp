package com.npr.erp.integration.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.flash;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.MembershipAdministration;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.ResourceAclManagement;
import com.npr.erp.accesscontrol.ResourceAclSubject;
import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.accesscontrol.ResourceContext;
import com.npr.erp.accesscontrol.ResourceType;
import com.npr.erp.accesscontrol.RoleAdministration;
import com.npr.erp.accesscontrol.RoleAssignmentAdministration;
import com.npr.erp.bootstrap.security.AccountPrincipal;
import com.npr.erp.identity.AccountAdministration;
import com.npr.erp.identity.AccountDirectory;
import com.npr.erp.identity.AccountStatus;
import com.npr.erp.identity.CreateAccountCommand;
import com.npr.erp.integration.IntegrationTest;
import com.npr.erp.storage.StorageCatalog;
import com.npr.erp.storage.StorageNodeView;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * 화면 요청이 권한 엔진을 거치는지 검사
 *
 * 시연 데이터의 역할 세 개로 같은 주소를 요청해, 역할 권한과 폴더 ACL이 함께 적용되는지 확인함
 */
@IntegrationTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {"npr.demo.seed=true", "npr.worklog.today=2026-10-12"})
class WebAccessIntegrationTest {
    /**
     * 시연 학원의 고정 ID
     */
    private static final UUID ACADEMY_ID = UUID.nameUUIDFromBytes("npr-demo-academy".getBytes(StandardCharsets.UTF_8));

    /**
     * 시연 학원의 경로
     */
    private static final String ACADEMY = "/a/" + ACADEMY_ID;

    /**
     * 요청 실행
     */
    @Autowired
    private MockMvc mvc;

    /**
     * 계정 조회
     */
    @Autowired
    private AccountDirectory accountDirectory;

    /**
     * 자료실 조회
     */
    @Autowired
    private StorageCatalog storageCatalog;

    /**
     * 계정 생성
     */
    @Autowired
    private AccountAdministration accountAdministration;

    /**
     * 소속 관리
     */
    @Autowired
    private MembershipAdministration membershipAdministration;

    /**
     * 역할 관리
     */
    @Autowired
    private RoleAdministration roleAdministration;

    /**
     * 역할 배정 관리
     */
    @Autowired
    private RoleAssignmentAdministration assignmentAdministration;

    /**
     * 폴더 허용 목록 관리
     */
    @Autowired
    private ResourceAclManagement aclManagement;

    /**
     * 로그인하지 않으면 로그인 화면으로 보내는지 확인
     */
    @Test
    void anonymousIsSentToLogin() throws Exception {
        var location = mvc.perform(get(ACADEMY))
                .andExpect(status().is3xxRedirection())
                .andReturn()
                .getResponse()
                .getRedirectedUrl();

        assertThat(location).endsWith("/login");
    }

    /**
     * 소속이 없는 학원의 주소는 열리지 않는지 확인
     */
    @Test
    void unknownAcademyIsNotFound() throws Exception {
        mvc.perform(get("/a/" + UUID.randomUUID()).with(login("teacher1"))).andExpect(status().isNotFound());
    }

    /**
     * 같은 주소가 가진 권한에 따라 열리거나 거부되는지 확인
     */
    @Test
    void pagesFollowRolePermissions() throws Exception {
        mvc.perform(get(ACADEMY + "/journals").with(login("lead"))).andExpect(status().isOk());
        mvc.perform(get(ACADEMY + "/journals").with(login("teacher1"))).andExpect(status().isForbidden());
        mvc.perform(get(ACADEMY + "/access/roles").with(login("teacher1"))).andExpect(status().isForbidden());
        mvc.perform(get(ACADEMY + "/tasks").with(login("teacher1"))).andExpect(status().isOk());
        mvc.perform(get(ACADEMY + "/tasks").with(login("other1"))).andExpect(status().isForbidden());
        mvc.perform(get(ACADEMY + "/classes").with(login("other1"))).andExpect(status().isOk());
        // 팀장은 업무를 받는 쪽이 아니어서 일일보고 작성 화면이 없음
        mvc.perform(get(ACADEMY + "/reports").with(login("lead"))).andExpect(status().isForbidden());
    }

    /**
     * 폴더 목록이 ACL로 걸러지고, 허용되지 않은 폴더는 주소를 직접 넣어도 열리지 않는지 확인
     */
    @Test
    void storageListingIsFilteredByAcl() throws Exception {
        var root = storageCatalog.findRoot(ACADEMY_ID).orElseThrow();
        var operations = child(root.id(), "운영 문서");

        var forTeacher = mvc.perform(get(ACADEMY + "/storage/f/" + root.id()).with(login("teacher1")))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        assertThat(forTeacher).contains("교재", "시험지").doesNotContain("운영 문서");
        assertThat(forTeacher).contains("접근 권한이 없는 항목 1개");

        var forLead = mvc.perform(get(ACADEMY + "/storage/f/" + root.id()).with(login("lead")))
                .andReturn()
                .getResponse()
                .getContentAsString();
        assertThat(forLead).contains("운영 문서");
        mvc.perform(get(ACADEMY + "/storage/f/" + operations.id()).with(login("teacher1")))
                .andExpect(status().isForbidden());
    }

    /**
     * 올리기 권한이 있는 역할도 쓰기 ACL이 없는 폴더에는 올릴 수 없는지 확인
     */
    @Test
    void uploadNeedsBothPermissionAndAcl() throws Exception {
        var root = storageCatalog.findRoot(ACADEMY_ID).orElseThrow();
        var file = new MockMultipartFile(
                "file", "web-test-" + UUID.randomUUID() + ".txt", "text/plain", "본문".getBytes(StandardCharsets.UTF_8));

        // 시험지: 강사 역할에 목록·읽기 ACL만 있음
        mvc.perform(multipart(ACADEMY + "/storage/f/" + child(root.id(), "시험지").id() + "/upload")
                        .file(file)
                        .with(login("teacher1"))
                        .with(csrf()))
                .andExpect(status().isForbidden());
        // 교재: 강사 역할에 쓰기 ACL이 있음
        mvc.perform(multipart(ACADEMY + "/storage/f/" + child(root.id(), "교재").id() + "/upload")
                        .file(file)
                        .with(login("teacher1"))
                        .with(csrf()))
                .andExpect(status().is3xxRedirection());
        // 교재: 다른 팀 역할은 쓰기 ACL도 올리기 권한도 없음
        mvc.perform(multipart(ACADEMY + "/storage/f/" + child(root.id(), "교재").id() + "/upload")
                        .file(file)
                        .with(login("other1"))
                        .with(csrf()))
                .andExpect(status().isForbidden());
    }

    /**
     * CSRF 토큰이 없는 변경 요청은 거부되는지 확인
     */
    @Test
    void stateChangeNeedsCsrfToken() throws Exception {
        mvc.perform(post(ACADEMY + "/notices").param("body", "토큰 없는 요청").with(login("lead")))
                .andExpect(status().isForbidden());
    }

    /**
     * 종료된 소속의 계정은 학원 관리자가 비밀번호를 바꿀 수 없는지 확인
     *
     * 계정은 플랫폼 전체에서 하나라, 이 학원을 떠난 사람의 계정을 바꿀 수 있으면 다른 학원의 자격을 가로챌 수 있음
     */
    @Test
    void passwordResetIsLimitedToActiveMembers() throws Exception {
        var lead = subject("lead");
        var target = accountDirectory.findCredentialsByUsername("teacher4").orElseThrow();
        var memberships = membershipAdministration.memberships(lead, ACADEMY_ID);
        var membership = memberships.value().stream()
                .filter(candidate -> candidate.accountId().equals(target.getAccountId()))
                .findFirst()
                .orElseThrow();
        membershipAdministration.endMembership(lead, ACADEMY_ID, membership.id(), memberships.policyVersion());

        mvc.perform(post(ACADEMY + "/access/members/" + membership.id())
                        .param("action", "password")
                        .param("password", "changed-by-admin")
                        .param("policyVersion", "1")
                        .with(login("lead"))
                        .with(csrf()))
                .andExpect(status().is3xxRedirection())
                .andExpect(flash().attributeExists("error"));

        assertThat(accountDirectory.findCredentialsByUsername("teacher4").orElseThrow().getPasswordHash())
                .isEqualTo(target.getPasswordHash());
    }

    /**
     * 허용 목록은 폴더에만 걸 수 있고 파일에는 걸 수 없는지 확인
     */
    @Test
    void aclCanBeGrantedOnFoldersOnly() throws Exception {
        var root = storageCatalog.findRoot(ACADEMY_ID).orElseThrow();
        var file = child(child(root.id(), "운영 문서").id(), "근무 규정.txt");

        mvc.perform(post(ACADEMY + "/storage/f/" + file.id() + "/acl")
                        .param("subject", "account:" + subject("lead").accountId())
                        .param("action", "READ")
                        .param("policyVersion", "1")
                        .with(login("lead"))
                        .with(csrf()))
                .andExpect(status().is3xxRedirection())
                .andExpect(flash().attributeExists("error"));
    }

    /**
     * 쓰기 허용만 가진 사람이 읽을 수 없는 항목을 다른 폴더로 옮겨 읽기를 얻을 수 없는지 확인
     *
     * 옮긴 항목은 옮겨 간 폴더의 허용을 물려받으므로, 옮기려면 원본 전체를 이미 읽을 수 있어야 함
     */
    @Test
    void movingNeedsReadOnWholeSubtree() throws Exception {
        var lead = subject("lead");
        var root = storageCatalog.findRoot(ACADEMY_ID).orElseThrow();
        var operations = child(root.id(), "운영 문서");
        var textbooks = child(root.id(), "교재");
        var secret = child(operations.id(), "근무 규정.txt");

        // 고칠 권한과 만들 권한은 있지만 읽기 권한과 읽기 허용은 없는 역할을 만들어 두 폴더에 쓰기만 허용
        var username = "mover-" + UUID.randomUUID();
        var account = accountAdministration.createAccount(
                new CreateAccountCommand(UUID.randomUUID(), username, "이동 시험", "test-password", "통합 테스트"));
        var role = roleAdministration.createRole(
                lead, ACADEMY_ID, "이동 시험 " + username, roleAdministration.roles(lead, ACADEMY_ID).policyVersion());
        var version = roleAdministration
                .replaceRolePermissions(
                        lead,
                        ACADEMY_ID,
                        role.value().id(),
                        Set.of(PermissionCatalog.STORAGE_NODE_MODIFY.key(), PermissionCatalog.STORAGE_FOLDER_CREATE.key()),
                        role.policyVersion())
                .policyVersion();
        var membership = membershipAdministration.createMembership(lead, ACADEMY_ID, account.accountId(), version);
        version = assignmentAdministration
                .replaceMembershipRoles(
                        lead, ACADEMY_ID, membership.value().id(), Set.of(role.value().id()), membership.policyVersion())
                .policyVersion();
        for (var folder : List.of(operations, textbooks)) {
            version = aclManagement
                    .grant(
                            lead,
                            new ResourceContext(ACADEMY_ID, ResourceType.STORAGE_NODE, folder.id(), List.of(root.id())),
                            new ResourceAclSubject.Role(role.value().id()),
                            ResourceAction.WRITE,
                            true,
                            version)
                    .policyVersion();
        }

        mvc.perform(post(ACADEMY + "/storage/n/" + secret.id())
                        .param("action", "move")
                        .param("destinationId", textbooks.id().toString())
                        .with(login(username))
                        .with(csrf()))
                .andExpect(status().isForbidden());
        assertThat(storageCatalog.locate(ACADEMY_ID, secret.id()).node().parentId()).isEqualTo(operations.id());
    }

    /**
     * 시연 계정의 인가 주체
     *
     * @param username 로그인 아이디
     * @return 그 계정을 가리키는 주체
     */
    private AuthorizationSubject subject(String username) {
        return new AuthorizationSubject(
                accountDirectory.findCredentialsByUsername(username).orElseThrow().getAccountId());
    }

    /**
     * 시연 계정으로 로그인한 요청 만들기
     *
     * @param username 로그인 아이디
     * @return 요청에 로그인 정보를 넣는 처리기
     */
    private RequestPostProcessor login(String username) {
        var credentials = accountDirectory.findCredentialsByUsername(username).orElseThrow();
        return user(new AccountPrincipal(
                credentials.getAccountId(),
                credentials.getUsername(),
                credentials.getPasswordHash(),
                credentials.getStatus() == AccountStatus.ACTIVE));
    }

    /**
     * 폴더 바로 아래에서 이름으로 항목 찾기
     *
     * @param folderId 폴더 ID
     * @param name 찾을 이름
     * @return 하위 항목
     */
    private StorageNodeView child(UUID folderId, String name) {
        return storageCatalog.folder(ACADEMY_ID, folderId).children().stream()
                .filter(node -> node.name().equals(name))
                .findFirst()
                .orElseThrow();
    }
}
