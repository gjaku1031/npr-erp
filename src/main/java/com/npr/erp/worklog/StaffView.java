package com.npr.erp.worklog;

import com.npr.erp.tng.TngClassKind;
import com.npr.erp.tng.TngClassroom;
import com.npr.erp.tng.TngDayGroup;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 직원의 업무일지 설정
 *
 * @param academyId 학원 ID
 * @param accountId 계정 ID
 * @param tngStaffCode 연결한 외부 시스템 직원 코드. 연결 전이면 null
 * @param classrooms 마지막으로 가져온 담당 반
 * @param classroomsSyncedAt 담당 반을 마지막으로 가져온 시각. 가져온 적이 없으면 null
 */
public record StaffView(
        UUID academyId,
        UUID accountId,
        String tngStaffCode,
        List<TngClassroom> classrooms,
        Instant classroomsSyncedAt) {
    /**
     * 그날 수업이 있는 담당 반
     *
     * @param date 날짜
     * @param includeSpecial 특강 반도 포함할지
     * @return 그날의 요일 묶음에 속한 반. 일요일은 빈 목록
     */
    public List<TngClassroom> classroomsOn(LocalDate date, boolean includeSpecial) {
        var dayGroup = TngDayGroup.of(date).orElse(null);
        if (dayGroup == null) {
            return List.of();
        }
        return classrooms.stream()
                .filter(classroom -> classroom.dayGroup() == dayGroup)
                .filter(classroom -> includeSpecial || classroom.kind() == TngClassKind.REGULAR)
                .toList();
    }

    /**
     * 종류별 담당 반
     *
     * @param kind 정규 또는 특강
     * @return 그 종류의 반
     */
    public List<TngClassroom> classroomsOf(TngClassKind kind) {
        return classrooms.stream().filter(classroom -> classroom.kind() == kind).toList();
    }

    /**
     * 담당 반인지 확인
     *
     * @param classCode 반 코드
     * @return 가져온 담당 반에 있으면 true
     */
    public boolean teaches(String classCode) {
        return classrooms.stream().anyMatch(classroom -> classroom.code().equals(classCode));
    }
}
