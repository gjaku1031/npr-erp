package com.npr.erp.worklog;

import com.npr.erp.tng.TngClassroom;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 상담 업무의 명단과 전송 계약
 *
 * 모든 메서드는 요청한 계정이 그 업무의 담당자이고 그 상담의 주인인지 확인함
 */
public interface CounselDesk {
    /**
     * 이 업무에서 명단을 가져올 수 있는 반
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @return 전체 상담은 정규 담당 반, 개인 상담일정은 전체 담당 반, 특강상담은 빈 목록(명단이 고정됨)
     */
    List<TngClassroom> rosterClassrooms(UUID academyId, UUID taskId, UUID accountId);

    /**
     * 외부 시스템에서 한 반의 학생 명단을 가져와 상담 대상에 반영
     *
     * 새 학생은 추가하고 이름과 연락처는 갱신함. 써 둔 주제와 내용은 남김. 명단에서 빠진 학생은 보내기 전인 상담만
     * 지우되, 가져온 명단이 비어 있으면 아무것도 지우지 않음
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @param classCode 반 코드
     * @return 그 반의 상담 대상
     * @throws WorklogForbiddenException 담당 반이 아닐 때
     * @throws WorklogConflictException 명단이 고정된 특강상담일 때
     */
    List<CounselEntryView> syncRoster(UUID academyId, UUID taskId, UUID accountId, String classCode);

    /**
     * 담당자의 상담 대상 전체
     *
     * @param academyId 학원 ID
     * @param taskId 업무 ID
     * @param accountId 담당자 계정 ID
     * @return 반 이름, 학생 이름 순
     */
    List<CounselEntryView> entries(UUID academyId, UUID taskId, UUID accountId);

    /**
     * 주제와 내용 저장
     *
     * @param academyId 학원 ID
     * @param entryId 상담 ID
     * @param accountId 담당자 계정 ID
     * @param subject 주제
     * @param content 내용
     * @return 저장한 상담
     * @throws WorklogConflictException 이미 보냈거나 결과 확인이 필요한 상담일 때
     */
    CounselEntryView saveDraft(UUID academyId, UUID entryId, UUID accountId, String subject, String content);

    /**
     * 상담을 저장하고 외부 시스템으로 보냄
     *
     * 보내기 전에 내용을 저장하고 전송 중으로 표시한 뒤, DB 트랜잭션 밖에서 외부 시스템에 쓰고, 성공을 확인하면 보낸
     * 것으로 확정함. 외부 시스템이 처리하지 않은 것이 확실하면 보내기 전으로 되돌리고, 결과를 모르면 전송 중으로 둠
     *
     * @param academyId 학원 ID
     * @param entryId 상담 ID
     * @param accountId 담당자 계정 ID
     * @param date 상담 날짜
     * @param subject 주제
     * @param content 내용
     * @return 전송 결과가 반영된 상담
     * @throws WorklogConflictException 이미 보냈거나 결과 확인이 필요한 상담이거나, 외부 시스템이 실패했을 때
     */
    CounselEntryView send(
            UUID academyId, UUID entryId, UUID accountId, LocalDate date, String subject, String content);

    /**
     * 결과를 모르는 전송을 외부 시스템의 기록과 대조해 정리
     *
     * 같은 학생·주제·내용의 기록이 있으면 보낸 것으로 확정하고, 없으면 보내기 전으로 되돌림
     *
     * @param academyId 학원 ID
     * @param entryId 상담 ID
     * @param accountId 담당자 계정 ID
     * @return 정리된 상담
     */
    CounselEntryView resolvePending(UUID academyId, UUID entryId, UUID accountId);
}
