package com.npr.erp.accesscontrol;

import java.util.HashSet;
import java.util.List;
import java.util.UUID;

/**
 * 리소스 소유 모듈이 원장을 조회해 만든 인가 문맥
 *
 * 학원·종류·조상 목록을 클라이언트 입력으로 채우면 안 됨. 이 타입은 자기 자신을 조상에 넣거나 조상이 중복된
 * 입력만 거부하며, 리소스가 실제로 있는지와 진짜 조상 관계인지는 확인하지 않음
 *
 * @param academyId 리소스를 실제로 소유한 학원 ID
 * @param resourceType 리소스 종류
 * @param resourceId 리소스 ID
 * @param ancestorResourceIds 루트부터 직접 부모까지의 조상 ID
 */
public record ResourceContext(
        UUID academyId, ResourceType resourceType, UUID resourceId, List<UUID> ancestorResourceIds) {
    /**
     * 조상 목록의 형식 확인과 불변 복사
     *
     * @throws IllegalArgumentException 자기 자신이 조상에 있거나 조상 ID가 중복될 때
     */
    public ResourceContext {
        ancestorResourceIds = List.copyOf(ancestorResourceIds);
        if (ancestorResourceIds.contains(resourceId)) {
            throw new IllegalArgumentException("리소스 자신을 조상으로 지정할 수 없습니다.");
        }
        if (new HashSet<>(ancestorResourceIds).size() != ancestorResourceIds.size()) {
            throw new IllegalArgumentException("조상 리소스 ID는 중복될 수 없습니다.");
        }
    }
}
