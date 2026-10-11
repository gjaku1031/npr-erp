package com.npr.erp.accesscontrol;

import java.time.Instant;
import java.util.UUID;

/**
 * ACL 한 건의 조회 결과
 *
 * @param id ACL ID
 * @param academyId 학원 ID
 * @param resourceType 리소스 종류
 * @param resourceId 리소스 ID
 * @param subject 허용을 받는 주체
 * @param action 허용하는 작업
 * @param inheritToChildren 하위 리소스에도 적용할지
 * @param createdAt 생성 시각
 */
public record ResourceAclView(
        UUID id,
        UUID academyId,
        ResourceType resourceType,
        UUID resourceId,
        ResourceAclSubject subject,
        ResourceAction action,
        boolean inheritToChildren,
        Instant createdAt) {
}
