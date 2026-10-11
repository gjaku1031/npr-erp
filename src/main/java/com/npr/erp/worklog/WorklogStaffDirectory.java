package com.npr.erp.worklog;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/**
 * 직원의 업무일지 설정 계약
 */
public interface WorklogStaffDirectory {
    /**
     * 직원 한 명의 설정 조회
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     * @return 저장된 설정. 아직 없으면 연결과 담당 반이 빈 값
     */
    StaffView staff(UUID academyId, UUID accountId);

    /**
     * 여러 직원의 설정을 한 번에 조회
     *
     * @param academyId 학원 ID
     * @param accountIds 계정 ID 목록
     * @return 계정 ID별 설정. 저장된 것이 없는 계정도 빈 값으로 들어 있음
     */
    Map<UUID, StaffView> staffOf(UUID academyId, Collection<UUID> accountIds);

    /**
     * 외부 시스템 직원 코드 연결
     *
     * 코드가 바뀌면 이전에 가져온 담당 반은 비움
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     * @param staffCode 직원 코드. null이나 빈 값이면 연결 해제
     * @return 바뀐 설정
     * @throws WorklogValidationException 외부 시스템에 없는 직원 코드일 때
     */
    StaffView linkTngStaff(UUID academyId, UUID accountId, String staffCode);

    /**
     * 외부 시스템에서 담당 반을 다시 가져옴
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     * @return 새로 가져온 담당 반이 담긴 설정
     * @throws WorklogConflictException 직원 코드를 아직 연결하지 않았을 때
     */
    StaffView syncClassrooms(UUID academyId, UUID accountId);
}
