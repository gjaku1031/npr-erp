package com.npr.erp.accesscontrol.internal.audit;

import java.time.Instant;
import lombok.RequiredArgsConstructor;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * 감사 기록기
 *
 * 거부와 슈퍼유저 우회는 업무 트랜잭션이 롤백돼도 남아야 하므로 별도 트랜잭션으로, 정책 변경은 변경과 함께
 * 커밋되거나 함께 롤백돼야 하므로 같은 트랜잭션으로 기록함
 */
@Component
@RequiredArgsConstructor
public class AuthorizationAuditRecorder {
    /**
     * 요청 추적 ID를 담는 로그 문맥 키
     */
    private static final String REQUEST_ID_KEY = "requestId";

    /**
     * 감사 기록 저장소
     */
    private final AuthorizationAuditLogRepository repository;

    /**
     * 상태를 JSON으로 바꾸는 매퍼
     */
    private final ObjectMapper objectMapper;

    /**
     * 호출한 트랜잭션과 무관하게 바로 커밋되는 기록
     *
     * @param event 기록할 사건
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordIndependent(AuthorizationAuditEvent event) {
        save(event);
    }

    /**
     * 진행 중인 트랜잭션에 함께 묶이는 기록
     *
     * @param event 기록할 사건
     * @throws org.springframework.transaction.IllegalTransactionStateException 진행 중인 트랜잭션이 없을 때
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void recordInCurrentTransaction(AuthorizationAuditEvent event) {
        save(event);
    }

    /**
     * 사건을 저장
     *
     * @param event 기록할 사건
     */
    private void save(AuthorizationAuditEvent event) {
        var requestId = event.requestId() != null ? event.requestId() : MDC.get(REQUEST_ID_KEY);
        repository.save(new AuthorizationAuditLogEntity(
                event,
                requestId,
                toJson(event.beforeState()),
                toJson(event.afterState()),
                toJson(event.details()),
                Instant.now()));
    }

    /**
     * 상태 객체를 JSON 문자열로 변환
     *
     * @param value 변환할 값
     * @return JSON 문자열. 값이 null이면 null
     */
    private String toJson(Object value) {
        return value == null ? null : objectMapper.writeValueAsString(value);
    }
}
