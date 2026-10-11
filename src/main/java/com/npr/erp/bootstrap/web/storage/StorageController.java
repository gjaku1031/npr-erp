package com.npr.erp.bootstrap.web.storage;

import com.npr.erp.accesscontrol.AcademyRoleStatus;
import com.npr.erp.accesscontrol.MembershipAdministration;
import com.npr.erp.accesscontrol.MembershipStatus;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.PermissionDefinition;
import com.npr.erp.accesscontrol.ResourceAclLifecycle;
import com.npr.erp.accesscontrol.ResourceAclManagement;
import com.npr.erp.accesscontrol.ResourceAclSubject;
import com.npr.erp.accesscontrol.ResourceAclView;
import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.accesscontrol.ResourceContext;
import com.npr.erp.accesscontrol.ResourceType;
import com.npr.erp.accesscontrol.RoleAdministration;
import com.npr.erp.bootstrap.web.AcademyContext;
import com.npr.erp.bootstrap.web.Guard;
import com.npr.erp.bootstrap.web.Names;
import com.npr.erp.bootstrap.web.Redirects;
import com.npr.erp.storage.StorageCatalog;
import com.npr.erp.storage.StorageMutation;
import com.npr.erp.storage.StorageNodeLocation;
import com.npr.erp.storage.StorageNodeView;
import com.npr.erp.storage.StorageNotFoundException;
import com.npr.erp.storage.StorageTransfer;
import com.npr.erp.storage.StorageValidationException;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.multipart.MultipartFile;

/**
 * 자료실 화면
 *
 * 자료실 모듈은 누가 요청했는지 따지지 않고 트리와 파일만 다룸. 그래서 모든 요청은 여기서 대상 노드와 그 조상을
 * 권한 엔진에 넘겨 허용 여부를 확인한 뒤에 자료실 모듈을 부름. 목록은 엔진에 한 번에 물어 허용된 것만 남김
 */
@Controller
@RequestMapping("/a/{academyId}/storage")
@RequiredArgsConstructor
public class StorageController {
    /**
     * 최근 작업 화면에 보여 줄 건수
     */
    private static final int OPERATION_LIMIT = 50;

    /**
     * 권한 확인
     */
    private final Guard guard;

    /**
     * 자료실 조회
     */
    private final StorageCatalog catalog;

    /**
     * 자료실 트리 변경
     */
    private final StorageMutation mutation;

    /**
     * 파일 전송
     */
    private final StorageTransfer transfer;

    /**
     * 폴더 ACL 관리
     */
    private final ResourceAclManagement aclManagement;

    /**
     * 지운 노드의 ACL 정리
     */
    private final ResourceAclLifecycle aclLifecycle;

    /**
     * 역할 조회. ACL을 줄 대상을 고르는 데 씀
     */
    private final RoleAdministration roleAdministration;

    /**
     * 소속 조회. ACL을 줄 대상을 고르는 데 씀
     */
    private final MembershipAdministration membershipAdministration;

    /**
     * 계정 이름 조회
     */
    private final Names names;

    /**
     * 자료실 첫 화면: 루트 폴더로 보냄
     *
     * @param context 요청 문맥
     * @return 루트 폴더 화면
     */
    @GetMapping
    public String root(AcademyContext context) {
        var root = catalog.findRoot(context.academyId())
                .orElseThrow(() -> new StorageNotFoundException("STORAGE_ROOT_NOT_FOUND", "자료실이 아직 만들어지지 않았습니다."));
        return "redirect:" + context.path("/storage/f/" + root.id());
    }

