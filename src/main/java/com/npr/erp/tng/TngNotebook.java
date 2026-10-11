package com.npr.erp.tng;

import java.time.Instant;
import java.time.LocalDate;

/**
 * 반의 하루 알림장
 *
 * @param classCode 반 코드
 * @param date 날짜
 * @param title 제목
 * @param body 본문
 * @param postedAt 마지막으로 게시하거나 고친 시각
 */
public record TngNotebook(String classCode, LocalDate date, String title, String body, Instant postedAt) {
}
