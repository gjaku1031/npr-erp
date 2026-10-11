package com.npr.erp.integration.storage;

import static com.npr.generated.jooq.Tables.STORAGE_OPERATION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.npr.erp.identity.AccountAdministration;
import com.npr.erp.identity.CreateAccountCommand;
import com.npr.erp.integration.IntegrationTest;
import com.npr.erp.storage.StorageCatalog;
import com.npr.erp.storage.StorageConflictException;
import com.npr.erp.storage.StorageMutation;
import com.npr.erp.storage.StorageNodeStatus;
import com.npr.erp.storage.StorageNodeView;
import com.npr.erp.storage.StorageNotFoundException;
import com.npr.erp.storage.StorageOperationStatus;
import com.npr.erp.storage.StorageTransfer;
import com.npr.erp.storage.StorageUnavailableException;
import com.npr.erp.storage.internal.mutation.StorageMutationCompletion;
import com.npr.erp.storage.internal.mutation.StorageMutationPreparation;
import com.npr.erp.storage.internal.operation.StorageOperationRecovery;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;

/**
 * 자료실 트리 변경, 작업 원장, 파일 전송 검사
 *
 * 실제 PostgreSQL과 테스트용 로컬 디렉터리를 씀
 */
@IntegrationTest
class StorageIntegrationTest {
    /**
     * 조회
     */
    @Autowired
    private StorageCatalog catalog;

    /**
     * 트리 변경
     */
    @Autowired
    private StorageMutation mutation;

    /**
     * 파일 전송
     */
    @Autowired
    private StorageTransfer transfer;

    /**
     * 중단 상황을 만들기 위한 준비 단계
     */
    @Autowired
    private StorageMutationPreparation preparation;

    /**
     * 중단 상황을 만들기 위한 확정 단계
     */
    @Autowired
    private StorageMutationCompletion completion;

    /**
     * 재시작 복구
     */
    @Autowired
    private StorageOperationRecovery recovery;

    /**
     * 계정 생성
     */
    @Autowired
    private AccountAdministration accountAdministration;

    /**
     * 검증용 직접 조회
     */
    @Autowired
    private DSLContext dsl;

    /**
     * 파일이 실제로 놓이는 디렉터리
     */
    @Value("${npr.storage.local-root}")
    private String localRoot;

    /**
     * 테스트마다 새로 만드는 학원 ID
     */
    private UUID academyId;

    /**
     * 변경을 실행하는 계정 ID
     */
    private UUID actorId;

    /**
     * 학원 루트 폴더
     */
    private StorageNodeView root;

    /**
     * 새 학원과 루트 폴더 준비
     */
    @BeforeEach
    void setUp() {
        academyId = UUID.randomUUID();
        var username = "storage-actor-" + UUID.randomUUID();
        actorId = accountAdministration
                .createAccount(new CreateAccountCommand(UUID.randomUUID(), username, username, "test-password", "통합 테스트"))
                .accountId();
        root = mutation.initializeRoot(academyId, actorId, "자료실");
    }

    /**
     * 루트를 두 번 만들어도 같은 루트를 돌려주고 디스크에 디렉터리가 생기는지 확인
     */
    @Test
    void initializesRootOnce() {
        var again = mutation.initializeRoot(academyId, actorId, "다른 이름");

        assertThat(again.id()).isEqualTo(root.id());
        assertThat(again.name()).isEqualTo("자료실");
        assertThat(academyDirectory()).isDirectory();
    }

    /**
     * 폴더를 만들면 디스크와 목록에 나타나고, 대소문자만 다른 같은 이름은 만들 수 없는지 확인
     */
    @Test
    void createsFolderAndRejectsDuplicateName() {
        var folder = mutation.createFolder(academyId, actorId, root.id(), "Worksheets");

        assertThat(folder.status()).isEqualTo(StorageNodeStatus.ACTIVE);
        assertThat(academyDirectory().resolve("Worksheets")).isDirectory();
        assertThat(catalog.folder(academyId, root.id()).children()).extracting(StorageNodeView::name)
                .containsExactly("Worksheets");
        assertThatThrownBy(() -> mutation.createFolder(academyId, actorId, root.id(), "worksheets"))
                .isInstanceOfSatisfying(StorageConflictException.class, failure -> assertThat(failure.getCode())
                        .isEqualTo("STORAGE_NAME_CONFLICT"));
    }

    /**
     * 이름을 바꾸고 다른 폴더로 옮기면 디스크의 경로도 함께 바뀌는지 확인
     */
    @Test
    void renameAndMoveFollowOnDisk() {
        var source = mutation.createFolder(academyId, actorId, root.id(), "초안");
        var archive = mutation.createFolder(academyId, actorId, root.id(), "보관");

        var renamed = mutation.rename(academyId, actorId, source.id(), "완성본");
        var moved = mutation.move(academyId, actorId, source.id(), archive.id());

        assertThat(renamed.name()).isEqualTo("완성본");
        assertThat(moved.parentId()).isEqualTo(archive.id());
        assertThat(academyDirectory().resolve("보관/완성본")).isDirectory();
        assertThat(academyDirectory().resolve("초안")).doesNotExist();
        assertThat(catalog.locate(academyId, source.id()).ancestorIds()).containsExactly(root.id(), archive.id());
    }