    /**
     * 폴더 화면
     *
     * @param context 요청 문맥
     * @param folderId 폴더 ID
     * @param model 화면 모델
     * @return 폴더 템플릿
     */
    @GetMapping("/f/{folderId}")
    public String folder(AcademyContext context, @PathVariable UUID folderId, Model model) {
        var folder = catalog.folder(context.academyId(), folderId);
        var resource = resourceOf(folder.location());
        guard.require(context, PermissionCatalog.STORAGE_FOLDER_LIST, resource);

        // 하위 항목은 항목마다 조상을 붙여 엔진에 한 번에 묻고, 허용된 것만 보여 줌
        var childAncestors = new ArrayList<>(folder.location().ancestorIds());
        childAncestors.add(folderId);
        var childResources = new HashMap<UUID, ResourceContext>();
        for (var child : folder.children()) {
            childResources.put(
                    child.id(),
                    new ResourceContext(context.academyId(), ResourceType.STORAGE_NODE, child.id(), childAncestors));
        }
        var listable = guard.permitted(context, PermissionCatalog.STORAGE_FOLDER_LIST, childResources.values());
        model.addAttribute("folder", folder);
        model.addAttribute("children", folder.children().stream()
                .filter(child -> listable.contains(child.id()))
                .toList());
        model.addAttribute("readable", guard.permitted(context, PermissionCatalog.STORAGE_FILE_READ, childResources.values()));
        model.addAttribute(
                "modifiable", guard.permitted(context, PermissionCatalog.STORAGE_NODE_MODIFY, childResources.values()));
        model.addAttribute("hiddenCount", folder.children().size() - listable.size());
        model.addAttribute("canCreateFolder", guard.allows(context, PermissionCatalog.STORAGE_FOLDER_CREATE, resource));
        model.addAttribute("canUpload", guard.allows(context, PermissionCatalog.STORAGE_FILE_WRITE, resource));

        // ACL은 읽을 수 있는 사람에게만 보이고, 고칠 수 있는 사람에게만 폼이 열림
        if (guard.allows(context, PermissionCatalog.STORAGE_ACL_READ, resource)) {
            var acls = aclManagement.list(context.subject(), resource);
            var roleNames = populateAclSubjects(context, model);
            model.addAttribute("acls", acls.value().stream().map(acl -> aclRow(acl, roleNames)).toList());
            model.addAttribute("aclPolicyVersion", acls.policyVersion());
            model.addAttribute("canManageAcl", guard.allows(context, PermissionCatalog.STORAGE_ACL_MANAGE, resource));
            model.addAttribute("aclActions", ResourceAction.values());
        }
        return "storage/folder";
    }

    /**
     * 폴더 생성
     *
     * @param context 요청 문맥
     * @param folderId 부모 폴더 ID
     * @param name 새 폴더 이름
     * @return 부모 폴더 화면
     */
    @PostMapping("/f/{folderId}/folders")
    public String createFolder(AcademyContext context, @PathVariable UUID folderId, @RequestParam String name) {
        require(context, PermissionCatalog.STORAGE_FOLDER_CREATE, folderId);
        mutation.createFolder(context.academyId(), context.accountId(), folderId, name);
        return "redirect:" + context.path("/storage/f/" + folderId);
    }

    /**
     * 파일 올리기
     *
     * @param context 요청 문맥
     * @param folderId 올릴 폴더 ID
     * @param file 올린 파일
     * @return 폴더 화면
     * @throws IOException 올린 파일을 읽지 못했을 때
     */
    @PostMapping("/f/{folderId}/upload")
    public String upload(AcademyContext context, @PathVariable UUID folderId, @RequestParam MultipartFile file)
            throws IOException {
        require(context, PermissionCatalog.STORAGE_FILE_WRITE, folderId);
        try (var content = file.getInputStream()) {
            transfer.upload(
                    context.academyId(),
                    context.accountId(),
                    folderId,
                    file.getOriginalFilename(),
                    file.getContentType(),
                    content);
        }
        return "redirect:" + context.path("/storage/f/" + folderId);
    }

    /**
     * 파일 내려받기
     *
     * @param context 요청 문맥
     * @param nodeId 파일 ID
     * @return 파일 본문
     */
    @GetMapping("/n/{nodeId}/download")
    public ResponseEntity<InputStreamResource> download(AcademyContext context, @PathVariable UUID nodeId) {
        require(context, PermissionCatalog.STORAGE_FILE_READ, nodeId);
        var download = transfer.openDownload(context.academyId(), nodeId);
        var disposition = ContentDisposition.attachment()
                .filename(download.node().name(), StandardCharsets.UTF_8)
                .build();
        var response = ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .header("X-Content-Type-Options", "nosniff")
                .contentType(MediaType.APPLICATION_OCTET_STREAM);
        if (download.node().sizeBytes() != null) {
            response.contentLength(download.node().sizeBytes());
        }
        return response.body(new InputStreamResource(download.content()));
    }

