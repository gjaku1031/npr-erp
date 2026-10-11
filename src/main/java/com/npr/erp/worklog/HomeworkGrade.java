package com.npr.erp.worklog;

/**
 * 과제 이행 등급
 */
public enum HomeworkGrade {
    /**
     * 이행
     */
    A,

    /**
     * 미흡
     */
    B,

    /**
     * 미이행
     */
    C,

    /**
     * 외부 시스템에 입력되지 않음
     */
    NONE;

    /**
     * 외부 시스템의 과제 이행 문구를 등급으로 변환
     *
     * @param raw 외부 시스템의 문구
     * @return 미이행은 C, 미흡은 B, 빈 값은 미입력, 그 밖은 A
     */
    public static HomeworkGrade of(String raw) {
        if (raw == null || raw.isBlank()) {
            return NONE;
        }
        return switch (raw.strip()) {
            case "미이행" -> C;
            case "미흡" -> B;
            default -> A;
        };
    }
}
