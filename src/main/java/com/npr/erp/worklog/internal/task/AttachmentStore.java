package com.npr.erp.worklog.internal.task;

import static com.npr.generated.jooq.Tables.WORKLOG_ATTACHMENT;
import static com.npr.generated.jooq.Tables.WORKLOG_DAILY_REPORT;

import com.npr.erp.worklog.AttachmentContent;
import com.npr.erp.worklog.AttachmentView;
import com.npr.erp.worklog.TaskBoard;
import com.npr.erp.worklog.WorklogNotFoundException;
import com.npr.erp.worklog.WorklogValidationException;
import com.npr.erp.worklog.internal.support.Texts;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/**
 * 첨부 파일 저장
 *
 * 목록을 읽을 때 본문까지 메모리에 올리지 않도록 JPA 엔티티로 두지 않고, 필요한 열만 골라 읽음
 */
@Repository
@RequiredArgsConstructor
public class AttachmentStore {
    /**
     * 파일 하나의 최대 크기
     */
    public static final int MAX_BYTES = TaskBoard.MAX_ATTACHMENT_BYTES;

    /**
     * 파일 이름의 최대 길이
     */
    private static final int MAX_FILE_NAME_LENGTH = 200;

    /**
     * 미디어 타입을 알 수 없을 때의 기본값
     */
    private static final String DEFAULT_MEDIA_TYPE = "application/octet-stream";

    /**
     * jOOQ 실행 문맥
     */
    private final DSLContext dsl;

    /**
     * 업무 보고의 첨부 저장
     *
     * @param academyId 학원 ID
     * @param ownerId 올린 계정 ID
     * @param taskId 업무 ID
     * @param fileName 파일 이름
     * @param mediaType 미디어 타입
     * @param content 본문
     * @return 저장한 첨부의 정보
     */
    public AttachmentView saveForTask(
            UUID academyId, UUID ownerId, UUID taskId, String fileName, String mediaType, byte[] content) {
        return save(academyId, ownerId, taskId, null, null, fileName, mediaType, content);
    }

    /**
     * 일일보고 체크리스트 항목의 첨부 저장
     *
     * @param academyId 학원 ID
     * @param ownerId 올린 계정 ID
     * @param reportDate 보고 날짜
     * @param journalItemId 체크리스트 항목 ID
     * @param fileName 파일 이름
     * @param mediaType 미디어 타입
     * @param content 본문
     * @return 저장한 첨부의 정보
     */
    public AttachmentView saveForChecklist(
            UUID academyId,
            UUID ownerId,
            LocalDate reportDate,
            UUID journalItemId,
            String fileName,
            String mediaType,
            byte[] content) {
        return save(academyId, ownerId, null, reportDate, journalItemId, fileName, mediaType, content);
    }

    /**
     * 여러 업무의 첨부 정보를 한 번에 조회
     *
     * @param taskIds 업무 ID 목록
     * @return 업무 ID와 첨부 정보의 쌍. 올린 순서
     */
    public List<TaskAttachment> listForTasks(Collection<UUID> taskIds) {
        if (taskIds.isEmpty()) {
            return List.of();
        }
        return dsl.select(metadataFields())
                .from(WORKLOG_ATTACHMENT)
                .where(WORKLOG_ATTACHMENT.TASK_ID.in(taskIds))
                .orderBy(WORKLOG_ATTACHMENT.CREATED_AT)
                .fetch(record -> new TaskAttachment(record.get(WORKLOG_ATTACHMENT.TASK_ID), toView(record)));
    }

    /**
     * 한 사람이 한 날짜의 체크리스트에 올린 첨부 정보 조회
     *
     * @param academyId 학원 ID
     * @param ownerId 올린 계정 ID
     * @param reportDate 보고 날짜
     * @return 항목 ID와 첨부 정보의 쌍. 올린 순서
     */
    public List<ChecklistAttachment> listForChecklist(UUID academyId, UUID ownerId, LocalDate reportDate) {
        return dsl.select(metadataFields())
                .select(WORKLOG_ATTACHMENT.JOURNAL_ITEM_ID)
                .from(WORKLOG_ATTACHMENT)
                .where(WORKLOG_ATTACHMENT.ACADEMY_ID.eq(academyId)
                        .and(WORKLOG_ATTACHMENT.OWNER_ACCOUNT_ID.eq(ownerId))
                        .and(WORKLOG_ATTACHMENT.REPORT_DATE.eq(reportDate)))
                .orderBy(WORKLOG_ATTACHMENT.CREATED_AT)
                .fetch(record -> new ChecklistAttachment(
                        record.get(WORKLOG_ATTACHMENT.JOURNAL_ITEM_ID), toView(record)));
    }

