package com.npr.erp.identity;

import java.util.UUID;
import lombok.Getter;
import lombok.RequiredArgsConstructor;

/**
 * 비밀번호 변경 요청
 *
 * 평문 비밀번호를 담으므로 toString을 만들지 않음
 */
@Getter
@RequiredArgsConstructor
public final class SetAccountPasswordCommand {
    /**
     * 대상 계정 ID
     */
    private final UUID accountId;

    /**
     * 새 평문 비밀번호
     */
    private final String password;

    /**
     * 감사 기록에 남길 변경 사유
     */
    private final String reason;
}
