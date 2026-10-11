package com.npr.erp.worklog;

import java.time.LocalDate;
import java.time.ZoneId;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 업무일지의 날짜 기준
 *
 * "오늘"은 서버가 놓인 곳과 상관없이 학원이 있는 한국 시간으로 정함
 */
@Component
public final class WorkCalendar {
    /**
     * 학원의 시간대
     */
    private static final ZoneId ZONE = ZoneId.of("Asia/Seoul");

    /**
     * 설정으로 고정한 오늘. 고정하지 않았으면 null
     */
    private final LocalDate fixedToday;

    /**
     * 설정에서 고정 날짜를 읽어 생성
     *
     * @param fixedToday YYYY-MM-DD 형식의 고정 날짜. 비어 있으면 실제 날짜를 씀. 시연할 때 수업이 있는 요일로
     *     맞추는 데 씀
     */
    public WorkCalendar(@Value("${npr.worklog.today:}") String fixedToday) {
        this.fixedToday = fixedToday == null || fixedToday.isBlank() ? null : LocalDate.parse(fixedToday.strip());
    }

    /**
     * 한국 시간의 오늘
     *
     * @return 오늘 날짜. 설정으로 고정했으면 그 날짜
     */
    public LocalDate today() {
        return fixedToday != null ? fixedToday : LocalDate.now(ZONE);
    }
}
