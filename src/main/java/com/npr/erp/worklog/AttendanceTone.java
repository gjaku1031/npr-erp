package com.npr.erp.worklog;

/**
 * 출결 상태를 화면에서 구분하는 세 단계
 */
public enum AttendanceTone {
    /**
     * 출석
     */
    GOOD,

    /**
     * 지각·조퇴·외출처럼 일부만 참석
     */
    WARN,

    /**
     * 결석·휴강
     */
    BAD;

    /**
     * 외부 시스템의 출결 문구를 단계로 변환
     *
     * @param status 출결 문구
     * @return 결석·휴강은 BAD, 지각·조퇴·외출·결과·예정은 WARN, 그 밖은 GOOD
     */
    public static AttendanceTone of(String status) {
        return switch (status == null ? "" : status.strip()) {
            case "결석", "휴강" -> BAD;
            case "지각", "조퇴", "외출", "결과", "예정" -> WARN;
            default -> GOOD;
        };
    }
}