    /**
     * 이름 바꾸기, 옮기기, 휴지통으로 보내기
     *
     * 옮긴 항목은 옮겨 간 폴더의 허용을 물려받음. 그래서 옮길 때는 대상을 고칠 권한, 옮겨 갈 폴더에 만들 권한에 더해
     * 옮길 대상과 그 아래 전부를 이미 읽을 수 있는지 확인함. 쓰기 허용만 가진 사람이 읽을 수 있는 폴더로 옮겨 읽기를
     * 얻는 길을 막음
     *
     * @param context 요청 문맥
     * @param nodeId 대상 노드 ID
     * @param action 이름 바꾸기(rename), 옮기기(move), 휴지통(trash)
     * @param name 새 이름
     * @param destinationId 옮겨 갈 폴더 ID
     * @param request 요청
     * @return 이전 화면
     */
    @PostMapping("/n/{nodeId}")
    public String change(
            AcademyContext context,
            @PathVariable UUID nodeId,
            @RequestParam String action,
            @RequestParam(required = false) String name,
            @RequestParam(required = false) UUID destinationId,
            HttpServletRequest request) {
        require(context, PermissionCatalog.STORAGE_NODE_MODIFY, nodeId);
        switch (action) {
            case "rename" -> mutation.rename(context.academyId(), context.accountId(), nodeId, name);
            case "move" -> {
                require(context, PermissionCatalog.STORAGE_FOLDER_CREATE, destinationId);
                requireReadableSubtree(context, nodeId);
                mutation.move(context.academyId(), context.accountId(), nodeId, destinationId);
            }
            case "trash" -> mutation.trash(context.academyId(), context.accountId(), nodeId);
            default -> throw new IllegalArgumentException("알 수 없는 동작: " + action);
        }
        return Redirects.back(request, context.path("/storage"));
    }

    /**
     * 휴지통 화면
     *
     * @param context 요청 문맥
     * @param model 화면 모델
     * @return 휴지통 템플릿
     */
    @GetMapping("/trash")
    public String trash(AcademyContext context, Model model) {
        var trashed = catalog.trash(context.academyId());
        var resources = resourcesOf(context, trashed);
        var restorable = guard.permitted(context, PermissionCatalog.STORAGE_NODE_MODIFY, resources);
        var deletable = guard.permitted(context, PermissionCatalog.STORAGE_NODE_DELETE, resources);
        model.addAttribute("trashed", trashed.stream()
                .filter(node -> restorable.contains(node.id()) || deletable.contains(node.id()))
                .toList());
        model.addAttribute("restorable", restorable);
        model.addAttribute("deletable", deletable);
        return "storage/trash";
    }

    /**
     * 휴지통에서 되살리기
     *
     * @param context 요청 문맥
     * @param nodeId 대상 노드 ID
     * @return 휴지통 화면
     */
    @PostMapping("/n/{nodeId}/restore")
    public String restore(AcademyContext context, @PathVariable UUID nodeId) {
        require(context, PermissionCatalog.STORAGE_NODE_MODIFY, nodeId);
        mutation.restore(context.academyId(), context.accountId(), nodeId);
        return "redirect:" + context.path("/storage/trash");
    }

    /**
     * 영구 삭제
     *
     * 지운 노드와 그 아래 노드에 걸려 있던 ACL도 함께 정리함. 남겨 두면 가리킬 대상이 없는 허용 기록이 됨
     *
     * @param context 요청 문맥
     * @param nodeId 대상 노드 ID
     * @return 휴지통 화면
     */
    @PostMapping("/n/{nodeId}/delete")
    public String deletePermanently(AcademyContext context, @PathVariable UUID nodeId) {
        require(context, PermissionCatalog.STORAGE_NODE_DELETE, nodeId);

        // 지우기 전에 하위 노드와 조상을 적어 둠. 지운 뒤에는 트리에서 찾을 수 없음
        var subtree = catalog.locateAll(context.academyId(), catalog.subtreeIds(context.academyId(), nodeId));
        mutation.deletePermanently(context.academyId(), context.accountId(), nodeId);
        for (var location : subtree.values()) {
            aclLifecycle.revokeAll(context.subject(), resourceOf(location));
        }
        return "redirect:" + context.path("/storage/trash");
    }

    /**
     * 이름으로 검색
     *
     * @param context 요청 문맥
     * @param q 검색어
     * @param model 화면 모델
     * @return 검색 결과 템플릿
     */
    @GetMapping("/search")
    public String search(AcademyContext context, @RequestParam String q, Model model) {
        var found = catalog.search(context.academyId(), q);
        var resources = resourcesOf(context, found);
        var listable = guard.permitted(context, PermissionCatalog.STORAGE_FOLDER_LIST, resources);
        model.addAttribute("query", q);
        model.addAttribute("results", found.stream().filter(node -> listable.contains(node.id())).toList());
        model.addAttribute("readable", guard.permitted(context, PermissionCatalog.STORAGE_FILE_READ, resources));
        return "storage/search";
    }

