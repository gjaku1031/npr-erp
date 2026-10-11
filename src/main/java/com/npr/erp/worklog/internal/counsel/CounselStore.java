package com.npr.erp.worklog.internal.counsel;

import com.npr.erp.worklog.CounselDelivery;
import com.npr.erp.worklog.CounselEntryView;
import com.npr.erp.worklog.WorklogForbiddenException;
import com.npr.erp.worklog.WorklogNotFoundException;
import com.npr.erp.worklog.internal.support.Texts;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 상담의 DB 쪽 처리
 *
 * 메서드 하나가 짧은 트랜잭션 하나임. 외부 시스템 호출은 여기서 하지 않고 호출자가 트랜잭션 사이에 함
 */
@Service
@RequiredArgsConstructor
public class CounselStore {
    /**
     * 주제의 최대 길이
     */
    private static final int MAX_SUBJECT_LENGTH = 200;

    /**
     * 내용의 최대 길이
     */
    private static final int MAX_CONTENT_LENGTH = 4000;

    /**
     * 상담 저장소
     */
    private final WorklogCounselEntryRepository repository;

    /**
     * 가져온 명단을 한 반의 상담 대상에 반영
     *
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @param roster 외부 시스템에서 가져온 명단
     * @return 반영한 뒤의 그 반 상담 대상
     */
    @Transactional
    public List<CounselEntryView> applyRoster(UUID taskId, UUID accountId, ClassRoster roster) {
        var classroom = roster.classroom();
        var existing = new HashMap<String, WorklogCounselEntryEntity>();
        for (var entry : repository.findAllByTaskIdAndAccountIdAndClassCodeOrderByStudentNameAsc(
                taskId, accountId, classroom.code())) {
            existing.put(entry.getStudentCode(), entry);
        }

        // 새 학생은 추가하고, 있던 학생은 이름과 연락처만 갱신
        var now = Instant.now();
        var seen = new HashSet<String>();
        for (var student : roster.students()) {
            seen.add(student.code());
            var entry = existing.get(student.code());
            if (entry == null) {
                repository.save(new WorklogCounselEntryEntity(taskId, accountId, classroom, student, now));
            } else {
                entry.refreshRoster(classroom, student, now);
            }
        }

        // 명단에서 빠진 학생은 보내기 전인 상담만 지움. 명단이 비어 왔으면 조회 실패일 수 있어 아무것도 지우지 않음
        if (!roster.students().isEmpty()) {
            for (var entry : existing.values()) {
                if (!seen.contains(entry.getStudentCode()) && entry.getDeliveryState() == CounselDelivery.IDLE) {
                    repository.delete(entry);
                }
            }
        }
        repository.flush();
        return repository
                .findAllByTaskIdAndAccountIdAndClassCodeOrderByStudentNameAsc(taskId, accountId, classroom.code())
                .stream()
                .map(WorklogCounselEntryEntity::toView)
                .toList();
    }

    /**
     * 담당자의 상담 대상 전체 조회
     *
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @return 반 이름, 학생 이름 순
     */
    @Transactional(readOnly = true)
    public List<CounselEntryView> entries(UUID taskId, UUID accountId) {
        return repository.findAllByTaskIdAndAccountIdOrderByClassNameAscStudentNameAsc(taskId, accountId).stream()
                .map(WorklogCounselEntryEntity::toView)
                .toList();
    }

    /**
     * 본인의 상담 한 건 조회
     *
     * @param entryId 상담 ID
     * @param accountId 담당자 계정 ID
     * @return 상담
     */
    @Transactional(readOnly = true)
    public CounselEntryView entry(UUID entryId, UUID accountId) {
        return owned(repository.findById(entryId).orElse(null), accountId).toView();
    }

    /**
     * 보내려 한 상담 날짜 조회
     *
     * @param entryId 상담 ID
     * @return 전송을 선점할 때 적은 날짜. 선점한 적이 없으면 null
     */
    @Transactional(readOnly = true)
    public LocalDate deliveryDate(UUID entryId) {
        return repository.findById(entryId).map(WorklogCounselEntryEntity::getDeliveryDate).orElse(null);
    }

