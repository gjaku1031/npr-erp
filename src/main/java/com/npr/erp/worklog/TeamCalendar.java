package com.npr.erp.worklog;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 일정 관리 계약
 *
 * 팀 일정을 고칠 수 있는지는 호출자가 기능 권한으로 확인함. 개인일정이 본인의 것인지는 이 모듈이 확인함
 */
public interface TeamCalendar {
    /**
     * 한 사람이 볼 수 있는 기간 안의 일정
     *
     * @param academyId 학원 ID
     * @param viewerId 보는 계정 ID
     * @param from 기간의 첫 날
     * @param to 기간의 마지막 날
     * @return 팀 일정 전체와 본인의 개인일정. 시작일 순
     */
    List<EventView> events(UUID academyId, UUID viewerId, LocalDate from, LocalDate to);

    /**
     * 일정 한 건
     *
     * @param academyId 학원 ID
     * @param eventId 일정 ID
     * @param viewerId 보는 계정 ID
     * @return 일정
     * @throws WorklogForbiddenException 다른 사람의 개인일정일 때
     */
    EventView event(UUID academyId, UUID eventId, UUID viewerId);

    /**
     * 팀 일정 생성
     *
     * @param academyId 학원 ID
     * @param actorId 만드는 계정 ID
     * @param draft 입력
     * @return 만든 일정
     */
    EventView createTeamEvent(UUID academyId, UUID actorId, EventDraft draft);

    /**
     * 개인일정 생성
     *
     * @param academyId 학원 ID
     * @param ownerId 소유자 계정 ID
     * @param draft 입력
     * @return 만든 일정
     */
    EventView createPersonalEvent(UUID academyId, UUID ownerId, EventDraft draft);

    /**
     * 팀 일정 수정
     *
     * @param academyId 학원 ID
     * @param eventId 일정 ID
     * @param draft 입력
     * @throws WorklogConflictException 팀 일정이 아닐 때
     */
    void updateTeamEvent(UUID academyId, UUID eventId, EventDraft draft);

    /**
     * 개인일정 수정
     *
     * @param academyId 학원 ID
     * @param eventId 일정 ID
     * @param ownerId 소유자 계정 ID
     * @param draft 입력
     * @throws WorklogForbiddenException 본인의 개인일정이 아닐 때
     */
    void updatePersonalEvent(UUID academyId, UUID eventId, UUID ownerId, EventDraft draft);

    /**
     * 팀 일정 삭제
     *
     * @param academyId 학원 ID
     * @param eventId 일정 ID
     * @throws WorklogConflictException 팀 일정이 아닐 때
     */
    void deleteTeamEvent(UUID academyId, UUID eventId);

    /**
     * 개인일정 삭제
     *
     * @param academyId 학원 ID
     * @param eventId 일정 ID
     * @param ownerId 소유자 계정 ID
     * @throws WorklogForbiddenException 본인의 개인일정이 아닐 때
     */
    void deletePersonalEvent(UUID academyId, UUID eventId, UUID ownerId);
}
