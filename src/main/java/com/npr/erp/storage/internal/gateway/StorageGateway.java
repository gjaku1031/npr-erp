package com.npr.erp.storage.internal.gateway;

import java.io.InputStream;
import java.util.UUID;

/**
 * 파일 본문을 두는 외부 저장소로 나가는 포트
 *
 * 구현은 로컬 디스크, NAS, 객체 저장소로 바꿀 수 있음. 경로는 storage 모듈이 원장에서 조립한 값이며 클라이언트 입력이
 * 아님. 변경 메서드는 모두 멱등이어야 함: 같은 작업 ID로 다시 불려도, 이미 반영된 상태면 성공으로 답해야 함.
 * 응답을 받지 못했거나 프로세스가 중간에 끝난 작업을 이 성질에 기대어 다시 확인함
 */
public interface StorageGateway {
    /**
     * 디렉터리 생성
     *
     * @param operationId 원장의 작업 ID
     * @param path 만들 디렉터리 경로
     * @throws StorageGatewayException 만들지 못했을 때. 이미 디렉터리가 있으면 성공
     */
    void createDirectory(UUID operationId, String path);

    /**
     * 파일이나 디렉터리를 다른 경로로 옮김. 이름 변경과 이동에 모두 씀
     *
     * @param operationId 원장의 작업 ID
     * @param sourcePath 지금 경로
     * @param destinationPath 옮길 경로
     * @throws StorageGatewayException 옮기지 못했을 때. 원본이 없고 대상이 있으면 이미 옮긴 것으로 보고 성공
     */
    void move(UUID operationId, String sourcePath, String destinationPath);

    /**
     * 파일이나 디렉터리를 하위까지 삭제
     *
     * @param operationId 원장의 작업 ID
     * @param path 지울 경로
     * @throws StorageGatewayException 지우지 못했을 때. 이미 없으면 성공
     */
    void deleteRecursively(UUID operationId, String path);

    /**
     * 파일 쓰기
     *
     * 임시 파일에 다 쓴 뒤 최종 경로로 옮겨, 쓰다 만 파일이 최종 경로에 보이지 않게 함
     *
     * @param operationId 원장의 작업 ID
     * @param path 파일 경로
     * @param content 본문. 이 메서드가 닫지 않음
     * @return 실제로 쓰인 크기와 SHA-256
     * @throws StorageGatewayException 쓰지 못했을 때
     */
    StoredFile write(UUID operationId, String path, InputStream content);

    /**
     * 파일 읽기
     *
     * @param path 파일 경로
     * @return 호출자가 닫아야 하는 스트림
     * @throws StorageGatewayException 파일이 없거나 읽지 못했을 때
     */
    InputStream open(String path);
}
