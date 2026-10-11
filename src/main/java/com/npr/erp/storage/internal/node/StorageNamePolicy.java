package com.npr.erp.storage.internal.node;

import com.npr.erp.storage.StorageValidationException;
import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 파일·폴더 이름 규칙
 *
 * 이름이 그대로 외부 저장소의 경로 조각이 되므로, 경로를 벗어나거나 운영체제가 받지 않는 이름을 미리 거름
 */
public final class StorageNamePolicy {
    /**
     * 이름의 최대 길이
     */
    private static final int MAX_NAME_LENGTH = 180;

    /**
     * 쓸 수 없는 문자: 제어 문자와 경로 구분자
     */
    private static final Pattern FORBIDDEN_CHARACTER = Pattern.compile("[\\u0000-\\u001F/\\\\]");

    /**
     * Windows가 예약한 장치 이름. 확장자가 붙어도 쓸 수 없음
     */
    private static final Pattern WINDOWS_RESERVED_NAME =
            Pattern.compile("(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\\..*)?$");

    /**
     * 인스턴스를 만들지 않는 도우미
     */
    private StorageNamePolicy() {
    }

    /**
     * 이름을 정리하고 규칙 확인
     *
     * @param rawName 입력한 이름
     * @return 앞뒤 공백을 지우고 NFKC로 통일한 이름
     * @throws StorageValidationException 비었거나, 너무 길거나, 쓸 수 없는 문자·이름일 때
     */
    public static String validate(String rawName) {
        var value = Normalizer.normalize(rawName == null ? "" : rawName.strip(), Normalizer.Form.NFKC);
        var invalid = value.isBlank()
                || value.equals(".")
                || value.equals("..")
                || value.length() > MAX_NAME_LENGTH
                || FORBIDDEN_CHARACTER.matcher(value).find()
                // 끝의 점과 공백은 Windows에서 조용히 사라져 다른 이름과 겹칠 수 있음
                || value.endsWith(".")
                || value.endsWith(" ")
                || WINDOWS_RESERVED_NAME.matcher(value).matches();
        if (invalid) {
            throw new StorageValidationException("INVALID_STORAGE_NAME", "파일이나 폴더 이름으로 쓸 수 없는 이름입니다.");
        }
        return value;
    }

    /**
     * 중복 검사용 이름
     *
     * 대소문자만 다른 이름을 같은 이름으로 봄
     *
     * @param validatedName {@link #validate(String)}를 통과한 이름
     * @return 소문자로 바꾼 이름
     */
    public static String normalize(String validatedName) {
        return validatedName.toLowerCase(Locale.ROOT);
    }
}
