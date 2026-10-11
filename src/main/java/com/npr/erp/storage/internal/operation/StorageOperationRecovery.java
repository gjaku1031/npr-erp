package com.npr.erp.storage.internal.operation;

import com.npr.erp.storage.StorageOperationStatus;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 서버가 다시 뜰 때 중단된 작업을 확인 대상으로 표시
 *
 * 외부 저장소를 호출하던 중에 프로세스가 끝났다면 그 호출이 반영됐는지 알 수 없음. 같은 변경을 바로 다시 보내지 않고
 * VERIFY로 남겨, 실제 상태를 확인하는 절차를 거치게 함
 */
@Component
@RequiredArgsConstructor
public class StorageOperationRecovery {
    /**
     * 작업 원장 저장소
     */
    private final StorageOperationRepository repository;

    /**
     * 처리 중으로 남은 작업을 모두 확인 대상으로 바꿈
     */
    @EventListener(ApplicationReadyEvent.class)
    @Transactional
    public void markInterruptedOperations() {
        var now = Instant.now();
        // 호출 중에 끊긴 작업뿐 아니라, 기록만 하고 호출을 시작하지 못한 작업도 노드를 변경 중으로 잡고 있음
        for (var status : List.of(StorageOperationStatus.PROCESSING, StorageOperationStatus.PENDING)) {
            for (var operation : repository.findAllByStatusOrderByCreatedAtAsc(status)) {
                operation.requireVerification(now);
            }
        }
    }
}
