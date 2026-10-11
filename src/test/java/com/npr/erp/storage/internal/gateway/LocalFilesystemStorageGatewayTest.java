package com.npr.erp.storage.internal.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * 로컬 디스크 어댑터의 포트 계약 검사
 *
 * 특히 같은 변경을 다시 불러도 안전한지(멱등)와 루트 밖으로 나가지 않는지를 봄
 */
class LocalFilesystemStorageGatewayTest {
    /**
     * 테스트마다 새로 만들어지는 루트 디렉터리
     */
    @TempDir
    private Path root;

    /**
     * 검사 대상
     */
    private LocalFilesystemStorageGateway gateway;

    /**
     * 임시 디렉터리를 루트로 어댑터 준비
     */
    @BeforeEach
    void setUp() {
        gateway = new LocalFilesystemStorageGateway(root.toString());
    }

    /**
     * 쓴 파일을 그대로 읽을 수 있고, 실제 크기와 SHA-256을 돌려주며, 임시 파일이 남지 않는지 확인
     */
    @Test
    void writesFileAndReportsSizeAndChecksum() throws IOException {
        var content = "hello".getBytes(StandardCharsets.UTF_8);

        var stored = gateway.write(UUID.randomUUID(), "academies/a/교재/hello.txt", new ByteArrayInputStream(content));

        assertThat(stored.sizeBytes()).isEqualTo(5);
        assertThat(stored.checksumSha256())
                .isEqualTo("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
        try (var input = gateway.open("academies/a/교재/hello.txt")) {
            assertThat(input.readAllBytes()).isEqualTo(content);
        }
        try (var files = Files.list(root.resolve("academies/a/교재"))) {
            assertThat(files.map(path -> path.getFileName().toString())).containsExactly("hello.txt");
        }
    }

    /**
     * 디렉터리 생성을 두 번 불러도 성공하는지 확인
     */
    @Test
    void createDirectoryIsIdempotent() {
        var operationId = UUID.randomUUID();

        gateway.createDirectory(operationId, "academies/a/새 폴더");
        gateway.createDirectory(operationId, "academies/a/새 폴더");

        assertThat(root.resolve("academies/a/새 폴더")).isDirectory();
    }

    /**
     * 이미 옮겨진 뒤에 같은 이동을 다시 불러도 성공하는지 확인. 응답을 받지 못해 다시 확인하는 경우에 해당
     */
    @Test
    void moveIsIdempotentWhenAlreadyApplied() {
        var operationId = UUID.randomUUID();
        gateway.createDirectory(UUID.randomUUID(), "academies/a/이전");

        gateway.move(operationId, "academies/a/이전", "academies/a/이후");
        gateway.move(operationId, "academies/a/이전", "academies/a/이후");

        assertThat(root.resolve("academies/a/이후")).isDirectory();
        assertThat(root.resolve("academies/a/이전")).doesNotExist();
    }

    /**
     * 원본과 대상이 둘 다 있으면 덮어쓰지 않고 사람이 확인해야 하는 실패로 답하는지 확인
     */
    @Test
    void moveRefusesToOverwriteExistingDestination() {
        gateway.createDirectory(UUID.randomUUID(), "academies/a/원본");
        gateway.createDirectory(UUID.randomUUID(), "academies/a/대상");

        assertThatThrownBy(() -> gateway.move(UUID.randomUUID(), "academies/a/원본", "academies/a/대상"))
                .isInstanceOfSatisfying(StorageGatewayException.class, failure -> {
                    assertThat(failure.getCode()).isEqualTo("STORAGE_GATEWAY_MOVE_AMBIGUOUS");
                    assertThat(failure.isRetryable()).isFalse();
                });
    }

    /**
     * 하위까지 지우고, 이미 없는 경로를 다시 지워도 성공하는지 확인
     */
    @Test
    void deleteRecursivelyRemovesTreeAndIsIdempotent() {
        var operationId = UUID.randomUUID();
        gateway.write(UUID.randomUUID(), "academies/a/폴더/안/파일.txt", new ByteArrayInputStream(new byte[] {1}));

        gateway.deleteRecursively(operationId, "academies/a/폴더");
        gateway.deleteRecursively(operationId, "academies/a/폴더");

        assertThat(root.resolve("academies/a/폴더")).doesNotExist();
        assertThat(root.resolve("academies/a")).isDirectory();
    }

    /**
     * 상위로 올라가는 경로와 루트 자신은 거부하는지 확인
     */
    @Test
    void rejectsPathsOutsideRoot() {
        for (var path : new String[] {"../밖", "academies/../../밖", "", "/"}) {
            assertThatThrownBy(() -> gateway.createDirectory(UUID.randomUUID(), path))
                    .isInstanceOfSatisfying(StorageGatewayException.class, failure -> assertThat(failure.getCode())
                            .isEqualTo("STORAGE_GATEWAY_PATH_REJECTED"));
        }
    }

    /**
     * 없는 파일을 열면 다시 시도해도 소용없는 실패로 답하는지 확인
     */
    @Test
    void openingMissingFileFails() {
        assertThatThrownBy(() -> gateway.open("academies/a/없음.txt"))
                .isInstanceOfSatisfying(StorageGatewayException.class, failure -> assertThat(failure.isRetryable())
                        .isFalse());
    }
}
