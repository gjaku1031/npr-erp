package com.npr.erp.worklog.internal.journal;

import static com.npr.generated.jooq.Tables.WORKLOG_DAILY_REPORT;
import static com.npr.generated.jooq.Tables.WORKLOG_JOURNAL;
import static com.npr.generated.jooq.Tables.WORKLOG_JOURNAL_ITEM;
import static com.npr.generated.jooq.Tables.WORKLOG_SETTING;

import com.npr.erp.worklog.JournalDesk;
import com.npr.erp.worklog.JournalItemView;
import com.npr.erp.worklog.JournalPhase;
import com.npr.erp.worklog.JournalSummary;
import com.npr.erp.worklog.JournalView;
import com.npr.erp.worklog.WorkCalendar;
import com.npr.erp.worklog.WorklogConflictException;
import com.npr.erp.worklog.WorklogNotFoundException;
import com.npr.erp.worklog.WorklogSettingView;
import com.npr.erp.worklog.WorklogValidationException;
import com.npr.erp.worklog.internal.support.Texts;
import com.npr.erp.worklog.internal.task.AttachmentStore;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link JournalDesk} 구현
 *
 * 일일보고 정의와 항목은 상태 전이가 없는 행 단위 자료여서 엔티티를 두지 않고 jOOQ로 직접 읽고 씀
 */
@Service
@RequiredArgsConstructor
public class JooqJournalDesk implements JournalDesk {
    /**
     * 항목 내용의 최대 길이
     */
    private static final int MAX_ITEM_LENGTH = 300;

    /**
     * jOOQ 실행 문맥
     */
    private final DSLContext dsl;

    /**
     * 날짜 기준
     */
    private final WorkCalendar calendar;

