package com.npr.erp.worklog.internal.counsel;

import com.npr.erp.tng.TngClassKind;
import com.npr.erp.tng.TngClassroom;
import com.npr.erp.tng.TngGateway;
import com.npr.erp.tng.TngGatewayException;
import com.npr.erp.worklog.CounselDelivery;
import com.npr.erp.worklog.CounselDesk;
import com.npr.erp.worklog.CounselEntryView;
import com.npr.erp.worklog.StaffView;
import com.npr.erp.worklog.TaskKind;
import com.npr.erp.worklog.WorklogConflictException;
import com.npr.erp.worklog.WorklogForbiddenException;
import com.npr.erp.worklog.WorklogNotFoundException;
import com.npr.erp.worklog.WorklogStaffDirectory;
import com.npr.erp.worklog.internal.task.WorklogTaskEntity;
import com.npr.erp.worklog.internal.task.WorklogTaskRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * {@link CounselDesk} 구현
 *
 * 이 클래스의 메서드는 트랜잭션이 아님. 외부 시스템 호출을 {@link CounselStore}의 짧은 트랜잭션들 사이에 둠
 */
@Service
@RequiredArgsConstructor
public class DefaultCounselDesk implements CounselDesk {
    /**
     * 상담의 DB 쪽 처리
     */
    private final CounselStore store;

    /**
     * 업무 저장소
     */
    private final WorklogTaskRepository taskRepository;

    /**
     * 직원 설정
     */
    private final WorklogStaffDirectory staffDirectory;

    /**
     * 외부 시스템 포트
     */
    private final TngGateway tngGateway;