    /**
     * 폴더 ACL 부여
     *
     * @param context 요청 문맥
     * @param folderId 폴더 ID
     * @param subject 대상. role:ID 또는 account:ID
     * @param action 허용할 작업
     * @param inherit 하위 항목에도 적용할지
     * @param policyVersion 화면을 그릴 때의 정책 버전
     * @return 폴더 화면
     */
    @PostMapping("/f/{folderId}/acl")
    public String grantAcl(
            AcademyContext context,
            @PathVariable UUID folderId,
            @RequestParam String subject,
            @RequestParam ResourceAction action,
            @RequestParam(defaultValue = "false") boolean inherit,
            @RequestParam long policyVersion) {
        var resource = folderResource(context, folderId);
        guard.require(context, PermissionCatalog.STORAGE_ACL_MANAGE, resource);
        var parts = subject.split(":", 2);
        if (parts.length != 2) {
            throw new IllegalArgumentException("대상을 골라 주세요.");
        }
        var subjectId = UUID.fromString(parts[1]);
        var aclSubject = "role".equals(parts[0])
                ? new ResourceAclSubject.Role(subjectId)
                : new ResourceAclSubject.Account(subjectId);
        aclManagement.grant(context.subject(), resource, aclSubject, action, inherit, policyVersion);
        return "redirect:" + context.path("/storage/f/" + folderId) + "#acl";
    }

    /**
     * 폴더 ACL 회수
     *
     * @param context 요청 문맥
     * @param folderId 폴더 ID
     * @param aclId ACL ID
     * @param policyVersion 화면을 그릴 때의 정책 버전
     * @return 폴더 화면
     */
    @PostMapping("/f/{folderId}/acl/{aclId}/revoke")
    public String revokeAcl(
            AcademyContext context,
            @PathVariable UUID folderId,
            @PathVariable UUID aclId,
            @RequestParam long policyVersion) {
        var resource = folderResource(context, folderId);
        guard.require(context, PermissionCatalog.STORAGE_ACL_MANAGE, resource);
        aclManagement.revoke(context.subject(), resource, aclId, policyVersion);
        return "redirect:" + context.path("/storage/f/" + folderId) + "#acl";
    }

    /**
     * 최근 작업 화면
     *
     * 자료실 전체를 지울 수 있는 사람만 봄. 외부 저장소 작업이 중간에 끊긴 건을 여기서 확인하고 다시 맞춤
     *
     * @param context 요청 문맥
     * @param model 화면 모델
     * @return 최근 작업 템플릿
     */
    @GetMapping("/operations")
    public String operations(AcademyContext context, Model model) {
        requireRootOperator(context);
        model.addAttribute("operations", catalog.recentOperations(context.academyId(), OPERATION_LIMIT));
        return "storage/operations";
    }

    /**
     * 끊긴 작업을 외부 저장소의 실제 상태에 맞춰 마무리
     *
     * @param context 요청 문맥
     * @param operationId 작업 ID
     * @return 최근 작업 화면
     */
    @PostMapping("/operations/{operationId}/reconcile")
    public String reconcile(AcademyContext context, @PathVariable UUID operationId) {
        requireRootOperator(context);
        mutation.reconcile(context.academyId(), operationId);
        return "redirect:" + context.path("/storage/operations");
    }

    /**
     * 노드 하나에 대한 권한 확인
     *
     * @param context 요청 문맥
     * @param permission 필요한 권한
     * @param nodeId 대상 노드 ID
     */
    private void require(AcademyContext context, PermissionDefinition permission, UUID nodeId) {
        guard.require(context, permission, resourceOf(catalog.locate(context.academyId(), nodeId)));
    }

    /**
     * 옮길 대상과 그 아래의 모든 항목을 읽을 수 있는지 확인
     *
     * 하나라도 읽을 수 없으면 그 항목에 대한 읽기 요청으로 엔진에 물어 거부와 감사 기록을 남김
     *
     * @param context 요청 문맥
     * @param nodeId 옮길 노드 ID
     */
    private void requireReadableSubtree(AcademyContext context, UUID nodeId) {
        var resources = catalog
                .locateAll(context.academyId(), catalog.subtreeIds(context.academyId(), nodeId))
                .values()
                .stream()
                .map(StorageController::resourceOf)
                .toList();
        var readable = guard.permitted(context, PermissionCatalog.STORAGE_FILE_READ, resources);
        for (var resource : resources) {
            if (!readable.contains(resource.resourceId())) {
                guard.require(context, PermissionCatalog.STORAGE_FILE_READ, resource);
            }
        }
    }

