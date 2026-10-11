package com.npr.erp.worklog;

import java.time.Instant;
import java.util.UUID;

/**
 * 학생 한 명에 대한 상담
 *
 * @param id 상담 ID
 * @param taskId 업무 ID
 * @param accountId 담당자 계정 ID
 * @param classCode 반 코드
 * @param className 반 이름
 * @param studentCode 학번
 * @param studentName 학생 이름
 * @param motherPhone 어머니 연락처. 등록되지 않았으면 빈 문자열
 * @param subject 주제
 * @param content 내용
 * @param delivery 전송 상태
 * @param sentAt 전송을 확인한 시각. 보내기 전이면 null
 */
public record CounselEntryView(
        UUID id,
        UUID taskId,
        UUID accountId,
        String classCode,
        String className,
        String studentCode,
        String studentName,
        String motherPhone,
        String subject,
        String content,
        CounselDelivery delivery,
        Instant sentAt) {
}
