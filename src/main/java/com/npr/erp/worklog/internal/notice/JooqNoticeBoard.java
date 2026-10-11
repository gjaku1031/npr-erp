package com.npr.erp.worklog.internal.notice;

import static com.npr.generated.jooq.Tables.WORKLOG_NOTICE;

import com.npr.erp.worklog.NoticeBoard;
import com.npr.erp.worklog.NoticeView;
import com.npr.erp.worklog.WorkCalendar;
import com.npr.erp.worklog.WorklogNotFoundException;
import com.npr.erp.worklog.internal.support.Texts;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link NoticeBoard} 구현
 */
@Service
@RequiredArgsConstructor
public class JooqNoticeBoard implements NoticeBoard {
    /**
     * 본문의 최대 길이
     */
    private static final int MAX_BODY_LENGTH = 4000;

    /**
     * jOOQ 실행 문맥
     */
    private final DSLContext dsl;

    /**
     * 날짜 기준
     */
    private final WorkCalendar calendar;

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public List<NoticeView> notices(UUID academyId) {
        return fetch(WORKLOG_NOTICE.ACADEMY_ID.eq(academyId));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public List<NoticeView> activeNotices(UUID academyId) {
        return fetch(WORKLOG_NOTICE.ACADEMY_ID.eq(academyId).and(WORKLOG_NOTICE.ACTIVE.isTrue()));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public NoticeView create(UUID academyId, UUID authorId, String body) {
        var text = Texts.required(body, "공지 내용", MAX_BODY_LENGTH);
        // 가장 작은 순서보다 하나 앞에 두어 목록의 맨 위에 놓음
        var first = dsl.select(DSL.coalesce(DSL.min(WORKLOG_NOTICE.SORT_ORDER), 0))
                .from(WORKLOG_NOTICE)
                .where(WORKLOG_NOTICE.ACADEMY_ID.eq(academyId))
                .fetchOne(0, int.class);
        var view = new NoticeView(UUID.randomUUID(), text, true, authorId, calendar.today());
        dsl.insertInto(WORKLOG_NOTICE)
                .set(WORKLOG_NOTICE.ID, view.id())
                .set(WORKLOG_NOTICE.ACADEMY_ID, academyId)
                .set(WORKLOG_NOTICE.BODY, view.body())
                .set(WORKLOG_NOTICE.ACTIVE, true)
                .set(WORKLOG_NOTICE.AUTHOR_ACCOUNT_ID, authorId)
                .set(WORKLOG_NOTICE.POSTED_ON, view.postedOn())
                .set(WORKLOG_NOTICE.SORT_ORDER, first - 1)
                .execute();
        return view;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public void update(UUID academyId, UUID noticeId, String body) {
        var changed = dsl.update(WORKLOG_NOTICE)
                .set(WORKLOG_NOTICE.BODY, Texts.required(body, "공지 내용", MAX_BODY_LENGTH))
                .where(one(academyId, noticeId))
                .execute();
        requireFound(changed);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public void setActive(UUID academyId, UUID noticeId, boolean active) {
        requireFound(dsl.update(WORKLOG_NOTICE)
                .set(WORKLOG_NOTICE.ACTIVE, active)
                .where(one(academyId, noticeId))
                .execute());
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public void delete(UUID academyId, UUID noticeId) {
        requireFound(dsl.deleteFrom(WORKLOG_NOTICE).where(one(academyId, noticeId)).execute());
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public void move(UUID academyId, UUID noticeId, boolean up) {
        var ordered = new ArrayList<>(dsl.select(WORKLOG_NOTICE.ID)
                .from(WORKLOG_NOTICE)
                .where(WORKLOG_NOTICE.ACADEMY_ID.eq(academyId))
                .orderBy(WORKLOG_NOTICE.SORT_ORDER, WORKLOG_NOTICE.ID)
                .forUpdate()
                .fetch(WORKLOG_NOTICE.ID));
        var index = ordered.indexOf(noticeId);
        if (index < 0) {
            throw notFound();
        }
        var target = up ? index - 1 : index + 1;
        if (target < 0 || target >= ordered.size()) {
            return;
        }
        ordered.set(index, ordered.get(target));
        ordered.set(target, noticeId);

        // 목록 순서대로 0부터 다시 매김
        for (var position = 0; position < ordered.size(); position++) {
            dsl.update(WORKLOG_NOTICE)
                    .set(WORKLOG_NOTICE.SORT_ORDER, position)
                    .where(WORKLOG_NOTICE.ID.eq(ordered.get(position)))
                    .execute();
        }
    }

    /**
     * 조건에 맞는 공지를 노출 순서대로 조회
     *
     * @param condition 조건
     * @return 공지 목록
     */
    private List<NoticeView> fetch(Condition condition) {
        return dsl.select(
                        WORKLOG_NOTICE.ID,
                        WORKLOG_NOTICE.BODY,
                        WORKLOG_NOTICE.ACTIVE,
                        WORKLOG_NOTICE.AUTHOR_ACCOUNT_ID,
                        WORKLOG_NOTICE.POSTED_ON)
                .from(WORKLOG_NOTICE)
                .where(condition)
                .orderBy(WORKLOG_NOTICE.SORT_ORDER, WORKLOG_NOTICE.ID)
                .fetch(record -> new NoticeView(
                        record.value1(), record.value2(), record.value3(), record.value4(), record.value5()));
    }

    /**
     * 학원 안의 공지 한 건을 가리키는 조건
     *
     * @param academyId 학원 ID
     * @param noticeId 공지 ID
     * @return 조건
     */
    private static Condition one(UUID academyId, UUID noticeId) {
        return WORKLOG_NOTICE.ID.eq(noticeId).and(WORKLOG_NOTICE.ACADEMY_ID.eq(academyId));
    }

    /**
     * 바뀐 행이 있는지 확인
     *
     * @param affected 바뀐 행 수
     * @throws WorklogNotFoundException 바뀐 행이 없을 때
     */
    private static void requireFound(int affected) {
        if (affected == 0) {
            throw notFound();
        }
    }

    /**
     * 공지를 찾지 못했을 때의 예외
     *
     * @return 예외
     */
    private static WorklogNotFoundException notFound() {
        return new WorklogNotFoundException("NOTICE_NOT_FOUND", "공지를 찾을 수 없습니다.");
    }
}
