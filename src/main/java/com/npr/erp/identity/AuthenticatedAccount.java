package com.npr.erp.identity;

import java.util.UUID;

/**
 * 다른 모듈에 공개하는 계정 정보
 *
 * 비밀번호 해시는 포함하지 않음
 *
 * @param accountId 계정 ID
 * @param username 로그인 아이디
 * @param displayName 화면에 보이는 이름
 * @param status 계정 상태
 */
public record AuthenticatedAccount(UUID accountId, String username, String displayName, AccountStatus status) {
}
