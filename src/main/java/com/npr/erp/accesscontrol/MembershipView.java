package com.npr.erp.accesscontrol;

import java.time.Instant;
import java.util.UUID;

/**
 * 학원 소속 조회 결과
 *
 * @param id 소속 ID
 * @param academyId 학원 ID
 * @param accountId 계정 ID
 * @param status 소속 상태
 * @param startedAt 시작 시각
 * @param endedAt 종료 시각. 유효한 소속은 null
 */
public record MembershipView(
        UUID id, UUID academyId, UUID accountId, MembershipStatus status, Instant startedAt, Instant endedAt) {
}
