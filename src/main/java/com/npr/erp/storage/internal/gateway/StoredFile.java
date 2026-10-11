package com.npr.erp.storage.internal.gateway;

/**
 * 외부 저장소에 실제로 쓰인 파일의 정보
 *
 * @param sizeBytes 쓰인 바이트 수
 * @param checksumSha256 본문의 SHA-256. 소문자 16진수 64자
 */
public record StoredFile(long sizeBytes, String checksumSha256) {
}
