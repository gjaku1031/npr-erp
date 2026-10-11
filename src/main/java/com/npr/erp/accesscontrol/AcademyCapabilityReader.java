package com.npr.erp.accesscontrol;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 계정의 학원별 기능 권한 요약 조회
 */
public interface AcademyCapabilityReader {
    /**
     * 한 학원에서의 기능 권한 요약
     *
     * @param subject 조회하는 주체
     * @param academyId 학원 ID
     * @return 가진 권한 키. 슈퍼유저는 전체 권한
     * @throws AccessControlNotFoundException 학원 권한 정책이 초기화되지 않았을 때
     * @throws AuthorizationDeniedException 슈퍼유저가 아니고 활성 소속도 없을 때
     */
    AcademyCapabilities capabilities(AuthorizationSubject subject, UUID academyId);

    /**
     * 계정이 들어갈 수 있는 학원 ID 목록
     *
     * @param subject 조회하는 주체
     * @return 활성 소속이 있는 학원. 슈퍼유저는 초기화된 모든 학원
     */
    List<UUID> accessibleAcademyIds(AuthorizationSubject subject);

    /**
     * 학원에서 특정 권한을 지금 가진 계정 목록
     *
     * 업무 기능이 "누가 대상인가"를 정할 때 씀. 예를 들어 일일보고 제출 대상은 보고 작성 권한을 가진 사람임.
     * 활성 소속, 회수되지 않은 배정, 활성 역할만 반영하며 플랫폼 슈퍼유저는 포함하지 않음.
     * 인가 검사를 하지 않으므로 호출자가 먼저 요청자의 권한을 확인해야 함
     *
     * @param academyId 학원 ID
     * @param permission 학원 범위 권한
     * @return 권한을 가진 계정 ID
     */
    Set<UUID> accountIdsWith(UUID academyId, PermissionDefinition permission);
}