    /**
     * 한 사람이 한 업무에 올린 첨부 수
     *
     * @param taskId 업무 ID
     * @param ownerId 올린 계정 ID
     * @return 첨부 수
     */
    public int countForTask(UUID taskId, UUID ownerId) {
        return dsl.fetchCount(
                WORKLOG_ATTACHMENT,
                WORKLOG_ATTACHMENT.TASK_ID.eq(taskId).and(WORKLOG_ATTACHMENT.OWNER_ACCOUNT_ID.eq(ownerId)));
    }

    /**
     * 첨부 정보 조회
     *
     * @param academyId 학원 ID
     * @param attachmentId 첨부 ID
     * @return 그 학원의 첨부가 아니면 빈 값
     */
    public Optional<AttachmentView> find(UUID academyId, UUID attachmentId) {
        return dsl.select(metadataFields())
                .from(WORKLOG_ATTACHMENT)
                .where(WORKLOG_ATTACHMENT.ID.eq(attachmentId).and(WORKLOG_ATTACHMENT.ACADEMY_ID.eq(academyId)))
                .fetchOptional(AttachmentStore::toView);
    }

    /**
     * 첨부 본문까지 조회
     *
     * @param academyId 학원 ID
     * @param attachmentId 첨부 ID
     * @return 파일 정보와 본문
     * @throws WorklogNotFoundException 그 학원의 첨부가 아닐 때
     */
    public AttachmentContent load(UUID academyId, UUID attachmentId) {
        return dsl.select(metadataFields())
                .select(WORKLOG_ATTACHMENT.CONTENT)
                .from(WORKLOG_ATTACHMENT)
                .where(WORKLOG_ATTACHMENT.ID.eq(attachmentId).and(WORKLOG_ATTACHMENT.ACADEMY_ID.eq(academyId)))
                .fetchOptional(record -> new AttachmentContent(toView(record), record.get(WORKLOG_ATTACHMENT.CONTENT)))
                .orElseThrow(() -> new WorklogNotFoundException("ATTACHMENT_NOT_FOUND", "첨부 파일을 찾을 수 없습니다."));
    }

    /**
     * 첨부 삭제
     *
     * @param attachmentId 첨부 ID
     */
    public void delete(UUID attachmentId) {
        dsl.deleteFrom(WORKLOG_ATTACHMENT).where(WORKLOG_ATTACHMENT.ID.eq(attachmentId)).execute();
    }

    /**
     * 체크리스트 항목 하나에 붙은 첨부를 모두 삭제
     *
     * @param journalItemId 체크리스트 항목 ID
     */
    public void deleteForItem(UUID journalItemId) {
        dsl.deleteFrom(WORKLOG_ATTACHMENT).where(WORKLOG_ATTACHMENT.JOURNAL_ITEM_ID.eq(journalItemId)).execute();
    }

    /**
     * 체크리스트 첨부가 이미 제출한 일일보고의 것인지 확인
     *
     * @param attachmentId 첨부 ID
     * @return 올린 사람이 그 날짜의 보고를 제출한 상태이면 true
     */
    public boolean belongsToSubmittedReport(UUID attachmentId) {
        return dsl.fetchExists(dsl.selectOne()
                .from(WORKLOG_ATTACHMENT)
                .join(WORKLOG_DAILY_REPORT)
                .on(WORKLOG_DAILY_REPORT.ACADEMY_ID.eq(WORKLOG_ATTACHMENT.ACADEMY_ID)
                        .and(WORKLOG_DAILY_REPORT.ACCOUNT_ID.eq(WORKLOG_ATTACHMENT.OWNER_ACCOUNT_ID))
                        .and(WORKLOG_DAILY_REPORT.REPORT_DATE.eq(WORKLOG_ATTACHMENT.REPORT_DATE)))
                .where(WORKLOG_ATTACHMENT.ID.eq(attachmentId).and(WORKLOG_DAILY_REPORT.STATUS.eq("SUBMITTED"))));
    }

    /**
     * 한 날짜의 체크리스트 첨부를 모두 삭제
     *
     * @param academyId 학원 ID
     * @param reportDate 보고 날짜
     */
    public void deleteForReportDate(UUID academyId, LocalDate reportDate) {
        dsl.deleteFrom(WORKLOG_ATTACHMENT)
                .where(WORKLOG_ATTACHMENT.ACADEMY_ID.eq(academyId).and(WORKLOG_ATTACHMENT.REPORT_DATE.eq(reportDate)))
                .execute();
    }

