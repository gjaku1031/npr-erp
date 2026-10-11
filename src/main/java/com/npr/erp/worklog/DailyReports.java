package com.npr.erp.worklog;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * 일일보고 작성·제출·확인 계약
 *
 * 상태는 작성 중 → 제출 → 확인 순으로만 나아가고, 작성자는 확인 전까지만 제출을 되돌릴 수 있음
 */
public interface DailyReports {
    /**
     * 작성 화면에 필요한 것을 한 번에 조회
     *
     * @param academyId 학원 ID
     * @param accountId 작성자 계정 ID
     * @param date 날짜
     * @param assignableIds 지금의 업무 배정 후보
     * @return 일일보고 정의, 저장한 내용, 단계별 완료 여부
     * @throws WorklogNotFoundException 그 날짜의 일일보고가 아직 만들어지지 않았을 때
     */
    WizardView wizard(UUID academyId, UUID accountId, LocalDate date, Set<UUID> assignableIds);

    /**
     * 임시저장
     *
     * @param academyId 학원 ID
     * @param accountId 작성자 계정 ID
     * @param date 날짜
     * @param input 사람이 넣은 값
     * @throws WorklogConflictException 이미 제출한 보고일 때
     */
    void saveDraft(UUID academyId, UUID accountId, LocalDate date, ReportInput input);

    /**
     * 제출
     *
     * 다섯 단계의 완료 여부를 서버가 다시 계산해 모두 마쳤을 때만 받음. 그 순간의 담당 반, 알림장 게시 여부, 업무
     * 상태를 보고에 적어 둠. 다시 제출하면 확인 표시는 지워짐
     *
     * @param academyId 학원 ID
     * @param accountId 작성자 계정 ID
     * @param date 날짜
     * @param assignableIds 지금의 업무 배정 후보
     * @return 제출한 보고
     * @throws WorklogValidationException 마치지 못한 단계가 있을 때
     */
    DailyReportView submit(UUID academyId, UUID accountId, LocalDate date, Set<UUID> assignableIds);

    /**
     * 제출을 되돌려 다시 작성 중으로 바꿈
     *
     * @param academyId 학원 ID
     * @param accountId 작성자 계정 ID
     * @param date 날짜
     * @throws WorklogConflictException 제출하지 않았거나 확인이 끝난 보고일 때
     */
    void reopen(UUID academyId, UUID accountId, LocalDate date);

    /**
     * 제출된 보고를 확인 처리
     *
     * @param academyId 학원 ID
     * @param accountId 작성자 계정 ID
     * @param date 날짜
     * @param reviewerId 확인하는 계정 ID
     * @throws WorklogConflictException 제출되지 않은 보고일 때
     */
    void confirm(UUID academyId, UUID accountId, LocalDate date, UUID reviewerId);

    /**
     * 한 사람의 한 날짜 보고
     *
     * @param academyId 학원 ID
     * @param accountId 작성자 계정 ID
     * @param date 날짜
     * @return 저장한 적이 없으면 빈 값
     */
    Optional<DailyReportView> report(UUID academyId, UUID accountId, LocalDate date);

    /**
     * 한 사람이 한 날짜의 체크리스트에 붙인 파일
     *
     * @param academyId 학원 ID
     * @param accountId 작성자 계정 ID
     * @param date 날짜
     * @return 항목 ID별 첨부
     */
    Map<UUID, List<AttachmentView>> checklistFiles(UUID academyId, UUID accountId, LocalDate date);

    /**
     * 한 날짜의 제출 현황
     *
     * @param academyId 학원 ID
     * @param date 날짜
     * @param reporterIds 지금의 보고 대상
     * @return 보고 대상 한 명마다 한 줄. 계정 ID 순
     */
    List<ReportBoardEntry> board(UUID academyId, LocalDate date, Set<UUID> reporterIds);

    /**
     * 한 사람이 제출한 지난 보고
     *
     * @param academyId 학원 ID
     * @param accountId 작성자 계정 ID
     * @return 최근 날짜부터 최대 60건
     */
    List<DailyReportView> history(UUID academyId, UUID accountId);

    /**
     * 체크리스트 항목에 파일 첨부
     *
     * @param academyId 학원 ID
     * @param accountId 작성자 계정 ID
     * @param date 날짜
     * @param itemId 항목 ID
     * @param fileName 파일 이름
     * @param mediaType 미디어 타입
     * @param content 본문. 4MB 이하
     * @return 첨부 정보
     * @throws WorklogConflictException 이미 제출한 보고일 때
     */
    AttachmentView attachChecklistFile(
            UUID academyId,
            UUID accountId,
            LocalDate date,
            UUID itemId,
            String fileName,
            String mediaType,
            byte[] content);
}