    /**
     * 첨부 저장
     */
    private final AttachmentStore attachmentStore;

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public Optional<JournalView> journal(UUID academyId, LocalDate date) {
        return dsl.select(WORKLOG_JOURNAL.SPECIAL_PERIOD)
                .from(WORKLOG_JOURNAL)
                .where(journalKey(academyId, date))
                .fetchOptional(record ->
                        new JournalView(date, record.value1(), items(academyId, date), phaseOf(date)));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public List<JournalSummary> journals(UUID academyId, Set<UUID> reporterIds) {
        var itemCounts = new HashMap<LocalDate, Integer>();
        dsl.select(WORKLOG_JOURNAL_ITEM.REPORT_DATE, DSL.count())
                .from(WORKLOG_JOURNAL_ITEM)
                .where(WORKLOG_JOURNAL_ITEM.ACADEMY_ID.eq(academyId))
                .groupBy(WORKLOG_JOURNAL_ITEM.REPORT_DATE)
                .forEach(record -> itemCounts.put(record.value1(), record.value2()));

        // 제출 수는 지금의 보고 대상만 셈. 대상에서 빠진 사람이 예전에 낸 보고는 분자에 넣지 않음
        var confirmedCount = DSL.count().filterWhere(WORKLOG_DAILY_REPORT.CONFIRMED.isTrue());
        var submitted = new HashMap<LocalDate, Integer>();
        var confirmed = new HashMap<LocalDate, Integer>();
        dsl.select(WORKLOG_DAILY_REPORT.REPORT_DATE, DSL.count(), confirmedCount)
                .from(WORKLOG_DAILY_REPORT)
                .where(WORKLOG_DAILY_REPORT.ACADEMY_ID.eq(academyId)
                        .and(WORKLOG_DAILY_REPORT.STATUS.eq("SUBMITTED"))
                        .and(WORKLOG_DAILY_REPORT.ACCOUNT_ID.in(reporterIds)))
                .groupBy(WORKLOG_DAILY_REPORT.REPORT_DATE)
                .forEach(record -> {
                    submitted.put(record.value1(), record.value2());
                    confirmed.put(record.value1(), record.value3());
                });

        return dsl.select(WORKLOG_JOURNAL.REPORT_DATE, WORKLOG_JOURNAL.SPECIAL_PERIOD)
                .from(WORKLOG_JOURNAL)
                .where(WORKLOG_JOURNAL.ACADEMY_ID.eq(academyId))
                .orderBy(WORKLOG_JOURNAL.REPORT_DATE.desc())
                .fetch(record -> new JournalSummary(
                        record.value1(),
                        record.value2(),
                        itemCounts.getOrDefault(record.value1(), 0),
                        submitted.getOrDefault(record.value1(), 0),
                        confirmed.getOrDefault(record.value1(), 0),
                        phaseOf(record.value1())));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public JournalView create(UUID academyId, UUID actorId, LocalDate date) {
        if (date == null) {
            throw new WorklogValidationException("JOURNAL_DATE_REQUIRED", "날짜를 골라 주세요.");
        }

        // 복사할 항목: 오늘 것, 없으면 대상 날짜 이전의 가장 최근 것
        var template = items(academyId, calendar.today());
        if (template.isEmpty()) {
            var latest = dsl.select(DSL.max(WORKLOG_JOURNAL.REPORT_DATE))
                    .from(WORKLOG_JOURNAL)
                    .where(WORKLOG_JOURNAL.ACADEMY_ID.eq(academyId).and(WORKLOG_JOURNAL.REPORT_DATE.lt(date)))
                    .fetchOne(0, LocalDate.class);
            template = latest == null ? List.of() : items(academyId, latest);
        }

        // 같은 날짜를 동시에 만들면 한쪽만 들어가고, 다른 쪽은 이미 있는 것을 돌려줌
        var inserted = dsl.insertInto(WORKLOG_JOURNAL)
                .set(WORKLOG_JOURNAL.ACADEMY_ID, academyId)
                .set(WORKLOG_JOURNAL.REPORT_DATE, date)
                .set(WORKLOG_JOURNAL.SPECIAL_PERIOD, settings(academyId).specialPeriod())
                .set(WORKLOG_JOURNAL.CREATED_BY, actorId)
                .set(WORKLOG_JOURNAL.CREATED_AT, OffsetDateTime.now())
                .onConflictDoNothing()
                .execute();
        if (inserted == 1) {
            var order = 0;
            for (var item : template) {
                insertItem(academyId, date, item.text(), item.required(), order++);
            }
        }
        return journal(academyId, date).orElseThrow();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public void delete(UUID academyId, LocalDate date) {
        // 보고의 첨부는 외래 키가 없어 직접 지움. 항목과 보고는 연쇄 삭제됨
        attachmentStore.deleteForReportDate(academyId, date);
        dsl.deleteFrom(WORKLOG_JOURNAL).where(journalKey(academyId, date)).execute();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public JournalView addItem(UUID academyId, LocalDate date, String text, boolean required) {
        requireEditable(date);
        if (!dsl.fetchExists(WORKLOG_JOURNAL, journalKey(academyId, date))) {
            throw new WorklogNotFoundException("JOURNAL_NOT_FOUND", "그 날짜의 일일보고가 없습니다.");
        }
        var nextOrder = dsl.select(DSL.coalesce(DSL.max(WORKLOG_JOURNAL_ITEM.SORT_ORDER), -1))
                        .from(WORKLOG_JOURNAL_ITEM)
                        .where(itemsOf(academyId, date))
                        .fetchOne(0, int.class)
                + 1;
        insertItem(academyId, date, Texts.required(text, "항목 내용", MAX_ITEM_LENGTH), required, nextOrder);
        return journal(academyId, date).orElseThrow();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public void removeItem(UUID academyId, UUID itemId) {
        requireEditable(dateOfItem(academyId, itemId));
        // 항목에 붙은 첨부는 외래 키가 없어 직접 지움
        attachmentStore.deleteForItem(itemId);
        dsl.deleteFrom(WORKLOG_JOURNAL_ITEM).where(WORKLOG_JOURNAL_ITEM.ID.eq(itemId)).execute();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public void setRequired(UUID academyId, UUID itemId, boolean required) {
        requireEditable(dateOfItem(academyId, itemId));
        dsl.update(WORKLOG_JOURNAL_ITEM)
                .set(WORKLOG_JOURNAL_ITEM.REQUIRED, required)
                .where(WORKLOG_JOURNAL_ITEM.ID.eq(itemId))
                .execute();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public WorklogSettingView settings(UUID academyId) {
        return dsl.select(
                        WORKLOG_SETTING.WEEKLY_TEST_MWF, WORKLOG_SETTING.WEEKLY_TEST_TTS, WORKLOG_SETTING.SPECIAL_PERIOD)
                .from(WORKLOG_SETTING)
                .where(WORKLOG_SETTING.ACADEMY_ID.eq(academyId))
                .fetchOptional(record -> new WorklogSettingView(record.value1(), record.value2(), record.value3()))
                .orElseGet(() -> new WorklogSettingView(null, null, false));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public WorklogSettingView updateSettings(
            UUID academyId, LocalDate weeklyTestMwf, LocalDate weeklyTestTts, boolean specialPeriod) {
        var now = OffsetDateTime.now();
        dsl.insertInto(WORKLOG_SETTING)
                .set(WORKLOG_SETTING.ACADEMY_ID, academyId)
                .set(WORKLOG_SETTING.WEEKLY_TEST_MWF, weeklyTestMwf)
                .set(WORKLOG_SETTING.WEEKLY_TEST_TTS, weeklyTestTts)
                .set(WORKLOG_SETTING.SPECIAL_PERIOD, specialPeriod)
                .set(WORKLOG_SETTING.UPDATED_AT, now)
                .onConflict(WORKLOG_SETTING.ACADEMY_ID)
                .doUpdate()
                .set(WORKLOG_SETTING.WEEKLY_TEST_MWF, weeklyTestMwf)
                .set(WORKLOG_SETTING.WEEKLY_TEST_TTS, weeklyTestTts)
                .set(WORKLOG_SETTING.SPECIAL_PERIOD, specialPeriod)
                .set(WORKLOG_SETTING.UPDATED_AT, now)
                .execute();
        return new WorklogSettingView(weeklyTestMwf, weeklyTestTts, specialPeriod);
    }

    /**
     * 한 날짜의 항목을 정렬 순서대로 조회
     *
     * @param academyId 학원 ID
     * @param date 날짜
     * @return 항목 목록
     */
    private List<JournalItemView> items(UUID academyId, LocalDate date) {
        return dsl.select(WORKLOG_JOURNAL_ITEM.ID, WORKLOG_JOURNAL_ITEM.TEXT, WORKLOG_JOURNAL_ITEM.REQUIRED)
                .from(WORKLOG_JOURNAL_ITEM)
                .where(itemsOf(academyId, date))
                .orderBy(WORKLOG_JOURNAL_ITEM.SORT_ORDER)
                .fetch(record -> new JournalItemView(record.value1(), record.value2(), record.value3()));
    }

    /**
     * 항목 한 건 저장
     *
     * @param academyId 학원 ID
     * @param date 날짜
     * @param text 내용
     * @param required 확인 결과를 꼭 적어야 하는지
     * @param sortOrder 정렬 순서
     */
    private void insertItem(UUID academyId, LocalDate date, String text, boolean required, int sortOrder) {
        dsl.insertInto(WORKLOG_JOURNAL_ITEM)
                .set(WORKLOG_JOURNAL_ITEM.ID, UUID.randomUUID())
                .set(WORKLOG_JOURNAL_ITEM.ACADEMY_ID, academyId)
                .set(WORKLOG_JOURNAL_ITEM.REPORT_DATE, date)
                .set(WORKLOG_JOURNAL_ITEM.TEXT, text)
                .set(WORKLOG_JOURNAL_ITEM.REQUIRED, required)
                .set(WORKLOG_JOURNAL_ITEM.SORT_ORDER, sortOrder)
                .execute();
    }

    /**
     * 항목이 속한 날짜 조회
     *
     * @param academyId 학원 ID
     * @param itemId 항목 ID
     * @return 날짜
     * @throws WorklogNotFoundException 그 학원의 항목이 아닐 때
     */
    private LocalDate dateOfItem(UUID academyId, UUID itemId) {
        return dsl.select(WORKLOG_JOURNAL_ITEM.REPORT_DATE)
                .from(WORKLOG_JOURNAL_ITEM)
                .where(WORKLOG_JOURNAL_ITEM.ID.eq(itemId).and(WORKLOG_JOURNAL_ITEM.ACADEMY_ID.eq(academyId)))
                .fetchOptional(WORKLOG_JOURNAL_ITEM.REPORT_DATE)
                .orElseThrow(() -> new WorklogNotFoundException("JOURNAL_ITEM_NOT_FOUND", "항목을 찾을 수 없습니다."));
    }

    /**
     * 지난 날짜가 아닌지 확인
     *
     * @param date 날짜
     * @throws WorklogConflictException 지난 날짜일 때
     */
    private void requireEditable(LocalDate date) {
        if (phaseOf(date) == JournalPhase.PAST) {
            throw new WorklogConflictException("JOURNAL_PAST", "지난 날짜의 일일보고는 고칠 수 없습니다.");
        }
    }

    /**
     * 오늘을 기준으로 날짜의 시기 판정
     *
     * @param date 날짜
     * @return 지난 날짜, 오늘, 앞으로 올 날짜 중 하나
     */
    private JournalPhase phaseOf(LocalDate date) {
        var today = calendar.today();
        if (date.isBefore(today)) {
            return JournalPhase.PAST;
        }
        return date.equals(today) ? JournalPhase.TODAY : JournalPhase.UPCOMING;
    }

    /**
     * 일일보고 한 건을 가리키는 조건
     *
     * @param academyId 학원 ID
     * @param date 날짜
     * @return 조건
     */
    private static Condition journalKey(UUID academyId, LocalDate date) {
        return WORKLOG_JOURNAL.ACADEMY_ID.eq(academyId).and(WORKLOG_JOURNAL.REPORT_DATE.eq(date));
    }

    /**
     * 한 날짜의 항목을 가리키는 조건
     *
     * @param academyId 학원 ID
     * @param date 날짜
     * @return 조건
     */
    private static Condition itemsOf(UUID academyId, LocalDate date) {
        return WORKLOG_JOURNAL_ITEM.ACADEMY_ID.eq(academyId).and(WORKLOG_JOURNAL_ITEM.REPORT_DATE.eq(date));
    }
}
