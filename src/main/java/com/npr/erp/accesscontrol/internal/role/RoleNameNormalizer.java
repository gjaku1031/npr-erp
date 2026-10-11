package com.npr.erp.accesscontrol.internal.role;

import com.npr.erp.accesscontrol.AccessControlValidationException;
import java.text.Normalizer;
import java.util.Locale;
import org.springframework.stereotype.Component;

/**
 * 역할 이름 정규화
 *
 * 겉보기에 같은 이름이 서로 다른 역할로 등록되지 않게 함
 */
@Component
public final class RoleNameNormalizer {
    /**
     * 역할 이름의 최대 길이
     */
    private static final int MAX_LENGTH = 120;

    /**
     * 역할 이름을 표시용과 중복 검사용으로 정규화
     *
     * 전각·호환 문자를 NFKC로 통일하고, 앞뒤 공백을 지우고, 연속 공백을 하나로 줄임. 중복 검사용 이름은 소문자로 바꿈
     *
     * @param value 입력한 이름
     * @return 정규화한 이름
     * @throws AccessControlValidationException 제어 문자·보이지 않는 문자가 있거나 길이가 1~120자를 벗어날 때
     */
    public NormalizedRoleName normalize(String value) {
        var compatible = Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC);
        requireVisibleCharacters(compatible);
        var displayName = compatible.strip().replaceAll("\\s+", " ");
        if (displayName.isEmpty() || displayName.length() > MAX_LENGTH) {
            throw invalid("역할 이름은 1자 이상 " + MAX_LENGTH + "자 이하여야 합니다.");
        }

        // 소문자 변환으로 길이가 늘어나는 문자가 있어 다시 확인
        var normalizedName = displayName.toLowerCase(Locale.ROOT);
        if (normalizedName.length() > MAX_LENGTH) {
            throw invalid("역할 이름은 소문자로 바꾼 뒤에도 " + MAX_LENGTH + "자를 넘을 수 없습니다.");
        }
        return new NormalizedRoleName(displayName, normalizedName);
    }

    /**
     * 제어 문자와 보이지 않는 형식 문자가 없는지 확인
     *
     * @param value 확인할 문자열
     * @throws AccessControlValidationException 그런 문자가 있을 때
     */
    private static void requireVisibleCharacters(String value) {
        var hasInvisible = value.codePoints().anyMatch(codePoint -> {
            var type = Character.getType(codePoint);
            return type == Character.CONTROL || type == Character.FORMAT;
        });
        if (hasInvisible) {
            throw invalid("역할 이름에는 제어 문자나 보이지 않는 문자를 쓸 수 없습니다.");
        }
    }

    /**
     * 이름 규칙 위반 예외 생성
     *
     * @param message 위반 내용
     * @return 던질 예외
     */
    private static AccessControlValidationException invalid(String message) {
        return new AccessControlValidationException("INVALID_ROLE_NAME", message);
    }
}
