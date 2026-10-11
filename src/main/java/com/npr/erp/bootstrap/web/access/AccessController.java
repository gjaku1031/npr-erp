package com.npr.erp.bootstrap.web.access;

import com.npr.erp.accesscontrol.AcademyCapabilityReader;
import com.npr.erp.accesscontrol.AccessControlConflictException;
import com.npr.erp.accesscontrol.AccessControlNotFoundException;
import com.npr.erp.accesscontrol.AuthorizationAuditReader;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.MembershipAdministration;
import com.npr.erp.accesscontrol.MembershipStatus;
import com.npr.erp.accesscontrol.MembershipView;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.PermissionCatalogReader;
import com.npr.erp.accesscontrol.PermissionDefinition;
import com.npr.erp.accesscontrol.PermissionKey;
import com.npr.erp.accesscontrol.RoleAdministration;
import com.npr.erp.accesscontrol.RoleAssignmentAdministration;
import com.npr.erp.accesscontrol.SuperuserAccess;
import com.npr.erp.bootstrap.web.AcademyContext;
import com.npr.erp.bootstrap.web.Guard;
import com.npr.erp.identity.AccountAdministration;
import com.npr.erp.identity.CreateAccountCommand;
import com.npr.erp.identity.SetAccountPasswordCommand;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * 권한 관리 화면: 직원, 역할, 감사 기록
 *
 * 변경 요청은 화면을 그릴 때의 정책 버전을 함께 보냄. 그 사이에 다른 사람이 정책을 바꿨으면 권한 모듈이 거부하고,
 * 화면은 새 상태를 다시 읽게 됨
 */
@Controller
@RequestMapping("/a/{academyId}/access")
@RequiredArgsConstructor
public class AccessController {
    /**
     * 감사 기록 화면에 보여 줄 건수
     */
    private static final int AUDIT_LIMIT = 200;

    /**
     * 권한 확인
     */
    private final Guard guard;

    /**
     * 소속 관리
     */
    private final MembershipAdministration membershipAdministration;

    /**
     * 역할 관리
     */
    private final RoleAdministration roleAdministration;

    /**
     * 역할 배정 관리
     */
    private final RoleAssignmentAdministration assignmentAdministration;

    /**
     * 권한 목록 조회
     */
    private final PermissionCatalogReader permissionCatalogReader;

    /**
     * 감사 기록 조회
     */
    private final AuthorizationAuditReader auditReader;

    /**
     * 계정 생성과 비밀번호 변경
     */
    private final AccountAdministration accountAdministration;

    /**
     * 슈퍼유저 여부 조회
     */
    private final SuperuserAccess superuserAccess;

    /**
     * 계정이 소속된 학원 조회
     */
    private final AcademyCapabilityReader capabilityReader;

    /**
     * 직원 목록
     *
     * @param context 요청 문맥
     * @param model 화면 모델
     * @return 직원 템플릿
     */
    @GetMapping("/members")
    public String members(AcademyContext context, Model model) {
        guard.require(context, PermissionCatalog.ACCESS_MEMBERSHIP_READ);
        var memberships = membershipAdministration.memberships(context.subject(), context.academyId());
        model.addAttribute("memberships", memberships.value());
        model.addAttribute("policyVersion", memberships.policyVersion());
        if (context.can(PermissionCatalog.ACCESS_ASSIGNMENT_READ)) {
            model.addAttribute(
                    "assignments",
                    assignmentAdministration.assignments(context.subject(), context.academyId()).value());
        }
        if (context.can(PermissionCatalog.ACCESS_ROLE_READ)) {
            model.addAttribute("roles", roleAdministration.roles(context.subject(), context.academyId()).value());
        }
        return "access/members";
    }