    /**
     * 폴더를 자기 하위로 옮기거나 루트를 바꾸려는 요청을 거부하는지 확인
     */
    @Test
    void rejectsCycleAndRootMutation() {
        var parent = mutation.createFolder(academyId, actorId, root.id(), "상위");
        var child = mutation.createFolder(academyId, actorId, parent.id(), "하위");

        assertThatThrownBy(() -> mutation.move(academyId, actorId, parent.id(), child.id()))
                .isInstanceOfSatisfying(StorageConflictException.class, failure -> assertThat(failure.getCode())
                        .isEqualTo("STORAGE_MOVE_CYCLE"));
        assertThatThrownBy(() -> mutation.rename(academyId, actorId, root.id(), "새 루트"))
                .isInstanceOfSatisfying(StorageConflictException.class, failure -> assertThat(failure.getCode())
                        .isEqualTo("STORAGE_ROOT_IMMUTABLE"));
    }

    /**
     * 다른 학원의 노드 ID로는 조회와 변경이 되지 않는지 확인
     */
    @Test
    void nodesAreIsolatedByAcademy() {
        var folder = mutation.createFolder(academyId, actorId, root.id(), "우리 학원");
        var otherAcademyId = UUID.randomUUID();
        mutation.initializeRoot(otherAcademyId, actorId, "자료실");

        assertThatThrownBy(() -> catalog.locate(otherAcademyId, folder.id()))
                .isInstanceOf(StorageNotFoundException.class);
        assertThatThrownBy(() -> mutation.rename(otherAcademyId, actorId, folder.id(), "침범"))
                .isInstanceOf(StorageNotFoundException.class);
    }

    /**
     * 올린 파일의 크기와 본문이 그대로이고, 내려받을 때 같은 본문이 나오는지 확인
     */
    @Test
    void uploadsAndDownloadsFile() throws IOException {
        var content = "3월 모의고사 해설".getBytes(StandardCharsets.UTF_8);

        var file = transfer.upload(
                academyId, actorId, root.id(), "해설.txt", "text/plain", new ByteArrayInputStream(content));

        assertThat(file.status()).isEqualTo(StorageNodeStatus.ACTIVE);
        assertThat(file.sizeBytes()).isEqualTo(content.length);
        var download = transfer.openDownload(academyId, file.id());
        try (var input = download.content()) {
            assertThat(input.readAllBytes()).isEqualTo(content);
        }
        assertThat(catalog.search(academyId, "해설")).extracting(StorageNodeView::id).containsExactly(file.id());
    }

    /**
     * 휴지통으로 보낸 폴더는 목록에서 사라지고 하위 항목과 함께 복원되는지 확인
     */
    @Test
    void trashAndRestoreMoveWholeSubtree() {
        var folder = mutation.createFolder(academyId, actorId, root.id(), "지난 학기");
        var inner = mutation.createFolder(academyId, actorId, folder.id(), "1반");

        mutation.trash(academyId, actorId, folder.id());

        assertThat(catalog.folder(academyId, root.id()).children()).isEmpty();
        assertThat(catalog.trash(academyId)).extracting(StorageNodeView::id).containsExactly(folder.id());
        assertThat(catalog.locate(academyId, inner.id()).node().status()).isEqualTo(StorageNodeStatus.TRASHED);
        // 휴지통은 상태만 바꾸므로 디스크의 폴더는 그대로 있음
        assertThat(academyDirectory().resolve("지난 학기/1반")).isDirectory();

        mutation.restore(academyId, actorId, folder.id());

        assertThat(catalog.trash(academyId)).isEmpty();
        assertThat(catalog.locate(academyId, inner.id()).node().status()).isEqualTo(StorageNodeStatus.ACTIVE);
    }

    /**
     * 영구 삭제는 휴지통에 있는 항목만 되고, 지운 뒤에는 디스크에서 사라지며 같은 이름을 다시 쓸 수 있는지 확인
     */
    @Test
    void deletesPermanentlyOnlyFromTrash() {
        var folder = mutation.createFolder(academyId, actorId, root.id(), "삭제 대상");
        assertThatThrownBy(() -> mutation.deletePermanently(academyId, actorId, folder.id()))
                .isInstanceOfSatisfying(StorageConflictException.class, failure -> assertThat(failure.getCode())
                        .isEqualTo("STORAGE_DELETE_REQUIRES_TRASH"));

        mutation.trash(academyId, actorId, folder.id());
        mutation.deletePermanently(academyId, actorId, folder.id());

        assertThat(academyDirectory().resolve("삭제 대상")).doesNotExist();
        assertThatThrownBy(() -> catalog.locate(academyId, folder.id())).isInstanceOf(StorageNotFoundException.class);
        assertThat(mutation.createFolder(academyId, actorId, root.id(), "삭제 대상").status())
                .isEqualTo(StorageNodeStatus.ACTIVE);
    }