    /**
     * {@inheritDoc}
     */
    @Override
    public List<TngClassroom> rosterClassrooms(UUID academyId, UUID taskId, UUID accountId) {
        var task = counselTask(academyId, taskId, accountId);
        var staff = staffDirectory.staff(academyId, accountId);
        return switch (task.getKind()) {
            case COUNSEL -> staff.classroomsOf(TngClassKind.REGULAR);
            case SELF_COUNSEL -> staff.classrooms();
            default -> List.of();
        };
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<CounselEntryView> syncRoster(UUID academyId, UUID taskId, UUID accountId, String classCode) {
        var task = counselTask(academyId, taskId, accountId);
        if (task.getKind() == TaskKind.SPECIAL_COUNSEL) {
            throw new WorklogConflictException("COUNSEL_ROSTER_FIXED", "특강상담의 명단은 업무를 만들 때 고정됩니다.");
        }
        var classroom = rosterClassrooms(academyId, taskId, accountId).stream()
                .filter(candidate -> candidate.code().equals(classCode))
                .findFirst()
                .orElseThrow(() -> new WorklogForbiddenException("담당 반의 명단만 가져올 수 있습니다."));

        // 명단은 트랜잭션 밖에서 읽고, 반영만 트랜잭션으로 함
        var roster = new ClassRoster(classroom, tngGateway.students(classroom.code()));
        return store.applyRoster(taskId, accountId, roster);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public List<CounselEntryView> entries(UUID academyId, UUID taskId, UUID accountId) {
        counselTask(academyId, taskId, accountId);
        return store.entries(taskId, accountId);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public CounselEntryView saveDraft(UUID academyId, UUID entryId, UUID accountId, String subject, String content) {
        requireInAcademy(academyId, entryId, accountId);
        return store.saveDraft(entryId, accountId, subject, content);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public CounselEntryView send(
            UUID academyId, UUID entryId, UUID accountId, LocalDate date, String subject, String content) {
        requireInAcademy(academyId, entryId, accountId);
        var staffCode = requireStaffCode(staffDirectory.staff(academyId, accountId));

        // 1. 내용 저장과 전송 선점을 커밋. 이 뒤로는 같은 상담을 다시 보낼 수 없음
        var claimed = store.claim(entryId, accountId, date, subject, content);
        try {
            // 2. 트랜잭션 밖에서 외부 시스템에 씀
            var receipt = tngGateway.postCounsel(
                    staffCode, claimed.studentCode(), date, claimed.subject(), claimed.content());
            // 3. 성공을 확정. 여기서 프로세스가 끝나면 전송 중으로 남아 대조 절차로 정리함
            return store.confirm(entryId, receipt);
        } catch (TngGatewayException failure) {
            if (failure.isRejected()) {
                // 외부 시스템이 처리하지 않은 것이 확실하므로 되돌림
                store.release(entryId);
                throw new WorklogConflictException(
                        "COUNSEL_SEND_FAILED", "상담을 보내지 못했습니다: " + failure.getMessage());
            }
            // 응답을 받지 못했으면 기록됐을 수도 있음. 전송 중으로 둬서 다시 보내기 전에 대조를 거치게 함
            throw new WorklogConflictException(
                    "COUNSEL_OUTCOME_UNKNOWN", "전송 결과를 확인하지 못했습니다. 외부 기록과 대조해 주세요.");
        }
    }

    /**
     * {@inheritDoc}
     */
    @Override
    public CounselEntryView resolvePending(UUID academyId, UUID entryId, UUID accountId) {
        requireInAcademy(academyId, entryId, accountId);
        var entry = store.entry(entryId, accountId);
        if (entry.delivery() != CounselDelivery.PENDING) {
            return entry;
        }
        var staffCode = requireStaffCode(staffDirectory.staff(academyId, accountId));
        var deliveryDate = store.deliveryDate(entryId);

        // 같은 학생·주제·내용의 기록이 외부 시스템에 있으면 이미 보낸 것
        var recorded = tngGateway.counsels(staffCode, deliveryDate).stream()
                .anyMatch(record -> record.studentCode().equals(entry.studentCode())
                        && record.topic().equals(entry.subject())
                        && record.content().equals(entry.content()));
        return recorded ? store.confirm(entryId, null) : store.release(entryId);
    }

    /**
     * 요청한 사람이 담당자인 상담 업무인지 확인
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param accountId 요청한 계정 ID
     * @return 업무
     * @throws WorklogNotFoundException 그 학원의 업무가 아닐 때
     * @throws WorklogConflictException 상담 업무가 아닐 때
     * @throws WorklogForbiddenException 개인 상담일정의 소유자가 아닐 때
     */
    private WorklogTaskEntity counselTask(UUID academyId, UUID taskId, UUID accountId) {
        var task = taskRepository.findByIdAndAcademyId(taskId, academyId)
                .orElseThrow(() -> new WorklogNotFoundException("TASK_NOT_FOUND", "업무를 찾을 수 없습니다."));
        if (!task.getKind().counsel()) {
            throw new WorklogConflictException("TASK_NOT_COUNSEL", "상담 업무가 아닙니다.");
        }
        if (task.getKind() == TaskKind.SELF_COUNSEL && !accountId.equals(task.getOwnerAccountId())) {
            throw new WorklogForbiddenException("본인이 만든 상담일정만 다룰 수 있습니다.");
        }
        return task;
    }

    /**
     * 상담이 요청한 학원의 업무에 속하는지 확인
     *
     * @param academyId 학원 ID
     * @param entryId 상담 ID
     * @param accountId 요청한 계정 ID
     */
    private void requireInAcademy(UUID academyId, UUID entryId, UUID accountId) {
        var entry = store.entry(entryId, accountId);
        counselTask(academyId, entry.taskId(), accountId);
    }

    /**
     * 외부 시스템 직원 코드가 연결돼 있는지 확인
     *
     * @param staff 직원 설정
     * @return 직원 코드
     * @throws WorklogConflictException 연결 전일 때
     */
    private static String requireStaffCode(StaffView staff) {
        if (staff.tngStaffCode() == null) {
            throw new WorklogConflictException("TNG_STAFF_NOT_LINKED", "외부 시스템 직원 코드가 연결되지 않아 보낼 수 없습니다.");
        }
        return staff.tngStaffCode();
    }
}