    /**
     * 새 직원 등록: 계정을 만들고 이 학원에 소속시킨 뒤 역할을 줌
     *
     * 계정 생성과 소속 등록은 서로 다른 모듈의 트랜잭션임. 소속 등록이 실패하면 계정만 남으며, 같은 아이디로 다시
     * 등록할 수 없다는 오류로 드러남
     *
     * @param context 요청 문맥
     * @param username 로그인 아이디
     * @param displayName 표시 이름
     * @param password 초기 비밀번호
     * @param roleIds 줄 역할
     * @param policyVersion 화면을 그릴 때의 정책 버전
     * @return 직원 화면
     */
    @PostMapping("/members")
    public String createMember(
            AcademyContext context,
            @RequestParam String username,
            @RequestParam String displayName,
            @RequestParam String password,
            @RequestParam(required = false) List<UUID> roleIds,
            @RequestParam long policyVersion) {
        guard.require(context, PermissionCatalog.ACCESS_MEMBERSHIP_MANAGE);
        var assignsRoles = roleIds != null && !roleIds.isEmpty();
        // 역할까지 주는 요청이면 계정을 만들기 전에 배정 권한을 먼저 확인. 거부될 요청이 계정을 남기지 않게 함
        if (assignsRoles) {
            guard.require(context, PermissionCatalog.ACCESS_ASSIGNMENT_MANAGE);
        }
        var account = accountAdministration.createAccount(new CreateAccountCommand(
                UUID.randomUUID(), username, displayName, password, "학원 직원 등록: " + context.academyId()));
        var membership = membershipAdministration.createMembership(
                context.subject(), context.academyId(), account.accountId(), policyVersion);
        if (assignsRoles) {
            assignmentAdministration.replaceMembershipRoles(
                    context.subject(),
                    context.academyId(),
                    membership.value().id(),
                    new HashSet<>(roleIds),
                    membership.policyVersion());
        }
        return "redirect:" + context.path("/access/members");
    }

    /**
     * 직원 한 명의 역할 교체, 소속 종료, 비밀번호 변경
     *
     * @param context 요청 문맥
     * @param membershipId 소속 ID
     * @param action 역할 교체(roles), 소속 종료(end), 비밀번호 변경(password)
     * @param roleIds 새 역할
     * @param password 새 비밀번호
     * @param policyVersion 화면을 그릴 때의 정책 버전
     * @return 직원 화면
     */
    @PostMapping("/members/{membershipId}")
    public String changeMember(
            AcademyContext context,
            @PathVariable UUID membershipId,
            @RequestParam String action,
            @RequestParam(required = false) List<UUID> roleIds,
            @RequestParam(required = false) String password,
            @RequestParam long policyVersion) {
        switch (action) {
            case "roles" -> {
                guard.require(context, PermissionCatalog.ACCESS_ASSIGNMENT_MANAGE);
                assignmentAdministration.replaceMembershipRoles(
                        context.subject(),
                        context.academyId(),
                        membershipId,
                        roleIds == null ? Set.of() : new HashSet<>(roleIds),
                        policyVersion);
            }
            case "end" -> {
                guard.require(context, PermissionCatalog.ACCESS_MEMBERSHIP_MANAGE);
                membershipAdministration.endMembership(
                        context.subject(), context.academyId(), membershipId, policyVersion);
            }
            case "password" -> resetPassword(context, membershipId, password);
            default -> throw new IllegalArgumentException("알 수 없는 동작: " + action);
        }
        return "redirect:" + context.path("/access/members");
    }

    /**
     * 역할과 역할별 권한
     *
     * @param context 요청 문맥
     * @param model 화면 모델
     * @return 역할 템플릿
     */
    @GetMapping("/roles")
    public String roles(AcademyContext context, Model model) {
        guard.require(context, PermissionCatalog.ACCESS_ROLE_READ);
        var roles = roleAdministration.roles(context.subject(), context.academyId());
        var catalog = permissionCatalogReader.permissionCatalog(context.subject(), context.academyId());

        // 권한을 묶음 이름별로 모음. 목록의 순서를 그대로 지킴
        var groups = new LinkedHashMap<String, List<PermissionDefinition>>();
        for (var permission : catalog.value()) {
            groups.computeIfAbsent(permission.group(), ignored -> new ArrayList<>()).add(permission);
        }
        model.addAttribute("roles", roles.value());
        model.addAttribute("policyVersion", roles.policyVersion());
        model.addAttribute("permissionGroups", groups);
        return "access/roles";
    }

    /**
     * 역할 생성
     *
     * @param context 요청 문맥
     * @param name 역할 이름
     * @param policyVersion 화면을 그릴 때의 정책 버전
     * @return 역할 화면
     */
    @PostMapping("/roles")
    public String createRole(AcademyContext context, @RequestParam String name, @RequestParam long policyVersion) {
        guard.require(context, PermissionCatalog.ACCESS_ROLE_MANAGE);
        var role = roleAdministration.createRole(context.subject(), context.academyId(), name, policyVersion);
        return "redirect:" + context.path("/access/roles") + "#role-" + role.value().id();
    }

