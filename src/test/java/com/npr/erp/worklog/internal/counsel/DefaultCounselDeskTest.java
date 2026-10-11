package com.npr.erp.worklog.internal.counsel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.npr.erp.tng.TngGateway;
import com.npr.erp.tng.TngGatewayException;
import com.npr.erp.worklog.CounselDelivery;
import com.npr.erp.worklog.CounselEntryView;
import com.npr.erp.worklog.StaffView;
import com.npr.erp.worklog.TaskKind;
import com.npr.erp.worklog.WorklogConflictException;
import com.npr.erp.worklog.WorklogStaffDirectory;
import com.npr.erp.worklog.internal.task.WorklogTaskEntity;
import com.npr.erp.worklog.internal.task.WorklogTaskRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * 외부 시스템 호출이 실패했을 때 상담의 전송 상태를 어떻게 남기는지 검사
 *
 * 가상 어댑터는 실패하지 않으므로 포트를 대역으로 바꿔 두 종류의 실패를 만듦
 */
class DefaultCounselDeskTest {
    /**
     * 학원 ID
     */
    private final UUID academyId = UUID.randomUUID();

    /**
     * 담당자 계정 ID
     */
    private final UUID accountId = UUID.randomUUID();

    /**
     * 상담 ID
     */
    private final UUID entryId = UUID.randomUUID();

    /**
     * 상담의 DB 쪽 처리 대역
     */
    private final CounselStore store = mock(CounselStore.class);

    /**
     * 외부 시스템 포트 대역
     */
    private final TngGateway gateway = mock(TngGateway.class);

    /**
     * 검사 대상
     */
    private DefaultCounselDesk desk;

    /**
     * 담당자가 직원 코드에 연결돼 있고 상담이 전송 중으로 선점되는 상황 준비
     */
    @BeforeEach
    void setUp() {
        var taskId = UUID.randomUUID();
        var task = mock(WorklogTaskEntity.class);
        when(task.getKind()).thenReturn(TaskKind.COUNSEL);
        var tasks = mock(WorklogTaskRepository.class);
        when(tasks.findByIdAndAcademyId(taskId, academyId)).thenReturn(Optional.of(task));
        var staff = mock(WorklogStaffDirectory.class);
        when(staff.staff(academyId, accountId)).thenReturn(new StaffView(academyId, accountId, "S01", List.of(), null));
        var entry = new CounselEntryView(
                entryId,
                taskId,
                accountId,
                "C11",
                "초4 M1",
                "N00001",
                "가하늘",
                "",
                "주제",
                "내용",
                CounselDelivery.PENDING,
                null);
        when(store.entry(entryId, accountId)).thenReturn(entry);
        when(store.claim(any(), any(), any(), any(), any())).thenReturn(entry);
        desk = new DefaultCounselDesk(store, tasks, staff, gateway);
    }

    /**
     * 외부 시스템이 처리하지 않은 것이 확실하면 보내기 전으로 되돌리는지 확인
     */
    @Test
    void releasesWhenExternalSystemRejected() {
        when(gateway.postCounsel(any(), any(), any(), any(), any()))
                .thenThrow(new TngGatewayException("학생을 찾을 수 없음", true));

        assertThatThrownBy(() -> desk.send(academyId, entryId, accountId, LocalDate.now(), "주제", "내용"))
                .isInstanceOfSatisfying(WorklogConflictException.class, failure -> assertThat(failure.getCode())
                        .isEqualTo("COUNSEL_SEND_FAILED"));
        verify(store).release(entryId);
    }

    /**
     * 응답을 받지 못해 결과를 모르면 전송 중으로 둬서 다시 보낼 수 없게 하는지 확인
     */
    @Test
    void keepsPendingWhenOutcomeIsUnknown() {
        when(gateway.postCounsel(any(), any(), any(), any(), any())).thenThrow(new TngGatewayException("응답 없음"));

        assertThatThrownBy(() -> desk.send(academyId, entryId, accountId, LocalDate.now(), "주제", "내용"))
                .isInstanceOfSatisfying(WorklogConflictException.class, failure -> assertThat(failure.getCode())
                        .isEqualTo("COUNSEL_OUTCOME_UNKNOWN"));
        verify(store, never()).release(any());
        verify(store, never()).confirm(any(), any());
    }
}
