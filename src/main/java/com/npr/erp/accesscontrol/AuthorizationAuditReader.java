package com.npr.erp.accesscontrol;

import java.util.List;
import java.util.UUID;

/**
 * 감사 기록 조회 계약
 */
public interface AuthorizationAuditReader {
    /**
     * 학원의 최근 감사 기록 조회
     *
     * @param actor 조회하는 주체. {@code access.audit.read} 권한 필요
     * @param academyId 학원 ID
     * @param limit 가져올 최대 건수
     * @return 최근 것부터 정렬한 기록
     */
    List<AuthorizationAuditView> recent(AuthorizationSubject actor, UUID academyId, int limit);
}
