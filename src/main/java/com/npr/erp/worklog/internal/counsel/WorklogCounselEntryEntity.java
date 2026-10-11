package com.npr.erp.worklog.internal.counsel;

import com.npr.erp.tng.TngClassroom;
import com.npr.erp.tng.TngStudent;
import com.npr.erp.worklog.CounselDelivery;
import com.npr.erp.worklog.CounselEntryView;
import com.npr.erp.worklog.WorklogConflictException;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;

/**
 * 상담 업무에서 학생 한 명에 대한 상담
 */
@Getter
@Entity(name = "WorklogCounselEntry")
@Table(name = "worklog_counsel_entry")
public class WorklogCounselEntryEntity {
    /**
     * 상담 ID
     */
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * 업무 ID
     */
    @Column(name = "task_id", nullable = false, updatable = false)
    private UUID taskId;

    /**
     * 담당자 계정 ID
     */
    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    /**
     * 반 코드
     */
    @Column(name = "class_code", nullable = false, updatable = false, length = 32)
    private String classCode;

    /**
     * 반 이름
     */
    @Column(name = "class_name", nullable = false, length = 120)
    private String className;

    /**
     * 학번
     */
    @Column(name = "student_code", nullable = false, updatable = false, length = 32)
    private String studentCode;

    /**
     * 학생 이름
     */
    @Column(name = "student_name", nullable = false, length = 120)
    private String studentName;

    /**
     * 어머니 연락처
     */
    @Column(name = "mother_phone", nullable = false, length = 40)
    private String motherPhone;

    /**
     * 주제
     */
    @Column(name = "subject", nullable = false, length = 200)
    private String subject;

    /**
     * 내용
     */
    @Column(name = "content", nullable = false)
    private String content;

    /**
     * 전송 상태
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "delivery_state", nullable = false, length = 16)
    private CounselDelivery deliveryState;

    /**
     * 보내려 한 상담 날짜. 결과 확인에 씀
     */
    @Column(name = "delivery_date")
    private LocalDate deliveryDate;

    /**
     * 전송을 확인한 시각
     */
    @Column(name = "sent_at")
    private Instant sentAt;

    /**
     * 외부 시스템이 돌려준 기록 번호
     */
    @Column(name = "receipt_id", length = 64)
    private String receiptId;

    /**
     * 수정 시각
     */
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /**
     * JPA 인스턴스 초기화
     */
    protected WorklogCounselEntryEntity() {
    }

    /**
     * 주제와 내용이 빈 새 상담 대상 생성
     *
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @param classroom 반
     * @param student 학생
     * @param now 생성 시각
     */
    public WorklogCounselEntryEntity(
            UUID taskId, UUID accountId, TngClassroom classroom, TngStudent student, Instant now) {
        this.id = UUID.randomUUID();
        this.taskId = taskId;
        this.accountId = accountId;
        this.classCode = classroom.code();
        this.className = classroom.name();
        this.studentCode = student.code();
        this.studentName = student.name();
        this.motherPhone = student.motherPhone();
        this.subject = "";
        this.content = "";
        this.deliveryState = CounselDelivery.IDLE;
        this.updatedAt = now;
    }

    /**
     * 다시 가져온 명단의 이름과 연락처 반영
     *
     * 주제, 내용, 전송 상태는 건드리지 않음
     *
     * @param classroom 반
     * @param student 학생
     * @param now 변경 시각
     */
    public void refreshRoster(TngClassroom classroom, TngStudent student, Instant now) {
        this.className = classroom.name();
        this.studentName = student.name();
        this.motherPhone = student.motherPhone();
        this.updatedAt = now;
    }

    /**
     * 주제와 내용 저장
     *
     * @param newSubject 주제
     * @param newContent 내용
     * @param now 변경 시각
     * @throws WorklogConflictException 보내기 전 상태가 아닐 때
     */
    public void writeDraft(String newSubject, String newContent, Instant now) {
        requireIdle();
        this.subject = newSubject;
        this.content = newContent;
        this.updatedAt = now;
    }

    /**
     * 전송 선점: IDLE → PENDING
     *
     * 이 표시가 커밋된 뒤에야 외부 시스템에 씀. 같은 상담을 동시에 보내려는 두 번째 요청은 여기서 막힘
     *
     * @param date 상담 날짜
     * @param now 변경 시각
     * @throws WorklogConflictException 보내기 전 상태가 아닐 때
     */
    public void claimDelivery(LocalDate date, Instant now) {
        requireIdle();
        this.deliveryState = CounselDelivery.PENDING;
        this.deliveryDate = date;
        this.updatedAt = now;
    }

    /**
     * 전송 확정: PENDING → SENT
     *
     * @param receipt 외부 시스템의 기록 번호. 대조로 확인한 경우는 null
     * @param now 확인 시각
     */
    public void confirmDelivery(String receipt, Instant now) {
        requirePending();
        this.deliveryState = CounselDelivery.SENT;
        this.receiptId = receipt;
        this.sentAt = now;
        this.updatedAt = now;
    }

    /**
     * 전송 취소: PENDING → IDLE
     *
     * 외부 시스템에 기록되지 않은 것이 확실할 때만 부름
     *
     * @param now 변경 시각
     */
    public void releaseDelivery(Instant now) {
        requirePending();
        this.deliveryState = CounselDelivery.IDLE;
        this.deliveryDate = null;
        this.updatedAt = now;
    }

    /**
     * 공개 조회 결과로 변환
     *
     * @return 상담 조회 결과
     */
    public CounselEntryView toView() {
        return new CounselEntryView(
                id,
                taskId,
                accountId,
                classCode,
                className,
                studentCode,
                studentName,
                motherPhone,
                subject,
                content,
                deliveryState,
                sentAt);
    }

    /**
     * 보내기 전 상태인지 확인
     *
     * @throws WorklogConflictException 이미 보냈거나 결과 확인이 필요할 때
     */
    private void requireIdle() {
        if (deliveryState == CounselDelivery.SENT) {
            throw new WorklogConflictException("COUNSEL_ALREADY_SENT", "이미 보낸 상담입니다.");
        }
        if (deliveryState == CounselDelivery.PENDING) {
            throw new WorklogConflictException("COUNSEL_DELIVERY_PENDING", "전송 결과를 먼저 확인해 주세요.");
        }
    }

    /**
     * 전송 중 상태인지 확인
     *
     * @throws WorklogConflictException 전송 중이 아닐 때
     */
    private void requirePending() {
        if (deliveryState != CounselDelivery.PENDING) {
            throw new WorklogConflictException("COUNSEL_NOT_PENDING", "전송 중인 상담이 아닙니다.");
        }
    }
}
