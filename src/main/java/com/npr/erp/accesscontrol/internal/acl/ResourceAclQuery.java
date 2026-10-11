package com.npr.erp.accesscontrol.internal.acl;

import static com.npr.generated.jooq.Tables.RESOURCE_ACL;

import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.accesscontrol.ResourceContext;
import com.npr.erp.accesscontrol.ResourceType;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * 인가 평가에 쓸 ACL 후보를 한 번에 읽는 조회
 */
@Repository
@RequiredArgsConstructor
public class ResourceAclQuery {
    /**
     * jOOQ 실행 문맥
     */
    private final DSLContext dsl;

    /**
     * 요청 주체에게 해당하는 ACL 중 주어진 리소스와 그 조상에 걸린 것을 조회
     *
     * 리소스가 여러 개여도 조회는 한 번임. 어느 ACL이 어느 리소스에 적용되는지는 정책 엔진이 판단함
     *
     * @param subject 요청 주체
     * @param contexts 같은 학원·같은 종류의 리소스 문맥
     * @param action 요구하는 ACL 작업
     * @param roleIds 주체의 유효한 역할 ID
     * @return ACL 후보
     */
    public List<ResourceAclGrant> load(
            AuthorizationSubject subject,
            Collection<ResourceContext> contexts,
            ResourceAction action,
            Set<UUID> roleIds) {
        if (contexts.isEmpty()) {
            return List.of();
        }
        var first = contexts.iterator().next();

        // 리소스 자신과 모든 조상의 ID를 모음
        var resourceIds = new HashSet<UUID>();
        for (var context : contexts) {
            resourceIds.add(context.resourceId());
            resourceIds.addAll(context.ancestorResourceIds());
        }

        // 주체 조건: 계정에 직접 걸린 것이거나, 가진 역할에 걸린 것
        Condition subjectCondition = RESOURCE_ACL.SUBJECT_ACCOUNT_ID.eq(subject.accountId());
        if (!roleIds.isEmpty()) {
            subjectCondition = subjectCondition.or(RESOURCE_ACL.SUBJECT_ROLE_ID.in(roleIds));
        }

        return dsl.selectFrom(RESOURCE_ACL)
                .where(RESOURCE_ACL.ACADEMY_ID.eq(first.academyId())
                        .and(RESOURCE_ACL.RESOURCE_TYPE.eq(first.resourceType().name()))
                        .and(RESOURCE_ACL.ACTION.eq(action.name()))
                        .and(RESOURCE_ACL.RESOURCE_ID.in(resourceIds))
                        .and(subjectCondition))
                .fetch(record -> {
                    var accountId = record.getSubjectAccountId();
                    return new ResourceAclGrant(
                            record.getId(),
                            record.getAcademyId(),
                            ResourceType.valueOf(record.getResourceType()),
                            record.getResourceId(),
                            accountId != null ? AclSubjectType.ACCOUNT : AclSubjectType.ROLE,
                            accountId != null ? accountId : record.getSubjectRoleId(),
                            ResourceAction.valueOf(record.getAction()),
                            record.getInheritToChildren());
                });
    }
}
