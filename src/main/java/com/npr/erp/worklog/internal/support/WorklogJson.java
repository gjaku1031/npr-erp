package com.npr.erp.worklog.internal.support;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * JSONB 열에 넣는 값의 직렬화
 *
 * 엔티티는 JSON 문자열을 그대로 들고, 타입 있는 값으로 바꾸는 일은 여기서 함
 */
@Component
@RequiredArgsConstructor
public class WorklogJson {
    /**
     * JSON 매퍼
     */
    private final ObjectMapper objectMapper;

    /**
     * 값을 JSON 문자열로 변환
     *
     * @param value 변환할 값
     * @return JSON 문자열
     */
    public String write(Object value) {
        return objectMapper.writeValueAsString(value);
    }

    /**
     * JSON 문자열을 값으로 변환
     *
     * @param json JSON 문자열
     * @param type 읽을 타입
     * @param <T> 값의 타입
     * @return 읽은 값
     */
    public <T> T read(String json, TypeReference<T> type) {
        return objectMapper.readValue(json, type);
    }

    /**
     * JSON 문자열을 값으로 변환
     *
     * @param json JSON 문자열
     * @param type 읽을 클래스
     * @param <T> 값의 타입
     * @return 읽은 값
     */
    public <T> T read(String json, Class<T> type) {
        return objectMapper.readValue(json, type);
    }
}
