package com.npr.erp.bootstrap.web;

import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.worklog.ReportState;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import org.springframework.stereotype.Component;

/**
 * 화면에 보여 줄 문구로 바꾸는 도우미
 *
 * 템플릿에서 {@code @fmt}로 부름
 */
@Component("fmt")
public class Formats {
    /**
     * 시각을 보여 줄 때의 시간대
     */
    private static final ZoneId ZONE = ZoneId.of("Asia/Seoul");

    /**
     * 요일이 붙은 날짜
     */
    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("M월 d일 (E)", Locale.KOREAN);

    /**
     * 짧은 날짜
     */
    private static final DateTimeFormatter SHORT_DATE = DateTimeFormatter.ofPattern("M.d", Locale.KOREAN);

    /**
     * 날짜와 시각
     */
    private static final DateTimeFormatter DATE_TIME =
            DateTimeFormatter.ofPattern("M.d HH:mm", Locale.KOREAN).withZone(ZONE);

    /**
     * 요일이 붙은 날짜
     *
     * @param date 날짜
     * @return 예: 10월 10일 (토)
     */
    public String date(LocalDate date) {
        return date == null ? "" : DATE.format(date);
    }

    /**
     * 짧은 날짜
     *
     * @param date 날짜
     * @return 예: 10.10
     */
    public String shortDate(LocalDate date) {
        return date == null ? "" : SHORT_DATE.format(date);
    }

    /**
     * 한국 시간의 날짜와 시각
     *
     * @param instant 시각
     * @return 예: 10.10 14:05
     */
    public String dateTime(Instant instant) {
        return instant == null ? "" : DATE_TIME.format(instant);
    }

    /**
     * 마감까지 남은 날 수 표시
     *
     * @param daysLeft 남은 날 수. 지났으면 음수
     * @return 예: D-3, D-day, D+2
     */
    public String dday(long daysLeft) {
        if (daysLeft == 0) {
            return "D-day";
        }
        return daysLeft > 0 ? "D-" + daysLeft : "D+" + -daysLeft;
    }

    /**
     * 파일 크기
     *
     * @param bytes 바이트 수. 폴더는 null
     * @return 예: 3.2 MB
     */
    public String size(Long bytes) {
        if (bytes == null) {
            return "";
        }
        if (bytes < 1024) {
            return bytes + " B";
        }
        if (bytes < 1024 * 1024) {
            return String.format(Locale.ROOT, "%.1f KB", bytes / 1024.0);
        }
        return String.format(Locale.ROOT, "%.1f MB", bytes / (1024.0 * 1024.0));
    }

    /**
     * 일일보고 제출 상태 문구
     *
     * @param state 제출 상태
     * @return 미제출, 확인 대기, 확인 완료
     */
    public String report(ReportState state) {
        return switch (state) {
            case NOT_SUBMITTED -> "미제출";
            case WAITING -> "확인 대기";
            case CONFIRMED -> "확인 완료";
        };
    }

    /**
     * 일일보고 제출 상태의 색 단계
     *
     * @param state 제출 상태
     * @return 배지에 쓰는 단계 이름
     */
    public String reportTone(ReportState state) {
        return switch (state) {
            case NOT_SUBMITTED -> "mute";
            case WAITING -> "warn";
            case CONFIRMED -> "ok";
        };
    }

    /**
     * 폴더 ACL 작업의 이름
     *
     * @param action ACL 작업
     * @return 목록, 읽기, 쓰기, 권한 관리
     */
    public String action(ResourceAction action) {
        return switch (action) {
            case LIST -> "목록 보기";
            case READ -> "읽기";
            case WRITE -> "쓰기";
            case MANAGE_ACL -> "권한 관리";
        };
    }
}