    /**
     * 외부 저장소 호출이 실패하면 노드가 이전 상태로 돌아가고 원장에 실패가 남는지 확인
     *
     * 폴더가 만들어질 자리에 파일을 미리 두어 디렉터리 생성을 실패시킴
     */
    @Test
    void gatewayFailureRevertsNodeAndRecordsFailure() throws IOException {
        Files.writeString(academyDirectory().resolve("막힌 이름"), "디렉터리 자리를 차지한 파일");

        assertThatThrownBy(() -> mutation.createFolder(academyId, actorId, root.id(), "막힌 이름"))
                .isInstanceOf(StorageUnavailableException.class);

        assertThat(catalog.folder(academyId, root.id()).children()).isEmpty();
        var failed = catalog.recentOperations(academyId, 1).getFirst();
        assertThat(failed.status()).isEqualTo(StorageOperationStatus.RETRYABLE_FAILED);
        assertThat(failed.lastErrorCode()).isEqualTo("STORAGE_GATEWAY_CREATE_FAILED");
    }

    /**
     * 외부 저장소를 호출하던 중에 서버가 끝난 이름 변경을, 다시 뜬 뒤 확인 절차로 마무리할 수 있는지 확인
     *
     * 준비와 호출 시작까지만 실행해 중단 상황을 만듦
     */
    @Test
    void reconcilesRenameInterruptedBeforeGatewayCall() {
        var folder = mutation.createFolder(academyId, actorId, root.id(), "중단 전");
        var prepared = preparation.prepareRename(academyId, actorId, folder.id(), "중단 후");
        completion.start(prepared.operationId());

        recovery.markInterruptedOperations();

        assertThat(operationStatus(prepared.operationId())).isEqualTo("VERIFY");
        assertThat(catalog.locate(academyId, folder.id()).node().status()).isEqualTo(StorageNodeStatus.MUTATING);

        var reconciled = mutation.reconcile(academyId, prepared.operationId());

        assertThat(reconciled.status()).isEqualTo(StorageOperationStatus.COMPLETED);
        assertThat(reconciled.attempts()).isEqualTo(2);
        assertThat(catalog.locate(academyId, folder.id()).node().name()).isEqualTo("중단 후");
        assertThat(academyDirectory().resolve("중단 후")).isDirectory();
    }

    /**
     * 원장에 기록만 하고 호출을 시작하기 전에 서버가 끝난 작업도 확인 대상이 되어 마무리할 수 있는지 확인
     *
     * 이 작업을 놓치면 노드가 변경 중으로 남아 다시는 고칠 수 없게 됨
     */
    @Test
    void reconcilesRenameInterruptedBeforeStart() {
        var folder = mutation.createFolder(academyId, actorId, root.id(), "시작 전");
        var prepared = preparation.prepareRename(academyId, actorId, folder.id(), "시작 후");

        recovery.markInterruptedOperations();

        assertThat(operationStatus(prepared.operationId())).isEqualTo("VERIFY");

        var reconciled = mutation.reconcile(academyId, prepared.operationId());

        assertThat(reconciled.status()).isEqualTo(StorageOperationStatus.COMPLETED);
        assertThat(catalog.locate(academyId, folder.id()).node().status()).isEqualTo(StorageNodeStatus.ACTIVE);
        assertThat(academyDirectory().resolve("시작 후")).isDirectory();
    }

    /**
     * 외부 저장소에는 이미 반영됐는데 확정하기 전에 서버가 끝난 경우에도, 같은 변경을 다시 적용하지 않고 마무리되는지 확인
     */
    @Test
    void reconcilesRenameAlreadyAppliedOnDisk() throws IOException {
        var folder = mutation.createFolder(academyId, actorId, root.id(), "반영 전");
        var prepared = preparation.prepareRename(academyId, actorId, folder.id(), "반영 후");
        completion.start(prepared.operationId());
        Files.move(academyDirectory().resolve("반영 전"), academyDirectory().resolve("반영 후"));
        recovery.markInterruptedOperations();

        var reconciled = mutation.reconcile(academyId, prepared.operationId());

        assertThat(reconciled.status()).isEqualTo(StorageOperationStatus.COMPLETED);
        assertThat(catalog.locate(academyId, folder.id()).node().name()).isEqualTo("반영 후");
    }

    /**
     * 테스트 학원의 실제 디렉터리
     *
     * @return 로컬 루트 아래의 학원 디렉터리
     */
    private Path academyDirectory() {
        return Path.of(localRoot).toAbsolutePath().resolve("academies").resolve(academyId.toString());
    }

    /**
     * 원장에 적힌 작업 상태 조회
     *
     * @param operationId 작업 ID
     * @return 상태 문자열
     */
    private String operationStatus(UUID operationId) {
        return dsl.select(STORAGE_OPERATION.STATUS)
                .from(STORAGE_OPERATION)
                .where(STORAGE_OPERATION.ID.eq(operationId))
                .fetchOne(STORAGE_OPERATION.STATUS);
    }
}