    /**
     * 역할 한 개의 이름 변경, 권한 교체, 비활성화
     *
     * @param context 요청 문맥
     * @param roleId 역할 ID
     * @param action 이름 변경(rename), 권한 교체(permissions), 비활성화(deactivate)
     * @param name 새 이름
     * @param permissionKeys 새 권한 키
     * @param policyVersion 화면을 그릴 때의 정책 버전
     * @return 역할 화면
     */
    @PostMapping("/roles/{roleId}")
    public String changeRole(
            AcademyContext context,
            @PathVariable UUID roleId,
            @RequestParam String action,
            @RequestParam(required = false) String name,
            @RequestParam(required = false) List<String> permissionKeys,
            @RequestParam long policyVersion) {
        guard.require(context, PermissionCatalog.ACCESS_ROLE_MANAGE);
        var actor = context.subject();
        switch (action) {
            case "rename" -> roleAdministration.renameRole(actor, context.academyId(), roleId, name, policyVersion);
            case "permissions" -> roleAdministration.replaceRolePermissions(
                    actor,
                    context.academyId(),
                    roleId,
                    (permissionKeys == null ? List.<String>of() : permissionKeys)
                            .stream().map(PermissionKey::new).collect(Collectors.toSet()),
                    policyVersion);
            case "deactivate" -> roleAdministration.deactivateRole(actor, context.academyId(), roleId, policyVersion);
            default -> throw new IllegalArgumentException("알 수 없는 동작: " + action);
        }
        return "redirect:" + context.path("/access/roles") + "#role-" + roleId;
    }

    /**
     * 감사 기록
     *
     * @param context 요청 문맥
     * @param model 화면 모델
     * @return 감사 기록 템플릿
     */
    @GetMapping("/audit")
    public String audit(AcademyContext context, Model model) {
        guard.require(context, PermissionCatalog.ACCESS_AUDIT_READ);
        model.addAttribute("events", auditReader.recent(context.subject(), context.academyId(), AUDIT_LIMIT));
        return "access/audit";
    }

    /**
     * 이 학원 직원의 비밀번호 변경
     *
     * 계정은 학원에 속하지 않고 플랫폼 전체에서 하나임. 그래서 학원 관리자가 바꿀 수 있는 계정을 좁게 잡음: 이 학원에
     * 활성 소속이 있고, 다른 학원에는 활성 소속이 없으며, 플랫폼 슈퍼유저가 아닌 계정. 조건을 벗어난 계정은 슈퍼유저만
     * 바꿀 수 있음. 이 조건이 없으면 한 학원의 관리자가 다른 학원에서도 일하는 사람의 계정을 가로챌 수 있음
     *
     * @param context 요청 문맥
     * @param membershipId 소속 ID
     * @param password 새 비밀번호
     * @throws AccessControlNotFoundException 이 학원의 활성 소속이 아닐 때
     * @throws AccessControlConflictException 다른 학원에도 소속돼 있거나 슈퍼유저인 계정일 때
     */
    private void resetPassword(AcademyContext context, UUID membershipId, String password) {
        guard.require(context, PermissionCatalog.ACCESS_MEMBERSHIP_MANAGE);
        var target = membershipAdministration.memberships(context.subject(), context.academyId()).value().stream()
                .filter(membership -> membership.id().equals(membershipId))
                .filter(membership -> membership.status() == MembershipStatus.ACTIVE)
                .map(MembershipView::accountId)
                .findFirst()
                .orElseThrow(() -> new AccessControlNotFoundException("MEMBERSHIP_NOT_FOUND", "소속을 찾을 수 없습니다."));
        if (!context.capabilities().superuser()) {
            var subject = new AuthorizationSubject(target);
            var onlyHere = capabilityReader.accessibleAcademyIds(subject).equals(List.of(context.academyId()));
            if (!onlyHere || superuserAccess.isSuperuser(subject)) {
                throw new AccessControlConflictException(
                        "PASSWORD_RESET_OUT_OF_SCOPE", "다른 학원에도 소속돼 있거나 플랫폼 관리자인 계정의 비밀번호는 플랫폼 관리자만 바꿀 수 있습니다.");
            }
        }
        accountAdministration.setPassword(
                new SetAccountPasswordCommand(target, password, "학원 관리자가 변경: " + context.accountId()));
    }
}
