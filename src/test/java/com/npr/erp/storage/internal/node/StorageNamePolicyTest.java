package com.npr.erp.storage.internal.node;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.npr.erp.storage.StorageValidationException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * 파일·폴더 이름 규칙 검사
 */
class StorageNamePolicyTest {
    /**
     * 앞뒤 공백을 지우고 전각 문자를 통일하며, 중복 검사용 이름은 소문자가 되는지 확인
     */
    @Test
    void trimsAndNormalizesName() {
        var name = StorageNamePolicy.validate("  ２０２６ 교재.PDF  ");

        assertThat(name).isEqualTo("2026 교재.PDF");
        assertThat(StorageNamePolicy.normalize(name)).isEqualTo("2026 교재.pdf");
    }

    /**
     * 경로를 벗어나거나 운영체제가 받지 않는 이름을 거부하는지 확인
     *
     * @param name 거부되어야 하는 이름
     */
    @ParameterizedTest
    @ValueSource(strings = {"", "  ", ".", "..", "a/b", "a\\b", "줄\n바꿈", "끝점.", "CON", "nul.txt", "com1"})
    void rejectsUnsafeNames(String name) {
        assertThatThrownBy(() -> StorageNamePolicy.validate(name))
                .isInstanceOfSatisfying(StorageValidationException.class, failure -> assertThat(failure.getCode())
                        .isEqualTo("INVALID_STORAGE_NAME"));
    }

    /**
     * 180자를 넘는 이름을 거부하는지 확인
     */
    @Test
    void rejectsTooLongName() {
        assertThatThrownBy(() -> StorageNamePolicy.validate("가".repeat(181)))
                .isInstanceOf(StorageValidationException.class);
    }
}