    /**
     * 주제와 내용 저장
     *
     * @param entryId 상담 ID
     * @param accountId 담당자 계정 ID
     * @param subject 주제
     * @param content 내용
     * @return 저장한 상담
     */
    @Transactional
    public CounselEntryView saveDraft(UUID entryId, UUID accountId, String subject, String content) {
        var entry = lockedOwn(entryId, accountId);
        entry.writeDraft(
                Texts.optional(subject, "상담 주제", MAX_SUBJECT_LENGTH),
                Texts.optional(content, "상담 내용", MAX_CONTENT_LENGTH),
                Instant.now());
        return entry.toView();
    }

    /**
     * 내용을 저장하고 전송을 선점
     *
     * @param entryId 상담 ID
     * @param accountId 담당자 계정 ID
     * @param date 상담 날짜
     * @param subject 주제. 비울 수 없음
     * @param content 내용. 비울 수 없음
     * @return 전송 중으로 표시된 상담
     */
    @Transactional
    public CounselEntryView claim(UUID entryId, UUID accountId, LocalDate date, String subject, String content) {
        var entry = lockedOwn(entryId, accountId);
        var now = Instant.now();
        entry.writeDraft(
                Texts.required(subject, "상담 주제", MAX_SUBJECT_LENGTH),
                Texts.required(content, "상담 내용", MAX_CONTENT_LENGTH),
                now);
        entry.claimDelivery(date, now);
        return entry.toView();
    }

    /**
     * 전송 확정
     *
     * @param entryId 상담 ID
     * @param receipt 외부 시스템의 기록 번호. 대조로 확인한 경우는 null
     * @return 보낸 것으로 확정된 상담
     */
    @Transactional
    public CounselEntryView confirm(UUID entryId, String receipt) {
        var entry = locked(entryId);
        entry.confirmDelivery(receipt, Instant.now());
        return entry.toView();
    }

    /**
     * 전송 취소
     *
     * @param entryId 상담 ID
     * @return 보내기 전으로 돌아간 상담
     */
    @Transactional
    public CounselEntryView release(UUID entryId) {
        var entry = locked(entryId);
        entry.releaseDelivery(Instant.now());
        return entry.toView();
    }

    /**
     * 고정 명단을 상담 대상으로 한꺼번에 넣음
     *
     * 특강상담과 개인 상담일정을 만들 때 씀. 호출자의 트랜잭션에 참여함
     *
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @param rosters 반별 명단
     */
    @Transactional
    public void seed(UUID taskId, UUID accountId, List<ClassRoster> rosters) {
        var now = Instant.now();
        for (var roster : rosters) {
            for (var student : roster.students()) {
                repository.save(new WorklogCounselEntryEntity(taskId, accountId, roster.classroom(), student, now));
            }
        }
    }

    /**
     * 본인의 상담을 쓰기 잠금으로 가져옴
     *
     * @param entryId 상담 ID
     * @param accountId 담당자 계정 ID
     * @return 잠근 상담
     */
    private WorklogCounselEntryEntity lockedOwn(UUID entryId, UUID accountId) {
        return owned(repository.findLocked(entryId).orElse(null), accountId);
    }

    /**
     * 상담을 쓰기 잠금으로 가져옴
     *
     * @param entryId 상담 ID
     * @return 잠근 상담
     */
    private WorklogCounselEntryEntity locked(UUID entryId) {
        return repository.findLocked(entryId)
                .orElseThrow(() -> new WorklogNotFoundException("COUNSEL_NOT_FOUND", "상담을 찾을 수 없습니다."));
    }

    /**
     * 상담이 있고 요청한 사람의 것인지 확인
     *
     * @param entry 조회한 상담. 없으면 null
     * @param accountId 요청한 계정 ID
     * @return 같은 상담
     * @throws WorklogNotFoundException 상담이 없을 때
     * @throws WorklogForbiddenException 다른 사람의 상담일 때
     */
    private static WorklogCounselEntryEntity owned(WorklogCounselEntryEntity entry, UUID accountId) {
        if (entry == null) {
            throw new WorklogNotFoundException("COUNSEL_NOT_FOUND", "상담을 찾을 수 없습니다.");
        }
        if (!entry.getAccountId().equals(accountId)) {
            throw new WorklogForbiddenException("본인이 맡은 학생의 상담만 다룰 수 있습니다.");
        }
        return entry;
    }
}