    /**
     * 크기와 이름을 확인하고 첨부 한 건 저장
     *
     * @param academyId 학원 ID
     * @param ownerId 올린 계정 ID
     * @param taskId 업무 ID. 체크리스트 첨부이면 null
     * @param reportDate 보고 날짜. 업무 첨부이면 null
     * @param journalItemId 체크리스트 항목 ID. 업무 첨부이면 null
     * @param fileName 파일 이름
     * @param mediaType 미디어 타입
     * @param content 본문
     * @return 저장한 첨부의 정보
     * @throws WorklogValidationException 비었거나 4MB를 넘을 때
     */
    private AttachmentView save(
            UUID academyId,
            UUID ownerId,
            UUID taskId,
            LocalDate reportDate,
            UUID journalItemId,
            String fileName,
            String mediaType,
            byte[] content) {
        if (content == null || content.length == 0) {
            throw new WorklogValidationException("ATTACHMENT_EMPTY", "빈 파일은 첨부할 수 없습니다.");
        }
        if (content.length > MAX_BYTES) {
            throw new WorklogValidationException("ATTACHMENT_TOO_LARGE", "첨부 파일은 4MB 이하여야 합니다.");
        }
        // 브라우저가 경로까지 보내는 경우가 있어 마지막 조각만 이름으로 씀
        var baseName = fileName == null ? "" : fileName.replace('\\', '/');
        baseName = baseName.substring(baseName.lastIndexOf('/') + 1);
        var name = Texts.required(baseName, "파일 이름", MAX_FILE_NAME_LENGTH);
        var type = mediaType == null || mediaType.isBlank() ? DEFAULT_MEDIA_TYPE : mediaType.strip();

        var id = UUID.randomUUID();
        dsl.insertInto(WORKLOG_ATTACHMENT)
                .set(WORKLOG_ATTACHMENT.ID, id)
                .set(WORKLOG_ATTACHMENT.ACADEMY_ID, academyId)
                .set(WORKLOG_ATTACHMENT.OWNER_ACCOUNT_ID, ownerId)
                .set(WORKLOG_ATTACHMENT.TASK_ID, taskId)
                .set(WORKLOG_ATTACHMENT.REPORT_DATE, reportDate)
                .set(WORKLOG_ATTACHMENT.JOURNAL_ITEM_ID, journalItemId)
                .set(WORKLOG_ATTACHMENT.FILE_NAME, name)
                .set(WORKLOG_ATTACHMENT.MEDIA_TYPE, type)
                .set(WORKLOG_ATTACHMENT.SIZE_BYTES, (long) content.length)
                .set(WORKLOG_ATTACHMENT.CONTENT, content)
                .set(WORKLOG_ATTACHMENT.CREATED_AT, OffsetDateTime.now())
                .execute();
        return new AttachmentView(id, ownerId, taskId, name, type, content.length);
    }

    /**
     * 본문을 뺀 정보 열 목록
     *
     * @return 조회할 열
     */
    private static List<Field<?>> metadataFields() {
        return List.of(
                WORKLOG_ATTACHMENT.ID,
                WORKLOG_ATTACHMENT.OWNER_ACCOUNT_ID,
                WORKLOG_ATTACHMENT.TASK_ID,
                WORKLOG_ATTACHMENT.FILE_NAME,
                WORKLOG_ATTACHMENT.MEDIA_TYPE,
                WORKLOG_ATTACHMENT.SIZE_BYTES);
    }

    /**
     * 조회한 행을 첨부 정보로 변환
     *
     * @param record 정보 열이 담긴 행
     * @return 첨부 정보
     */
    private static AttachmentView toView(Record record) {
        return new AttachmentView(
                record.get(WORKLOG_ATTACHMENT.ID),
                record.get(WORKLOG_ATTACHMENT.OWNER_ACCOUNT_ID),
                record.get(WORKLOG_ATTACHMENT.TASK_ID),
                record.get(WORKLOG_ATTACHMENT.FILE_NAME),
                record.get(WORKLOG_ATTACHMENT.MEDIA_TYPE),
                record.get(WORKLOG_ATTACHMENT.SIZE_BYTES));
    }

    /**
     * 업무에 붙은 첨부
     *
     * @param taskId 업무 ID
     * @param attachment 첨부 정보
     */
    public record TaskAttachment(UUID taskId, AttachmentView attachment) {
    }

    /**
     * 체크리스트 항목에 붙은 첨부
     *
     * @param journalItemId 체크리스트 항목 ID
     * @param attachment 첨부 정보
     */
    public record ChecklistAttachment(UUID journalItemId, AttachmentView attachment) {
    }
}
