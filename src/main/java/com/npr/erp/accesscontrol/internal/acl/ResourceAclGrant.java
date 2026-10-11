package com.npr.erp.accesscontrol.internal.acl;

import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.accesscontrol.ResourceType;
import java.util.UUID;

/**
 * 정책 엔진에 넘기는 ACL 한 건
 *
 * @param id ACL ID
 * @param academyId 학원 ID
 * @param resourceType 리소스 종류
 * @param resourceId ACL이 걸린 리소스 ID
 * @param subjectType 주체 종류
 * @param subjectId 계정 ID 또는 역할 ID
 * @param action 허용하는 작업
 * @param inheritToChildren 하위 리소스에도 적용할지
 */
public record ResourceAclGrant(
        UUID id,
        UUID academyId,
        ResourceType resourceType,
        UUID resourceId,
        AclSubjectType subjectType,
        UUID subjectId,
        ResourceAction action,
        boolean inheritToChildren) {
}
