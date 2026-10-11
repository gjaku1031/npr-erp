package com.npr.erp.worklog;

import com.npr.erp.tng.TngDayGroup;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 업무 배정과 처리 계약
 *
 * 누가 배정 후보인지는 이 모듈이 정하지 않음. 호출자가 그때그때 권한 원장에서 구한 후보 집합을 넘기며, 전원 배정
 * 업무의 담당자는 조회할 때의 후보 집합으로 계산함. 권한을 잃은 사람은 다음 조회부터 담당자에서 빠짐
 */
public interface TaskBoard {
    /**
     * 첨부 파일 하나의 최대 크기: 4MB
     */
    int MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

    /**
     * 업무 생성
     *
     * 특강상담은 이때의 담당자와 특강 반 학생 명단을 고정함
     *
     * @param academyId 학원 ID
     * @param actorId 만드는 계정 ID
     * @param draft 입력
     * @param assignableIds 지금의 배정 후보
     * @return 만든 업무
     * @throws WorklogValidationException 입력이 규칙에 맞지 않거나 후보가 아닌 사람을 골랐을 때
     */
    TaskView create(UUID academyId, UUID actorId, TaskDraft draft, Set<UUID> assignableIds);

    /**
     * 업무 수정
     *
     * 종류는 바꿀 수 없고, 특강상담은 담당자도 바꿀 수 없음
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param draft 입력
     * @param assignableIds 지금의 배정 후보
     * @return 고친 업무
     */
    TaskView update(UUID academyId, UUID taskId, TaskDraft draft, Set<UUID> assignableIds);

    /**
     * 공용 업무 삭제
     *
     * 담당자별 상태, 첨부, 상담 내용이 함께 지워짐
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @throws WorklogNotFoundException 없거나 개인 상담일정일 때. 개인 상담일정은 만든 사람만 지움
     */
    void delete(UUID academyId, UUID taskId);

    /**
     * 본인이 만든 개인 상담일정 삭제
     *
     * @param academyId 학원 ID
     * @param taskId 상담일정 ID
     * @param ownerId 요청한 계정 ID
     * @throws WorklogForbiddenException 본인이 만든 상담일정이 아닐 때
     */
    void deleteSelfCounsel(UUID academyId, UUID taskId, UUID ownerId);

    /**
     * 업무 보관 또는 보관 해제
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param archived 보관할지
     */
    void setArchived(UUID academyId, UUID taskId, boolean archived);

    /**
     * 공용 업무 전체와 담당자 전원의 진행
     *
     * 개인 상담일정은 포함하지 않음
     *
     * @param academyId 학원 ID
     * @param assignableIds 지금의 배정 후보
     * @return 시작일, 마감일 순
     */
    List<TaskView> allTasks(UUID academyId, Set<UUID> assignableIds);

    /**
     * 한 사람이 담당자인 공용 업무
     *
     * 다른 담당자의 보고와 첨부는 가리고 본인의 진행만 담음
     *
     * @param academyId 학원 ID
     * @param accountId 담당자 계정 ID
     * @param assignableIds 지금의 배정 후보
     * @return 시작일, 마감일 순
     */
    List<TaskView> tasksOf(UUID academyId, UUID accountId, Set<UUID> assignableIds);

    /**
     * 한 사람이 만든 개인 상담일정
     *
     * @param academyId 학원 ID
     * @param ownerId 소유자 계정 ID
     * @return 시작일, 마감일 순
     */
    List<TaskView> selfCounselTasks(UUID academyId, UUID ownerId);

    /**
     * 공용 업무 하나와 담당자 전원의 진행
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param assignableIds 지금의 배정 후보
     * @return 업무
     * @throws WorklogNotFoundException 그 학원의 업무가 아니거나 개인 상담일정일 때
     */
    TaskView task(UUID academyId, UUID taskId, Set<UUID> assignableIds);

    /**
     * 개인 상담일정 생성
     *
     * 소유자의 담당 반 전체의 학생 명단을 상담 대상으로 넣음
     *
     * @param academyId 학원 ID
     * @param ownerId 소유자 계정 ID
     * @param title 이름
     * @param startDate 시작일
     * @param dueDate 마감일
     * @return 만든 상담일정
     * @throws WorklogConflictException 담당 반을 아직 가져오지 않았을 때
     */
    TaskView createSelfCounsel(
            UUID academyId, UUID ownerId, String title, LocalDate startDate, LocalDate dueDate);

    /**
     * 일반 업무를 완료 또는 미완료로 표시
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @param assignableIds 지금의 배정 후보
     * @param done 완료로 표시할지
     * @throws WorklogForbiddenException 담당자가 아닐 때
     * @throws WorklogValidationException 완료 조건(텍스트 보고, 첨부)을 채우지 못했을 때
     * @throws WorklogConflictException 일반 업무가 아닐 때
     */
    void markStatus(UUID academyId, UUID taskId, UUID accountId, Set<UUID> assignableIds, boolean done);

    /**
     * MT 업무의 요일 묶음 하나를 체크하거나 해제
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @param assignableIds 지금의 배정 후보
     * @param part 월수금 또는 화목토
     * @param done 체크할지
     */
    void toggleMt(
            UUID academyId, UUID taskId, UUID accountId, Set<UUID> assignableIds, TngDayGroup part, boolean done);

    /**
     * 텍스트 보고 저장
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @param assignableIds 지금의 배정 후보
     * @param text 보고 내용
     */
    void saveReport(UUID academyId, UUID taskId, UUID accountId, Set<UUID> assignableIds, String text);

    /**
     * 보고에 파일 첨부
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @param assignableIds 지금의 배정 후보
     * @param fileName 파일 이름
     * @param mediaType 미디어 타입
     * @param content 본문. 4MB 이하
     * @return 첨부 정보
     */
    AttachmentView attach(
            UUID academyId,
            UUID taskId,
            UUID accountId,
            Set<UUID> assignableIds,
            String fileName,
            String mediaType,
            byte[] content);

    /**
     * 본인이 올린 첨부 삭제
     *
     * @param academyId 학원 ID
     * @param attachmentId 첨부 ID
     * @param accountId 올린 계정 ID
     * @throws WorklogForbiddenException 본인이 올린 첨부가 아닐 때
     * @throws WorklogConflictException 제출한 일일보고의 첨부이거나, 완료한 업무의 완료 조건인 마지막 첨부일 때
     */
    void removeAttachment(UUID academyId, UUID attachmentId, UUID accountId);

    /**
     * 첨부 본문 조회
     *
     * 누가 볼 수 있는지는 확인하지 않음. 호출자가 올린 본인이거나 검토 권한이 있는지 먼저 확인해야 함
     *
     * @param academyId 학원 ID
     * @param attachmentId 첨부 ID
     * @return 파일 정보와 본문
     */
    AttachmentContent attachment(UUID academyId, UUID attachmentId);
}
