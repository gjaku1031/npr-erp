package com.npr.erp.worklog.internal.report;

import com.npr.erp.tng.TngClassroom;
import com.npr.erp.tng.TngGateway;
import com.npr.erp.worklog.AttachmentView;
import com.npr.erp.worklog.ChecklistAnswer;
import com.npr.erp.worklog.DailyReportView;
import com.npr.erp.worklog.DailyReports;
import com.npr.erp.worklog.JournalDesk;
import com.npr.erp.worklog.JournalView;
import com.npr.erp.worklog.NotebookMark;
import com.npr.erp.worklog.ReportBoardEntry;
import com.npr.erp.worklog.ReportInput;
import com.npr.erp.worklog.ReportPayload;
import com.npr.erp.worklog.ReportState;
import com.npr.erp.worklog.ReportStatus;
import com.npr.erp.worklog.TaskBoard;
import com.npr.erp.worklog.TaskKind;
import com.npr.erp.worklog.TaskMark;
import com.npr.erp.worklog.TaskProgress;
import com.npr.erp.worklog.TaskView;
import com.npr.erp.worklog.WizardGate;
import com.npr.erp.worklog.WizardView;
import com.npr.erp.worklog.WorklogConflictException;
import com.npr.erp.worklog.WorklogNotFoundException;
import com.npr.erp.worklog.WorklogStaffDirectory;
import com.npr.erp.worklog.WorklogValidationException;
import com.npr.erp.worklog.internal.support.Texts;
import com.npr.erp.worklog.internal.task.AttachmentStore;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * {@link DailyReports} 구현
 *
 * 이 클래스의 메서드는 트랜잭션이 아님. 외부 시스템에서 알림장을 읽는 일을 DB 트랜잭션 밖에서 하기 위함이며, DB
 * 변경은 {@link DailyReportStore}의 짧은 트랜잭션에 넘김
 */
@Service
@RequiredArgsConstructor
public class DefaultDailyReports implements DailyReports {
    /**
     * 확인 결과의 최대 길이
     */
    private static final int MAX_NOTE_LENGTH = 2000;

    /**
     * 일일보고의 DB 쪽 처리
     */
    private final DailyReportStore store;

    /**
     * 일일보고 정의
     */
    private final JournalDesk journalDesk;

    /**
     * 업무 원장
     */
    private final TaskBoard taskBoard;

    /**
     * 직원 설정
     */
    private final WorklogStaffDirectory staffDirectory;

    /**
     * 첨부 저장
     */
    private final AttachmentStore attachmentStore;

    /**
     * 외부 시스템 포트
     */
    private final TngGateway tngGateway;

