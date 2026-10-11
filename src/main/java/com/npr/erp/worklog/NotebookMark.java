package com.npr.erp.worklog;

/**
 * 한 반의 알림장 게시 여부
 *
 * @param classCode 반 코드
 * @param className 반 이름
 * @param written 게시했는지
 * @param title 게시한 알림장의 제목. 게시 전이면 빈 문자열
 */
public record NotebookMark(String classCode, String className, boolean written, String title) {
}
