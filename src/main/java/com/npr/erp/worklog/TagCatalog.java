package com.npr.erp.worklog;

import java.util.List;
import java.util.UUID;

/**
 * 태그 관리 계약
 */
public interface TagCatalog {
    /**
     * 상담 업무가 쓰는 고정 태그의 이름
     */
    String COUNSEL_TAG = "상담";

    /**
     * 지운 태그를 쓰던 업무가 옮겨 가는 태그의 이름
     */
    String FALLBACK_TAG = "행정";

    /**
     * 학원의 태그 목록
     *
     * @param academyId 학원 ID
     * @return 정렬 순서대로
     */
    List<TagView> tags(UUID academyId);

    /**
     * 기본 태그 다섯 개를 보장
     *
     * 이미 있는 태그는 건드리지 않고 없는 것만 만듦. 상담 태그는 고정으로 만듦
     *
     * @param academyId 학원 ID
     */
    void ensureDefaults(UUID academyId);

    /**
     * 태그 생성
     *
     * @param academyId 학원 ID
     * @param name 이름
     * @param color 색
     * @param emoji 이모지
     * @return 만든 태그
     * @throws WorklogConflictException 같은 이름의 태그가 있을 때
     */
    TagView create(UUID academyId, String name, String color, String emoji);

    /**
     * 태그 수정
     *
     * 태그는 ID로 연결되므로 이름을 바꾸면 그 태그를 쓰는 업무와 일정에도 바로 반영됨
     *
     * @param academyId 학원 ID
     * @param tagId 태그 ID
     * @param name 새 이름. 고정 태그는 이름을 바꿀 수 없음
     * @param color 새 색
     * @param emoji 새 이모지
     * @return 바뀐 태그
     */
    TagView update(UUID academyId, UUID tagId, String name, String color, String emoji);

    /**
     * 태그 삭제
     *
     * 그 태그를 쓰던 업무는 행정 태그로 옮기고, 일정은 태그 없이 둠
     *
     * @param academyId 학원 ID
     * @param tagId 태그 ID
     * @throws WorklogConflictException 고정 태그이거나 행정 태그일 때
     */
    void delete(UUID academyId, UUID tagId);
}
