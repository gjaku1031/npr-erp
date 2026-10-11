package com.npr.erp.worklog;

import com.npr.erp.tng.TngClassroom;
import com.npr.erp.tng.TngCounselRecord;
import com.npr.erp.tng.TngNotebook;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 담당 반의 알림장·출결·상담 기록 조회 계약
 *
 * 모든 메서드는 요청한 사람이 가져온 담당 반 안에서만 동작함. 다른 사람의 반 자료는 읽지 않음
 */
public interface ClassroomDesk {
    /**
     * 그날 처리할 담당 반
     *
     * 그 날짜의 일일보고가 특강기간에 만들어졌으면 같은 요일 묶음의 특강 반을 더함
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     * @param date 날짜
     * @return 그날의 반
     */
    List<TngClassroom> classroomsOn(UUID academyId, UUID accountId, LocalDate date);

    /**
     * 한 반의 그날 알림장
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     * @param classCode 반 코드
     * @param date 날짜
     * @return 게시한 알림장. 없으면 빈 값
     * @throws WorklogForbiddenException 담당 반이 아닐 때
     */
    Optional<TngNotebook> notebook(UUID academyId, UUID accountId, String classCode, LocalDate date);

    /**
     * 알림장 게시 또는 수정
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     * @param classCode 반 코드
     * @param date 날짜
     * @param title 제목
     * @param body 내용
     * @return 게시한 알림장
     * @throws WorklogForbiddenException 담당 반이 아닐 때
     */
    TngNotebook publishNotebook(
            UUID academyId, UUID accountId, String classCode, LocalDate date, String title, String body);

    /**
     * 한 반의 출결표
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     * @param classCode 반 코드
     * @param date 날짜
     * @return 출결, 과제 이행, 주간테스트 성적을 학번으로 합친 표
     * @throws WorklogForbiddenException 담당 반이 아닐 때
     */
    AttendanceSheet attendance(UUID academyId, UUID accountId, String classCode, LocalDate date);

    /**
     * 본인이 그날 외부 시스템에 남긴 상담 기록
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     * @param date 날짜
     * @return 상담 기록. 직원 코드를 연결하지 않았으면 빈 목록
     */
    List<TngCounselRecord> counselRecords(UUID academyId, UUID accountId, LocalDate date);
}
