package com.npr.erp.identity;

import java.util.UUID;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * 계정 생성 요청
 *
 * 평문 비밀번호를 담으므로 toString을 만들지 않음
 */
@Getter
@RequiredArgsConstructor
public final class CreateAccountCommand {
    /**
     * 새 계정 ID. 같은 ID·아이디 조합이 이미 있으면 기존 계정을 돌려줌
     */
    private final UUID accountId;

    /**
     * 로그인 아이디
     */
    private final String username;

    /**
     * 화면에 보이는 이름
     */
    private final String displayName;

    /**
     * 평문 비밀번호. 8자 이상, UTF-8 72바이트 이하
     */
    private final String password;

    /**
     * 감사 기록에 남길 생성 사유
     */
    private final String reason;
}
