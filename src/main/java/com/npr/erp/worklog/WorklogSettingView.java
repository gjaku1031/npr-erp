package com.npr.erp.worklog;

import com.npr.erp.tng.TngDayGroup;
import java.time.LocalDate;

/**
 * 학원의 업무일지 설정
 *
 * @param weeklyTestMwf 월수금 반의 주간테스트 시행일. 정하지 않았으면 null
 * @param weeklyTestTts 화목토 반의 주간테스트 시행일. 정하지 않았으면 null
 * @param specialPeriod 지금 특강기간인지. 이후 만드는 일일보고에 적용됨
 */
public record WorklogSettingView(LocalDate weeklyTestMwf, LocalDate weeklyTestTts, boolean specialPeriod) {
    /**
     * 요일 묶음에 해당하는 주간테스트 시행일
     *
     * @param dayGroup 월수금 또는 화목토
     * @return 시행일. 정하지 않았으면 null
     */
    public LocalDate weeklyTestDateOf(TngDayGroup dayGroup) {
        return dayGroup == TngDayGroup.MWF ? weeklyTestMwf : weeklyTestTts;
    }
}
