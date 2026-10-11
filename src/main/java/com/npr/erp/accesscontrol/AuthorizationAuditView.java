package com.npr.erp.accesscontrol;

import java.time.Instant;
import java.util.UUID;

/**
 * 감사 기록 한 건의 조회 결과
 *
 * @param id 기록 ID
 * @param occurredAt 발생 시각
 * @param eventType 사건 종류
 * @param actorAccountId 실행한 계정. 없으면 null
 * @param targetAccountId 대상 계정. 없으면 null
 * @param permissionKey 판단한 권한 키. 정책 변경 기록은 null
 * @param resourceId 대상 리소스 ID. 없으면 null
 * @param decision ALLOW 또는 DENY. 정책 변경 기록은 null
 * @param reasonCode 사유 코드
 * @param policyVersion 기록 시점의 정책 버전. 없으면 null
 */
public record AuthorizationAuditView(
        UUID id,
        Instant occurredAt,
        String eventType,
        UUID actorAccountId,
        UUID targetAccountId,
        String permissionKey,
        UUID resourceId,
        String decision,
        String reasonCode,
        Long policyVersion) {
}
