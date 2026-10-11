package com.npr.erp.accesscontrol.internal.role;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.npr.erp.accesscontrol.AccessControlValidationException;
import org.junit.jupiter.api.Test;

/**
 * 역할 이름 정규화 검사
 */
class RoleNameNormalizerTest {
    /**
     * 검사 대상
     */
    private final RoleNameNormalizer normalizer = new RoleNameNormalizer();

    /**
     * 전각 문자와 연속 공백이 통일되고 중복 검사용 이름은 소문자가 되는지 확인
     */
    @Test
    void normalizesCompatibilityCharactersAndWhitespace() {
        var result = normalizer.normalize("  ＡＤＭＩＮ　팀  ");

        assertThat(result.displayName()).isEqualTo("ADMIN 팀");
        assertThat(result.normalizedName()).isEqualTo("admin 팀");
    }

    /**
     * 소문자로 바꾸면 길이가 늘어나는 이름이 최대 길이를 넘지 못하는지 확인
     */
    @Test
    void rejectsNameThatGrowsBeyondLimitWhenLowercased() {
        assertInvalid("İ".repeat(120));
    }

    /**
     * 줄바꿈과 폭 없는 공백이 들어간 이름을 거부하는지 확인
     */
    @Test
    void rejectsControlAndInvisibleCharacters() {
        assertInvalid("관리\n자");
        assertInvalid("관리​자");
    }

    /**
     * 호환 문자를 풀어 쓴 결과가 최대 길이를 넘으면 거부하는지 확인
     */
    @Test
    void rejectsNameThatExceedsLimitAfterNormalization() {
        assertInvalid("ﬃ".repeat(41));
    }

    /**
     * 빈 이름을 거부하는지 확인
     */
    @Test
    void rejectsBlankName() {
        assertInvalid("   ");
    }

    /**
     * 이름 규칙 위반 예외가 나는지 확인
     *
     * @param name 거부되어야 하는 이름
     */
    private void assertInvalid(String name) {
        assertThatThrownBy(() -> normalizer.normalize(name))
                .isInstanceOfSatisfying(AccessControlValidationException.class, failure -> assertThat(failure.getCode())
                        .isEqualTo("INVALID_ROLE_NAME"));
    }
}