    /**
     * 허용 목록을 걸 수 있는 폴더인지 확인하고 엔진에 넘길 형태로 변환
     *
     * 허용은 폴더에만 걸고 파일은 부모 폴더의 것을 씀
     *
     * @param context 요청 문맥
     * @param folderId 폴더 ID
     * @return 폴더 리소스
     * @throws StorageValidationException 폴더가 아닐 때
     */
    private ResourceContext folderResource(AcademyContext context, UUID folderId) {
        var location = catalog.locate(context.academyId(), folderId);
        if (!location.node().folder()) {
            throw new StorageValidationException("STORAGE_ACL_TARGET_NOT_FOLDER", "허용 목록은 폴더에만 걸 수 있습니다.");
        }
        return resourceOf(location);
    }

    /**
     * 루트 폴더에 대한 삭제 권한 확인
     *
     * @param context 요청 문맥
     */
    private void requireRootOperator(AcademyContext context) {
        var root = catalog.findRoot(context.academyId())
                .orElseThrow(() -> new StorageNotFoundException("STORAGE_ROOT_NOT_FOUND", "자료실이 아직 만들어지지 않았습니다."));
        require(context, PermissionCatalog.STORAGE_NODE_DELETE, root.id());
    }

    /**
     * 여러 노드를 조상과 함께 엔진에 넘길 형태로 변환
     *
     * @param context 요청 문맥
     * @param nodes 노드 목록
     * @return 노드별 리소스
     */
    private Collection<ResourceContext> resourcesOf(AcademyContext context, List<StorageNodeView> nodes) {
        var ids = nodes.stream().map(StorageNodeView::id).toList();
        return catalog.locateAll(context.academyId(), ids).values().stream()
                .map(StorageController::resourceOf)
                .toList();
    }

    /**
     * 노드와 조상을 엔진에 넘길 형태로 변환
     *
     * @param location 노드와 조상
     * @return 리소스
     */
    private static ResourceContext resourceOf(StorageNodeLocation location) {
        return new ResourceContext(
                location.node().academyId(), ResourceType.STORAGE_NODE, location.node().id(), location.ancestorIds());
    }

    /**
     * ACL을 줄 수 있는 대상을 모델에 넣음
     *
     * 역할과 소속을 읽을 권한이 있을 때만 채움. 없으면 이미 걸린 ACL의 대상은 이름 대신 종류만 보임
     *
     * @param context 요청 문맥
     * @param model 화면 모델
     * @return 역할 ID별 이름. 역할을 읽을 권한이 없으면 빈 맵
     */
    private Map<UUID, String> populateAclSubjects(AcademyContext context, Model model) {
        var roleNames = new HashMap<UUID, String>();
        var activeRoles = new ArrayList<Map.Entry<UUID, String>>();
        if (context.can(PermissionCatalog.ACCESS_ROLE_READ)) {
            for (var role : roleAdministration.roles(context.subject(), context.academyId()).value()) {
                roleNames.put(role.id(), role.name());
                if (role.status() == AcademyRoleStatus.ACTIVE) {
                    activeRoles.add(Map.entry(role.id(), role.name()));
                }
            }
        }
        var memberIds = new ArrayList<UUID>();
        if (context.can(PermissionCatalog.ACCESS_MEMBERSHIP_READ)) {
            for (var membership : membershipAdministration.memberships(context.subject(), context.academyId()).value()) {
                if (membership.status() == MembershipStatus.ACTIVE) {
                    memberIds.add(membership.accountId());
                }
            }
        }
        model.addAttribute("aclRoles", activeRoles);
        model.addAttribute("aclMembers", Set.copyOf(memberIds));
        return roleNames;
    }

    /**
     * ACL 한 건을 화면에 보여 줄 줄로 변환
     *
     * @param acl ACL
     * @param roleNames 역할 ID별 이름
     * @return 대상의 종류와 이름이 풀린 줄
     */
    private AclRow aclRow(ResourceAclView acl, Map<UUID, String> roleNames) {
        return switch (acl.subject()) {
            case ResourceAclSubject.Role role -> new AclRow(
                    acl.id(), true, roleNames.getOrDefault(role.roleId(), "역할"), acl.action(), acl.inheritToChildren());
            case ResourceAclSubject.Account account -> new AclRow(
                    acl.id(), false, names.of(account.accountId()), acl.action(), acl.inheritToChildren());
        };
    }

    /**
     * 화면에 보여 주는 ACL 한 줄
     *
     * @param id ACL ID
     * @param role 대상이 역할인지. 아니면 개인
     * @param name 대상의 이름
     * @param action 허용한 작업
     * @param inherit 하위 항목에도 적용되는지
     */
    public record AclRow(UUID id, boolean role, String name, ResourceAction action, boolean inherit) {
    }
}
