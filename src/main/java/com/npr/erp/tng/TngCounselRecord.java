package com.npr.erp.tng;

import java.time.LocalDate;

/**
 * 외부 시스템에 기록된 상담 한 건
 *
 * @param studentCode 학번
 * @param studentName 이름
 * @param date 상담 날짜
 * @param topic 주제
 * @param content 내용
 */
public record TngCounselRecord(String studentCode, String studentName, LocalDate date, String topic, String content) {
}
