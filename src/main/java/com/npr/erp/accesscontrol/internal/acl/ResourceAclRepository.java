package com.npr.erp.accesscontrol.internal.acl;

import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.accesscontrol.ResourceType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * ACL 저장소
 */
public interface ResourceAclRepository extends JpaRepository<ResourceAclEntity, UUID> {
    /**
     * 리소스에 직접 걸린 ACL을 생성 순으로 조회
     *
     * @param academyId 학원 ID
     * @param resourceType 리소스 종류
     * @param resourceId 리소스 ID
     * @return ACL 목록
     */
    List<ResourceAclEntity> findAllByAcademyIdAndResourceTypeAndResourceIdOrderByCreatedAtAsc(
            UUID academyId, ResourceType resourceType, UUID resourceId);

    /**
     * 학원 안에서 ID로 조회
     *
     * @param id ACL ID
     * @param academyId 학원 ID
     * @return 다른 학원의 ACL이면 빈 값
     */
    Optional<ResourceAclEntity> findByIdAndAcademyId(UUID id, UUID academyId);

    /**
     * 같은 리소스·계정·작업의 ACL 조회
     *
     * @param academyId 학원 ID
     * @param resourceType 리소스 종류
     * @param resourceId 리소스 ID
     * @param subjectAccountId 주체 계정 ID
     * @param action 작업
     * @return 없으면 빈 값
     */
    Optional<ResourceAclEntity> findByAcademyIdAndResourceTypeAndResourceIdAndSubjectAccountIdAndAction(
            UUID academyId, ResourceType resourceType, UUID resourceId, UUID subjectAccountId, ResourceAction action);

    /**
     * 같은 리소스·역할·작업의 ACL 조회
     *
     * @param academyId 학원 ID
     * @param resourceType 리소스 종류
     * @param resourceId 리소스 ID
     * @param subjectRoleId 주체 역할 ID
     * @param action 작업
     * @return 없으면 빈 값
     */
    Optional<ResourceAclEntity> findByAcademyIdAndResourceTypeAndResourceIdAndSubjectRoleIdAndAction(
            UUID academyId, ResourceType resourceType, UUID resourceId, UUID subjectRoleId, ResourceAction action);
}
