package com.npr.erp.tng;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

/**
 * 외부 학원 관리 시스템으로 나가는 포트
 *
 * 업무일지가 필요로 하는 조회와 쓰기를 한 인터페이스에 모음. 호출자는 직원 코드와 반 코드만 넘기고 외부 시스템의
 * 로그인·세션·화면 구조는 어댑터가 감춤. 조회는 값이 없으면 빈 목록이나 빈 값을 돌려주고, 외부 시스템에 닿지 못하면
 * {@link TngGatewayException}을 던짐
 */
public interface TngGateway {
    /**
     * 외부 시스템에 등록된 직원 목록
     *
     * @return 직원 코드 순
     */
    List<TngStaff> staff();

    /**
     * 직원이 담임인 반 목록
     *
     * @param staffCode 직원 코드
     * @return 정규 반과 특강 반. 모르는 직원이면 빈 목록
     */
    List<TngClassroom> classroomsOf(String staffCode);

    /**
     * 반의 현재 재원생 명단
     *
     * @param classCode 반 코드
     * @return 이름 순
     */
    List<TngStudent> students(String classCode);

    /**
     * 반의 하루 출결
     *
     * @param classCode 반 코드
     * @param date 날짜
     * @return 재원생 전원의 출결. 수업이 없는 날은 빈 목록
     */
    List<TngAttendance> attendance(String classCode, LocalDate date);

    /**
     * 직원이 하루 동안 남긴 상담 기록
     *
     * @param staffCode 직원 코드
     * @param date 날짜
     * @return 기록 순
     */
    List<TngCounselRecord> counsels(String staffCode, LocalDate date);

    /**
     * 반의 하루 알림장
     *
     * @param classCode 반 코드
     * @param date 날짜
     * @return 아직 게시하지 않았으면 빈 값
     */
    Optional<TngNotebook> notebook(String classCode, LocalDate date);

    /**
     * 알림장 게시
     *
     * 같은 반·같은 날짜의 알림장이 이미 있으면 새로 만들지 않고 그 글을 고침
     *
     * @param classCode 반 코드
     * @param date 날짜
     * @param title 제목
     * @param body 본문
     * @return 게시된 알림장
     */
    TngNotebook publishNotebook(String classCode, LocalDate date, String title, String body);

    /**
     * 반의 주간테스트 성적
     *
     * @param classCode 반 코드
     * @param testDate 시험을 본 날짜
     * @return 석차 순
     */
    List<TngScore> weeklyTestScores(String classCode, LocalDate testDate);

    /**
     * 반의 하루 과제 이행
     *
     * @param classCode 반 코드
     * @param date 날짜
     * @return 재원생 전원의 선행·심화 과제 이행
     */
    List<TngHomework> homework(String classCode, LocalDate date);

    /**
     * 상담 기록 쓰기
     *
     * 상담은 비공개로 기록됨. 같은 내용을 다시 보내면 같은 기록이 하나 더 생기므로 호출자가 중복 전송을 막아야 함
     *
     * @param staffCode 상담한 직원 코드
     * @param studentCode 학번
     * @param date 상담 날짜
     * @param topic 주제
     * @param content 내용
     * @return 외부 시스템이 돌려준 기록 번호
     */
    String postCounsel(String staffCode, String studentCode, LocalDate date, String topic, String content);
}
