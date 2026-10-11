package com.npr.erp.worklog.internal.tag;

import com.npr.erp.worklog.TagView;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;
import lombok.Getter;

/**
 * 업무와 일정에 붙이는 태그
 */
@Getter
@Entity(name = "WorklogTag")
@Table(name = "worklog_tag")
public class WorklogTagEntity {
    /**
     * 태그 ID
     */
    @Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    /**
     * 학원 ID
     */
    @Column(name = "academy_id", nullable = false, updatable = false)
    private UUID academyId;

    /**
     * 이름
     */
    @Column(name = "name", nullable = false, length = 40)
    private String name;

    /**
     * 색 이름 또는 HEX
     */
    @Column(name = "color", nullable = false, length = 20)
    private String color;

    /**
     * 이모지
     */
    @Column(name = "emoji", nullable = false, length = 16)
    private String emoji;

    /**
     * 이름을 바꾸거나 지울 수 없는 고정 태그인지
     */
    @Column(name = "fixed", nullable = false, updatable = false)
    private boolean fixed;

    /**
     * 정렬 순서
     */
    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    /**
     * JPA 인스턴스 초기화
     */
    protected WorklogTagEntity() {
    }

    /**
     * 새 태그 생성
     *
     * @param academyId 학원 ID
     * @param name 이름
     * @param color 색
     * @param emoji 이모지
     * @param fixed 고정 태그인지
     * @param sortOrder 정렬 순서
     */
    public WorklogTagEntity(UUID academyId, String name, String color, String emoji, boolean fixed, int sortOrder) {
        this.id = UUID.randomUUID();
        this.academyId = academyId;
        this.name = name;
        this.color = color;
        this.emoji = emoji;
        this.fixed = fixed;
        this.sortOrder = sortOrder;
    }

    /**
     * 이름·색·이모지 변경
     *
     * @param newName 새 이름
     * @param newColor 새 색
     * @param newEmoji 새 이모지
     */
    public void change(String newName, String newColor, String newEmoji) {
        this.name = newName;
        this.color = newColor;
        this.emoji = newEmoji;
    }

    /**
     * 공개 조회 결과로 변환
     *
     * @return 태그 조회 결과
     */
    public TagView toView() {
        return new TagView(id, name, color, emoji, fixed);
    }
}
