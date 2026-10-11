package com.npr.erp.worklog;

import java.util.UUID;

/**
 * 업무와 일정에 붙이는 태그
 *
 * @param id 태그 ID
 * @param name 이름
 * @param color 색 이름 또는 HEX
 * @param emoji 이모지
 * @param fixed 이름을 바꾸거나 지울 수 없는 고정 태그인지
 */
public record TagView(UUID id, String name, String color, String emoji, boolean fixed) {
}
