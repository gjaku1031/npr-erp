package com.npr.erp.worklog;

import java.util.List;
import java.util.UUID;

/**
 * 공지 관리 계약
 */
public interface NoticeBoard {
    /**
     * 학원의 전체 공지
     *
     * @param academyId 학원 ID
     * @return 노출 순서대로
     */
    List<NoticeView> notices(UUID academyId);

    /**
     * 노출 중인 공지
     *
     * @param academyId 학원 ID
     * @return 노출 순서대로
     */
    List<NoticeView> activeNotices(UUID academyId);

    /**
     * 공지 작성
     *
     * 새 공지는 목록의 맨 앞에 놓이고 바로 노출됨
     *
     * @param academyId 학원 ID
     * @param authorId 쓰는 계정 ID
     * @param body 본문
     * @return 쓴 공지
     */
    NoticeView create(UUID academyId, UUID authorId, String body);

    /**
     * 공지 본문 수정
     *
     * @param academyId 학원 ID
     * @param noticeId 공지 ID
     * @param body 새 본문
     */
    void update(UUID academyId, UUID noticeId, String body);

    /**
     * 공지 노출 여부 변경
     *
     * @param academyId 학원 ID
     * @param noticeId 공지 ID
     * @param active 노출할지
     */
    void setActive(UUID academyId, UUID noticeId, boolean active);

    /**
     * 공지 삭제
     *
     * @param academyId 학원 ID
     * @param noticeId 공지 ID
     */
    void delete(UUID academyId, UUID noticeId);

    /**
     * 공지 한 건을 한 칸 위나 아래로 옮김
     *
     * @param academyId 학원 ID
     * @param noticeId 공지 ID
     * @param up 위로 옮길지
     */
    void move(UUID academyId, UUID noticeId, boolean up);
}
