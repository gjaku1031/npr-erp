package com.npr.erp.storage.internal.gateway;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.DigestOutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 서버의 로컬 디스크를 쓰는 {@link StorageGateway} 어댑터
 *
 * 설정한 루트 디렉터리 밖으로는 나가지 않음
 */
@Component
public final class LocalFilesystemStorageGateway implements StorageGateway {
    /**
     * 쓰는 중인 파일에 붙이는 확장자
     */
    private static final String PART_SUFFIX = ".part";

    /**
     * 모든 경로의 기준이 되는 루트 디렉터리의 절대 경로
     */
    private final Path root;

    /**
     * 루트 디렉터리 설정으로 어댑터 생성
     *
     * @param localRoot 파일을 둘 디렉터리. 없으면 처음 쓸 때 만듦
     */
    public LocalFilesystemStorageGateway(@Value("${npr.storage.local-root}") String localRoot) {
        this.root = Path.of(localRoot).toAbsolutePath().normalize();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void createDirectory(UUID operationId, String path) {
        var target = resolve(path);
        try {
            // 이미 디렉터리이면 성공. 같은 이름의 파일이 있으면 createDirectories가 실패함
            Files.createDirectories(target);
        } catch (IOException failure) {
            throw failed("STORAGE_GATEWAY_CREATE_FAILED", "디렉터리를 만들지 못했습니다.", failure);
        }
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void move(UUID operationId, String sourcePath, String destinationPath) {
        var source = resolve(sourcePath);
        var destination = resolve(destinationPath);
        var sourceExists = Files.exists(source, LinkOption.NOFOLLOW_LINKS);
        var destinationExists = Files.exists(destination, LinkOption.NOFOLLOW_LINKS);

        // 원본이 없고 대상이 있으면 앞선 시도가 이미 옮긴 것
        if (!sourceExists && destinationExists) {
            return;
        }
        // 둘 다 있거나 둘 다 없으면 원장과 디스크가 어긋난 것이라 자동으로 판정하지 않음
        if (!sourceExists || destinationExists) {
            throw new StorageGatewayException(
                    "STORAGE_GATEWAY_MOVE_AMBIGUOUS", false, "옮길 원본과 대상의 상태를 확인해야 합니다.", null);
        }
        try {
            Files.createDirectories(destination.getParent());
            Files.move(source, destination, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException failure) {
            throw failed("STORAGE_GATEWAY_MOVE_FAILED", "파일을 옮기지 못했습니다.", failure);
        }
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void deleteRecursively(UUID operationId, String path) {
        var target = resolve(path);
        if (!Files.exists(target, LinkOption.NOFOLLOW_LINKS)) {
            return;
        }
        try {
            // 하위부터 지우고 디렉터리를 마지막에 지움. 심볼릭 링크는 따라가지 않고 링크만 지움
            Files.walkFileTree(target, new SimpleFileVisitor<>() {
                /**
                 * 파일은 만나는 대로 삭제
                 */
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attributes) throws IOException {
                    Files.delete(file);
                    return FileVisitResult.CONTINUE;
                }

                /**
                 * 디렉터리는 안의 것을 모두 지운 뒤에 삭제
                 */
                @Override
                public FileVisitResult postVisitDirectory(Path directory, IOException failure) throws IOException {
                    if (failure != null) {
                        throw failure;
                    }
                    Files.delete(directory);
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException failure) {
            throw failed("STORAGE_GATEWAY_DELETE_FAILED", "파일을 지우지 못했습니다.", failure);
        }
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public StoredFile write(UUID operationId, String path, InputStream content) {
        var target = resolve(path);
        // 작업 ID를 붙여 같은 이름을 동시에 올리는 두 요청의 임시 파일이 겹치지 않게 함
        var part = target.resolveSibling(target.getFileName() + "." + operationId + PART_SUFFIX);
        try {
            Files.createDirectories(target.getParent());
            var digest = MessageDigest.getInstance("SHA-256");
            long size;
            try (var output = new DigestOutputStream(Files.newOutputStream(part), digest)) {
                size = content.transferTo(output);
            }
            Files.move(part, target, StandardCopyOption.ATOMIC_MOVE);
            return new StoredFile(size, HexFormat.of().formatHex(digest.digest()));
        } catch (IOException failure) {
            deleteQuietly(part);
            throw failed("STORAGE_GATEWAY_WRITE_FAILED", "파일을 쓰지 못했습니다.", failure);
        } catch (NoSuchAlgorithmException failure) {
            deleteQuietly(part);
            throw new StorageGatewayException(
                    "STORAGE_GATEWAY_DIGEST_UNAVAILABLE", false, "SHA-256을 계산할 수 없습니다.", failure);
        }
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public InputStream open(String path) {
        var target = resolve(path);
        try {
            if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)) {
                throw new StorageGatewayException("STORAGE_GATEWAY_FILE_MISSING", false, "파일을 찾을 수 없습니다.", null);
            }
            return Files.newInputStream(target, LinkOption.NOFOLLOW_LINKS);
        } catch (IOException failure) {
            throw failed("STORAGE_GATEWAY_READ_FAILED", "파일을 읽지 못했습니다.", failure);
        }
    }

    /**
     * 원장의 경로를 루트 디렉터리 아래의 실제 경로로 바꿈
     *
     * @param path 슬래시로 구분한 경로
     * @return 루트 아래의 절대 경로
     * @throws StorageGatewayException 정규화한 경로가 루트 밖으로 나갈 때
     */
    private Path resolve(String path) {
        var relative = path.startsWith("/") ? path.substring(1) : path;
        var resolved = root.resolve(relative).normalize();
        if (!resolved.startsWith(root) || resolved.equals(root)) {
            throw new StorageGatewayException("STORAGE_GATEWAY_PATH_REJECTED", false, "허용되지 않은 경로입니다.", null);
        }
        return resolved;
    }

    /**
     * 다시 시도할 수 있는 입출력 실패 예외 생성
     *
     * @param code 고정 오류 코드
     * @param message 설명
     * @param cause 원인
     * @return 던질 예외
     */
    private static StorageGatewayException failed(String code, String message, IOException cause) {
        return new StorageGatewayException(code, true, message, cause);
    }

    /**
     * 쓰다 만 임시 파일을 지움. 지우지 못해도 원래 실패를 가리지 않도록 무시함
     *
     * @param part 임시 파일 경로
     */
    private static void deleteQuietly(Path part) {
        try {
            Files.deleteIfExists(part);
        } catch (IOException ignored) {
            // 임시 파일이 남아도 최종 경로에는 영향이 없음
        }
    }
}
