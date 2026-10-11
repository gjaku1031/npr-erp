package com.npr.erp.worklog.internal.event;

import static com.npr.generated.jooq.Tables.WORKLOG_EVENT;
import static com.npr.generated.jooq.Tables.WORKLOG_TAG;

import com.npr.erp.worklog.EventDraft;
import com.npr.erp.worklog.EventKind;
import com.npr.erp.worklog.EventView;
import com.npr.erp.worklog.TagView;
import com.npr.erp.worklog.TeamCalendar;
import com.npr.erp.worklog.WorklogConflictException;
import com.npr.erp.worklog.WorklogForbiddenException;
import com.npr.erp.worklog.WorklogNotFoundException;
import com.npr.erp.worklog.WorklogValidationException;
import com.npr.erp.worklog.internal.support.Texts;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link TeamCalendar} 구현
 */
@Service
@RequiredArgsConstructor
public class JooqTeamCalendar implements TeamCalendar {
    /**
     * 제목의 최대 길이
     */
    private static final int MAX_TITLE_LENGTH = 200;

    /**
     * 메모의 최대 길이
     */
    private static final int MAX_MEMO_LENGTH = 4000;

    /**
     * jOOQ 실행 문맥
     */
    private final DSLContext dsl;

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public List<EventView> events(UUID academyId, UUID viewerId, LocalDate from, LocalDate to) {
        // 기간이 겹치는 일정 가운데 팀 일정과 본인의 개인일정만
        var visible = WORKLOG_EVENT.KIND.eq(EventKind.TEAM.name()).or(WORKLOG_EVENT.OWNER_ACCOUNT_ID.eq(viewerId));
        return select(WORKLOG_EVENT.ACADEMY_ID.eq(academyId)
                .and(WORKLOG_EVENT.START_DATE.le(to))
                .and(WORKLOG_EVENT.END_DATE.ge(from))
                .and(visible));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public EventView event(UUID academyId, UUID eventId, UUID viewerId) {
        var event = find(academyId, eventId);
        if (event.kind() == EventKind.PERSONAL && !event.ownerAccountId().equals(viewerId)) {
            throw new WorklogForbiddenException("본인의 개인일정만 볼 수 있습니다.");
        }
        return event;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public EventView createTeamEvent(UUID academyId, UUID actorId, EventDraft draft) {
        return insert(academyId, EventKind.TEAM, null, actorId, draft, tagOf(academyId, draft.tagId()));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public EventView createPersonalEvent(UUID academyId, UUID ownerId, EventDraft draft) {
        return insert(academyId, EventKind.PERSONAL, ownerId, ownerId, draft, null);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public void updateTeamEvent(UUID academyId, UUID eventId, EventDraft draft) {
        requireTeam(find(academyId, eventId));
        update(eventId, draft, tagOf(academyId, draft.tagId()));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public void updatePersonalEvent(UUID academyId, UUID eventId, UUID ownerId, EventDraft draft) {
        requireOwn(find(academyId, eventId), ownerId);
        update(eventId, draft, null);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public void deleteTeamEvent(UUID academyId, UUID eventId) {
        requireTeam(find(academyId, eventId));
        dsl.deleteFrom(WORKLOG_EVENT).where(WORKLOG_EVENT.ID.eq(eventId)).execute();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public void deletePersonalEvent(UUID academyId, UUID eventId, UUID ownerId) {
        requireOwn(find(academyId, eventId), ownerId);
        dsl.deleteFrom(WORKLOG_EVENT).where(WORKLOG_EVENT.ID.eq(eventId)).execute();
    }

    /**
     * 일정 한 건 저장
     *
     * @param academyId 학원 ID
     * @param kind 일정 종류
     * @param ownerId 개인일정의 소유자. 팀 일정은 null
     * @param actorId 만드는 계정 ID
     * @param draft 입력
     * @param tagId 확인을 마친 태그 ID. 없으면 null
     * @return 만든 일정
     */
    private EventView insert(
            UUID academyId, EventKind kind, UUID ownerId, UUID actorId, EventDraft draft, UUID tagId) {
        requirePeriod(draft);
        var id = UUID.randomUUID();
        dsl.insertInto(WORKLOG_EVENT)
                .set(WORKLOG_EVENT.ID, id)
                .set(WORKLOG_EVENT.ACADEMY_ID, academyId)
                .set(WORKLOG_EVENT.KIND, kind.name())
                .set(WORKLOG_EVENT.OWNER_ACCOUNT_ID, ownerId)
                .set(WORKLOG_EVENT.TAG_ID, tagId)
                .set(WORKLOG_EVENT.TITLE, Texts.required(draft.title(), "일정 제목", MAX_TITLE_LENGTH))
                .set(WORKLOG_EVENT.MEMO, Texts.optional(draft.memo(), "메모", MAX_MEMO_LENGTH))
                .set(WORKLOG_EVENT.START_DATE, draft.startDate())
                .set(WORKLOG_EVENT.END_DATE, draft.endDate())
                .set(WORKLOG_EVENT.CREATED_BY, actorId)
                .set(WORKLOG_EVENT.CREATED_AT, OffsetDateTime.now())
                .execute();
        return find(academyId, id);
    }

    /**
     * 제목·메모·기간·태그 변경
     *
     * 종류와 소유자는 바꾸지 않음
     *
     * @param eventId 일정 ID
     * @param draft 입력
     * @param tagId 확인을 마친 태그 ID. 없으면 null
     */
    private void update(UUID eventId, EventDraft draft, UUID tagId) {
        requirePeriod(draft);
        dsl.update(WORKLOG_EVENT)
                .set(WORKLOG_EVENT.TITLE, Texts.required(draft.title(), "일정 제목", MAX_TITLE_LENGTH))
                .set(WORKLOG_EVENT.MEMO, Texts.optional(draft.memo(), "메모", MAX_MEMO_LENGTH))
                .set(WORKLOG_EVENT.START_DATE, draft.startDate())
                .set(WORKLOG_EVENT.END_DATE, draft.endDate())
                .set(WORKLOG_EVENT.TAG_ID, tagId)
                .where(WORKLOG_EVENT.ID.eq(eventId))
                .execute();
    }

    /**
     * 학원 안에서 일정 조회
     *
     * @param academyId 학원 ID
     * @param eventId 일정 ID
     * @return 일정
     * @throws WorklogNotFoundException 그 학원의 일정이 아닐 때
     */
    private EventView find(UUID academyId, UUID eventId) {
        return select(WORKLOG_EVENT.ID.eq(eventId).and(WORKLOG_EVENT.ACADEMY_ID.eq(academyId))).stream()
                .findFirst()
                .orElseThrow(() -> new WorklogNotFoundException("EVENT_NOT_FOUND", "일정을 찾을 수 없습니다."));
    }

    /**
     * 조건에 맞는 일정을 태그와 함께 시작일 순으로 조회
     *
     * @param condition 조건
     * @return 일정 목록
     */
    private List<EventView> select(Condition condition) {
        return dsl.select(WORKLOG_EVENT.fields())
                .select(WORKLOG_TAG.NAME, WORKLOG_TAG.COLOR, WORKLOG_TAG.EMOJI, WORKLOG_TAG.FIXED)
                .from(WORKLOG_EVENT)
                .leftJoin(WORKLOG_TAG)
                .on(WORKLOG_TAG.ID.eq(WORKLOG_EVENT.TAG_ID))
                .where(condition)
                .orderBy(WORKLOG_EVENT.START_DATE, WORKLOG_EVENT.END_DATE, WORKLOG_EVENT.CREATED_AT)
                .fetch(JooqTeamCalendar::toView);
    }

    /**
     * 조회한 행을 일정으로 변환
     *
     * @param record 일정과 태그 열이 담긴 행
     * @return 일정
     */
    private static EventView toView(Record record) {
        var tagId = record.get(WORKLOG_EVENT.TAG_ID);
        var tag = tagId == null
                ? null
                : new TagView(
                        tagId,
                        record.get(WORKLOG_TAG.NAME),
                        record.get(WORKLOG_TAG.COLOR),
                        record.get(WORKLOG_TAG.EMOJI),
                        record.get(WORKLOG_TAG.FIXED));
        return new EventView(
                record.get(WORKLOG_EVENT.ID),
                EventKind.valueOf(record.get(WORKLOG_EVENT.KIND)),
                record.get(WORKLOG_EVENT.OWNER_ACCOUNT_ID),
                tag,
                record.get(WORKLOG_EVENT.TITLE),
                record.get(WORKLOG_EVENT.MEMO),
                record.get(WORKLOG_EVENT.START_DATE),
                record.get(WORKLOG_EVENT.END_DATE));
    }

    /**
     * 팀 일정에 붙일 태그가 그 학원의 것인지 확인
     *
     * @param academyId 학원 ID
     * @param tagId 태그 ID. 없으면 null
     * @return 같은 태그 ID. 없으면 null
     * @throws WorklogValidationException 그 학원의 태그가 아닐 때
     */
    private UUID tagOf(UUID academyId, UUID tagId) {
        if (tagId == null) {
            return null;
        }
        if (!dsl.fetchExists(WORKLOG_TAG, WORKLOG_TAG.ID.eq(tagId).and(WORKLOG_TAG.ACADEMY_ID.eq(academyId)))) {
            throw new WorklogValidationException("EVENT_TAG_INVALID", "태그를 찾을 수 없습니다.");
        }
        return tagId;
    }

    /**
     * 기간이 있고 시작일이 종료일보다 늦지 않은지 확인
     *
     * @param draft 입력
     * @throws WorklogValidationException 날짜가 없거나 순서가 뒤집혔을 때
     */
    private static void requirePeriod(EventDraft draft) {
        if (draft.startDate() == null || draft.endDate() == null) {
            throw new WorklogValidationException("EVENT_PERIOD_REQUIRED", "시작일과 종료일을 입력해 주세요.");
        }
        if (draft.startDate().isAfter(draft.endDate())) {
            throw new WorklogValidationException("EVENT_PERIOD_INVALID", "종료일은 시작일보다 빠를 수 없습니다.");
        }
    }

    /**
     * 팀 일정인지 확인
     *
     * @param event 일정
     * @throws WorklogConflictException 개인일정일 때
     */
    private static void requireTeam(EventView event) {
        if (event.kind() != EventKind.TEAM) {
            throw new WorklogConflictException("EVENT_NOT_TEAM", "팀 일정이 아닙니다.");
        }
    }

    /**
     * 요청한 사람의 개인일정인지 확인
     *
     * @param event 일정
     * @param ownerId 요청한 계정 ID
     * @throws WorklogForbiddenException 본인의 개인일정이 아닐 때
     */
    private static void requireOwn(EventView event, UUID ownerId) {
        if (event.kind() != EventKind.PERSONAL || !ownerId.equals(event.ownerAccountId())) {
            throw new WorklogForbiddenException("본인의 개인일정만 고칠 수 있습니다.");
        }
    }
}