    /**
     * {@inheritDoc}
     */
    @Override
    public WizardView wizard(UUID academyId, UUID accountId, LocalDate date, Set<UUID> assignableIds) {
        var journal = requireJournal(academyId, date);
        var report = store.find(academyId, accountId, date).orElse(null);
        var payload = report == null ? ReportPayload.empty() : report.payload();
        var submitted = report != null && report.status() == ReportStatus.SUBMITTED;

        // 제출한 보고는 그때 적어 둔 반과 알림장을 그대로 보여 주고, 작성 중이면 지금의 사실을 읽음
        List<TngClassroom> classrooms;
        List<NotebookMark> notebooks;
        if (submitted) {
            classrooms = payload.classrooms();
            notebooks = payload.notebooks();
        } else {
            classrooms = staffDirectory.staff(academyId, accountId).classroomsOn(date, journal.specialPeriod());
            notebooks = readNotebooks(classrooms, date);
        }
        var tasks = taskBoard.tasksOf(academyId, accountId, assignableIds).stream()
                .filter(task -> !task.archived() && task.activeOn(date))
                .toList();
        return new WizardView(
                journal,
                report,
                payload,
                checklistFiles(academyId, accountId, date),
                classrooms,
                notebooks,
                tasks,
                gateOf(journal, payload, classrooms, notebooks, tasks, accountId),
                !submitted);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void saveDraft(UUID academyId, UUID accountId, LocalDate date, ReportInput input) {
        var journal = requireJournal(academyId, date);

        // 그 날짜의 항목에 대한 답만 남기고 길이를 확인
        var answers = new LinkedHashMap<UUID, ChecklistAnswer>();
        var given = input.checklist() == null ? Map.<UUID, ChecklistAnswer>of() : input.checklist();
        for (var item : journal.items()) {
            var answer = given.get(item.id());
            if (answer != null) {
                answers.put(
                        item.id(),
                        new ChecklistAnswer(answer.checked(), Texts.optional(answer.note(), "확인 결과", MAX_NOTE_LENGTH)));
            }
        }
        store.saveDraft(
                academyId,
                accountId,
                date,
                current -> new ReportPayload(
                        answers,
                        input.counselChecked(),
                        input.attendanceChecked(),
                        current.specialPeriod(),
                        current.classrooms(),
                        current.notebooks(),
                        current.tasks()));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public DailyReportView submit(UUID academyId, UUID accountId, LocalDate date, Set<UUID> assignableIds) {
        var wizard = wizard(academyId, accountId, date, assignableIds);
        if (!wizard.editable()) {
            throw new WorklogConflictException("REPORT_SUBMITTED", "이미 제출한 보고입니다.");
        }
        if (!wizard.gate().complete()) {
            throw new WorklogValidationException(
                    "REPORT_GATE_OPEN", "아직 마치지 않은 단계가 있습니다: " + String.join(", ", wizard.gate().openSteps()));
        }

        // 제출하는 순간의 반, 알림장, 업무 상태를 보고에 적어 둠
        var marks = new ArrayList<TaskMark>();
        for (var task : wizard.tasks()) {
            var status = task.progressOf(accountId).map(progress -> progress.status()).orElse(TaskProgress.NONE);
            marks.add(new TaskMark(task.id(), task.title(), task.kind(), status));
        }
        var payload = new ReportPayload(
                wizard.payload().checklist(),
                wizard.payload().counselChecked(),
                wizard.payload().attendanceChecked(),
                wizard.journal().specialPeriod(),
                wizard.classrooms(),
                wizard.notebooks(),
                marks);
        return store.submit(academyId, accountId, date, payload);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void reopen(UUID academyId, UUID accountId, LocalDate date) {
        store.reopen(academyId, accountId, date);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public void confirm(UUID academyId, UUID accountId, LocalDate date, UUID reviewerId) {
        store.confirm(academyId, accountId, date, reviewerId);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public Optional<DailyReportView> report(UUID academyId, UUID accountId, LocalDate date) {
        return store.find(academyId, accountId, date);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public Map<UUID, List<AttachmentView>> checklistFiles(UUID academyId, UUID accountId, LocalDate date) {
        var files = new HashMap<UUID, List<AttachmentView>>();
        for (var item : attachmentStore.listForChecklist(academyId, accountId, date)) {
            files.computeIfAbsent(item.journalItemId(), ignored -> new ArrayList<>()).add(item.attachment());
        }
        return files;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<ReportBoardEntry> board(UUID academyId, LocalDate date, Set<UUID> reporterIds) {
        var states = new HashMap<UUID, ReportState>();
        for (var report : store.findAll(academyId, date, reporterIds)) {
            states.put(report.accountId(), report.state());
        }
        var entries = new ArrayList<ReportBoardEntry>();
        for (var accountId : new TreeSet<>(reporterIds)) {
            entries.add(new ReportBoardEntry(accountId, states.getOrDefault(accountId, ReportState.NOT_SUBMITTED)));
        }
        return entries;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<DailyReportView> history(UUID academyId, UUID accountId) {
        return store.history(academyId, accountId);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public AttachmentView attachChecklistFile(
            UUID academyId,
            UUID accountId,
            LocalDate date,
            UUID itemId,
            String fileName,
            String mediaType,
            byte[] content) {
        var journal = requireJournal(academyId, date);
        if (journal.items().stream().noneMatch(item -> item.id().equals(itemId))) {
            throw new WorklogNotFoundException("JOURNAL_ITEM_NOT_FOUND", "항목을 찾을 수 없습니다.");
        }
        var submitted = store.find(academyId, accountId, date)
                .filter(report -> report.status() == ReportStatus.SUBMITTED)
                .isPresent();
        if (submitted) {
            throw new WorklogConflictException("REPORT_SUBMITTED", "이미 제출한 보고입니다. 고치려면 제출을 되돌려 주세요.");
        }
        return attachmentStore.saveForChecklist(academyId, accountId, date, itemId, fileName, mediaType, content);
    }

    /**
     * 그 날짜의 일일보고 정의 조회
     *
     * @param academyId 학원 ID
     * @param date 날짜
     * @return 일일보고 정의
     * @throws WorklogNotFoundException 아직 만들어지지 않았을 때
     */
    private JournalView requireJournal(UUID academyId, LocalDate date) {
        return journalDesk.journal(academyId, date)
                .orElseThrow(() -> new WorklogNotFoundException(
                        "JOURNAL_NOT_FOUND", "이 날짜의 일일보고가 아직 만들어지지 않았습니다."));
    }

    /**
     * 외부 시스템에서 반별 알림장 게시 여부를 읽음
     *
     * @param classrooms 반 목록
     * @param date 날짜
     * @return 반별 게시 여부
     */
    private List<NotebookMark> readNotebooks(List<TngClassroom> classrooms, LocalDate date) {
        var marks = new ArrayList<NotebookMark>();
        for (var classroom : classrooms) {
            var notebook = tngGateway.notebook(classroom.code(), date);
            marks.add(new NotebookMark(
                    classroom.code(),
                    classroom.name(),
                    notebook.isPresent(),
                    notebook.map(found -> found.title()).orElse("")));
        }
        return marks;
    }

    /**
     * 다섯 단계의 완료 여부 계산
     *
     * @param journal 일일보고 정의
     * @param payload 저장한 내용
     * @param classrooms 그날 처리할 반
     * @param notebooks 반별 알림장 게시 여부
     * @param tasks 그날이 기간에 드는 본인 업무
     * @param accountId 작성자 계정 ID
     * @return 단계별 완료 여부
     */
    private static WizardGate gateOf(
            JournalView journal,
            ReportPayload payload,
            List<TngClassroom> classrooms,
            List<NotebookMark> notebooks,
            List<TaskView> tasks,
            UUID accountId) {
        // 1단계: 항목이 있고, 전부 체크했고, 필수 항목에는 확인 결과가 있음
        var checklist = !journal.items().isEmpty();
        for (var item : journal.items()) {
            var answer = payload.answerOf(item.id());
            if (!answer.checked() || item.required() && answer.note().isBlank()) {
                checklist = false;
            }
        }

        // 2단계: 담당 반이 없는 사람은 막히지 않게 통과시킴
        var notebook = classrooms.isEmpty() || notebooks.stream().allMatch(NotebookMark::written);

        // 5단계: 직접 표시하는 일반 업무만 봄. MT와 상담 업무는 제출을 막지 않음
        var tasksMarked = true;
        for (var task : tasks) {
            var status = task.progressOf(accountId).map(progress -> progress.status()).orElse(TaskProgress.NONE);
            if (task.kind() == TaskKind.GENERAL && status == TaskProgress.NONE) {
                tasksMarked = false;
            }
        }
        return new WizardGate(checklist, notebook, payload.counselChecked(), payload.attendanceChecked(), tasksMarked);
    }
}
