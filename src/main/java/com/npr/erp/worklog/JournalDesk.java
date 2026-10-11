package com.npr.erp.worklog;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * 날짜별 일일보고 정의와 업무일지 설정의 관리 계약
 */
public interface JournalDesk {
    /**
     * 한 날짜의 일일보고 정의
     *
     * @param academyId 학원 ID
     * @param date 날짜
     * @return 만들어지지 않았으면 빈 값
     */
    Optional<JournalView> journal(UUID academyId, LocalDate date);

    /**
     * 일일보고가 만들어진 날짜 목록
     *
     * @param academyId 학원 ID
     * @param reporterIds 지금의 보고 대상. 제출 수는 이 사람들만 셈
     * @return 최근 날짜부터
     */
    List<JournalSummary> journals(UUID academyId, Set<UUID> reporterIds);

    /**
     * 한 날짜의 일일보고 생성
     *
     * 오늘의 체크리스트 항목을 복사하고, 오늘 항목이 없으면 대상 날짜 이전의 가장 최근 일일보고에서 복사함. 그때의
     * 특강기간 설정을 함께 적어 둠. 이미 있으면 있는 것을 그대로 돌려줌
     *
     * @param academyId 학원 ID
     * @param actorId 만드는 계정 ID
     * @param date 날짜
     * @return 그 날짜의 일일보고
     */
    JournalView create(UUID academyId, UUID actorId, LocalDate date);

    /**
     * 한 날짜의 일일보고 삭제
     *
     * 체크리스트 항목과 그 날짜에 낸 보고, 보고의 첨부까지 함께 지움
     *
     * @param academyId 학원 ID
     * @param date 날짜
     */
    void delete(UUID academyId, LocalDate date);

    /**
     * 체크리스트 항목 추가
     *
     * @param academyId 학원 ID
     * @param date 날짜
     * @param text 내용
     * @param required 확인 결과를 꼭 적어야 하는지
     * @return 바뀐 일일보고
     * @throws WorklogConflictException 지난 날짜일 때
     */
    JournalView addItem(UUID academyId, LocalDate date, String text, boolean required);

    /**
     * 체크리스트 항목 삭제
     *
     * @param academyId 학원 ID
     * @param itemId 항목 ID
     * @throws WorklogConflictException 지난 날짜의 항목일 때
     */
    void removeItem(UUID academyId, UUID itemId);

    /**
     * 항목의 보고 필수 여부 변경
     *
     * @param academyId 학원 ID
     * @param itemId 항목 ID
     * @param required 확인 결과를 꼭 적어야 하는지
     * @throws WorklogConflictException 지난 날짜의 항목일 때
     */
    void setRequired(UUID academyId, UUID itemId, boolean required);

    /**
     * 학원의 업무일지 설정
     *
     * @param academyId 학원 ID
     * @return 저장된 설정. 없으면 날짜가 비고 특강기간이 꺼진 기본값
     */
    WorklogSettingView settings(UUID academyId);

    /**
     * 학원의 업무일지 설정 변경
     *
     * @param academyId 학원 ID
     * @param weeklyTestMwf 월수금 반의 주간테스트 시행일
     * @param weeklyTestTts 화목토 반의 주간테스트 시행일
     * @param specialPeriod 특강기간인지
     * @return 바뀐 설정
     */
    WorklogSettingView updateSettings(
            UUID academyId, LocalDate weeklyTestMwf, LocalDate weeklyTestTts, boolean specialPeriod);
}
