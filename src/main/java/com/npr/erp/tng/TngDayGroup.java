package com.npr.erp.tng;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.Optional;

/**
 * 반의 수업 요일 묶음
 */
public enum TngDayGroup {
    /**
     * 월·수·금
     */
    MWF("월수금"),

    /**
     * 화·목·토
     */
    TTS("화목토");

    /**
     * 화면에 보이는 이름
     */
    private final String label;

    /**
     * 표시 이름으로 요일 묶음 생성
     *
     * @param label 화면에 보이는 이름
     */
    TngDayGroup(String label) {
        this.label = label;
    }

    /**
     * 화면에 보이는 이름 조회
     *
     * @return 월수금 또는 화목토
     */
    public String label() {
        return label;
    }

    /**
     * 날짜가 속한 요일 묶음
     *
     * @param date 날짜
     * @return 일요일이면 빈 값
     */
    public static Optional<TngDayGroup> of(LocalDate date) {
        return switch (date.getDayOfWeek()) {
            case MONDAY, WEDNESDAY, FRIDAY -> Optional.of(MWF);
            case TUESDAY, THURSDAY, SATURDAY -> Optional.of(TTS);
            case SUNDAY -> Optional.empty();
        };
    }

    /**
     * 이 묶음에 수업이 있는 요일인지 확인
     *
     * @param day 요일
     * @return 수업 요일이면 true
     */
    public boolean includes(DayOfWeek day) {
        return this == MWF
                ? day == DayOfWeek.MONDAY || day == DayOfWeek.WEDNESDAY || day == DayOfWeek.FRIDAY
                : day == DayOfWeek.TUESDAY || day == DayOfWeek.THURSDAY || day == DayOfWeek.SATURDAY;
    }
}
