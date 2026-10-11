package com.npr.erp.worklog.internal.support;

import com.npr.erp.worklog.WorklogValidationException;

/**
 * 입력 문자열 다듬기
 */
public final class Texts {
    /**
     * 인스턴스를 만들지 않는 도우미
     */
    private Texts() {
    }

    /**
     * 반드시 있어야 하는 한 줄 입력의 공백 제거와 길이 확인
     *
     * @param value 입력값
     * @param label 오류 문구에 쓸 항목 이름
     * @param maxLength 허용 최대 길이
     * @return 앞뒤 공백을 지운 값
     * @throws WorklogValidationException 비었거나 최대 길이를 넘을 때
     */
    public static String required(String value, String label, int maxLength) {
        var trimmed = value == null ? "" : value.strip();
        if (trimmed.isEmpty()) {
            throw new WorklogValidationException("WORKLOG_FIELD_REQUIRED", label + "을(를) 입력해 주세요.");
        }
        if (trimmed.length() > maxLength) {
            throw new WorklogValidationException(
                    "WORKLOG_FIELD_TOO_LONG", label + "은(는) " + maxLength + "자 이내로 입력해 주세요.");
        }
        return trimmed;
    }

    /**
     * 비어도 되는 입력의 공백 제거와 길이 확인
     *
     * @param value 입력값. null이면 빈 문자열로 봄
     * @param label 오류 문구에 쓸 항목 이름
     * @param maxLength 허용 최대 길이
     * @return 앞뒤 공백을 지운 값
     * @throws WorklogValidationException 최대 길이를 넘을 때
     */
    public static String optional(String value, String label, int maxLength) {
        var trimmed = value == null ? "" : value.strip();
        if (trimmed.length() > maxLength) {
            throw new WorklogValidationException(
                    "WORKLOG_FIELD_TOO_LONG", label + "은(는) " + maxLength + "자 이내로 입력해 주세요.");
        }
        return trimmed;
    }
}
