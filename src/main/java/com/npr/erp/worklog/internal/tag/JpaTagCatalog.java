package com.npr.erp.worklog.internal.tag;

import static com.npr.generated.jooq.Tables.WORKLOG_TASK;

import com.npr.erp.worklog.TagCatalog;
import com.npr.erp.worklog.TagView;
import com.npr.erp.worklog.WorklogConflictException;
import com.npr.erp.worklog.WorklogNotFoundException;
import com.npr.erp.worklog.WorklogValidationException;
import com.npr.erp.worklog.internal.support.Texts;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link TagCatalog} 구현
 */
@Service
@RequiredArgsConstructor
public class JpaTagCatalog implements TagCatalog {
    /**
     * 태그 이름의 최대 길이
     */
    private static final int MAX_NAME_LENGTH = 40;

    /**
     * 색 값의 최대 길이
     */
    private static final int MAX_COLOR_LENGTH = 20;

    /**
     * 허용하는 색: 정해 둔 이름 세 개 또는 여섯 자리 HEX. 화면의 style 속성에 그대로 들어가므로 형식을 좁힘
     */
    private static final Pattern COLOR = Pattern.compile("olive|blue|yellow|#[0-9a-fA-F]{6}");

    /**
     * 이모지의 최대 길이
     */
    private static final int MAX_EMOJI_LENGTH = 16;

    /**
     * 기본 태그: 이름, 색, 이모지
     */
    private static final String[][] DEFAULTS = {
        {"채점", "olive", "📝"},
        {COUNSEL_TAG, "blue", "💬"},
        {"교재", "yellow", "📚"},
        {FALLBACK_TAG, "olive", "🗂️"},
        {"행사", "yellow", "🎉"}
    };

    /**
     * 태그 저장소
     */
    private final WorklogTagRepository repository;

    /**
     * jOOQ 실행 문맥
     */
    private final DSLContext dsl;

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public List<TagView> tags(UUID academyId) {
        return repository.findAllByAcademyIdOrderBySortOrderAscNameAsc(academyId).stream()
                .map(WorklogTagEntity::toView)
                .toList();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public void ensureDefaults(UUID academyId) {
        for (var index = 0; index < DEFAULTS.length; index++) {
            var name = DEFAULTS[index][0];
            if (repository.findByAcademyIdAndName(academyId, name).isEmpty()) {
                repository.save(new WorklogTagEntity(
                        academyId, name, DEFAULTS[index][1], DEFAULTS[index][2], name.equals(COUNSEL_TAG), index));
            }
        }
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public TagView create(UUID academyId, String name, String color, String emoji) {
        var normalizedName = Texts.required(name, "태그 이름", MAX_NAME_LENGTH);
        requireNameAvailable(academyId, normalizedName, null);
        var nextOrder = repository.findAllByAcademyIdOrderBySortOrderAscNameAsc(academyId).size();
        return repository
                .save(new WorklogTagEntity(
                        academyId,
                        normalizedName,
                        color(color),
                        Texts.required(emoji, "이모지", MAX_EMOJI_LENGTH),
                        false,
                        nextOrder))
                .toView();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public TagView update(UUID academyId, UUID tagId, String name, String color, String emoji) {
        var tag = find(academyId, tagId);
        var normalizedName = Texts.required(name, "태그 이름", MAX_NAME_LENGTH);
        if (tag.isFixed() && !tag.getName().equals(normalizedName)) {
            throw new WorklogConflictException("TAG_FIXED", "고정 태그의 이름은 바꿀 수 없습니다.");
        }
        requireNameAvailable(academyId, normalizedName, tagId);
        tag.change(
                normalizedName,
                color(color),
                Texts.required(emoji, "이모지", MAX_EMOJI_LENGTH));
        return tag.toView();
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public void delete(UUID academyId, UUID tagId) {
        var tag = find(academyId, tagId);
        if (tag.isFixed() || tag.getName().equals(FALLBACK_TAG)) {
            throw new WorklogConflictException("TAG_FIXED", "이 태그는 지울 수 없습니다.");
        }

        // 지울 태그를 쓰던 업무는 행정 태그로 옮김. 일정의 태그는 DB가 null로 바꿈
        var fallback = repository.findByAcademyIdAndName(academyId, FALLBACK_TAG)
                .orElseThrow(() -> new WorklogConflictException("TAG_FALLBACK_MISSING", "행정 태그가 없어 지울 수 없습니다."));
        dsl.update(WORKLOG_TASK)
                .set(WORKLOG_TASK.TAG_ID, fallback.getId())
                .where(WORKLOG_TASK.TAG_ID.eq(tagId))
                .execute();
        repository.delete(tag);
    }

    /**
     * 학원 안에서 태그 조회
     *
     * @param academyId 학원 ID
     * @param tagId 태그 ID
     * @return 태그
     * @throws WorklogNotFoundException 없거나 다른 학원의 태그일 때
     */
    private WorklogTagEntity find(UUID academyId, UUID tagId) {
        return repository.findByIdAndAcademyId(tagId, academyId)
                .orElseThrow(() -> new WorklogNotFoundException("TAG_NOT_FOUND", "태그를 찾을 수 없습니다."));
    }

    /**
     * 색 값의 형식 확인
     *
     * @param value 입력한 색
     * @return 앞뒤 공백을 지운 색
     * @throws WorklogValidationException 정해 둔 이름이나 HEX 형식이 아닐 때
     */
    private static String color(String value) {
        var normalized = Texts.required(value, "색", MAX_COLOR_LENGTH);
        if (!COLOR.matcher(normalized).matches()) {
            throw new WorklogValidationException("TAG_COLOR_INVALID", "색은 olive, blue, yellow 또는 #RRGGBB 형식이어야 합니다.");
        }
        return normalized;
    }

    /**
     * 같은 이름의 다른 태그가 없는지 확인
     *
     * @param academyId 학원 ID
     * @param name 확인할 이름
     * @param selfId 비교에서 뺄 태그 ID. 새 태그면 null
     * @throws WorklogConflictException 같은 이름이 있을 때
     */
    private void requireNameAvailable(UUID academyId, String name, UUID selfId) {
        var duplicate = repository.findByAcademyIdAndName(academyId, name)
                .filter(existing -> !existing.getId().equals(selfId))
                .isPresent();
        if (duplicate) {
            throw new WorklogConflictException("TAG_NAME_DUPLICATE", "같은 이름의 태그가 이미 있습니다.");
        }
    }
}
