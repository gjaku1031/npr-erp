package com.npr.erp.accesscontrol.internal.scope;

import com.npr.erp.accesscontrol.AccessControlNotFoundException;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 학원 권한 정책의 조회와 행 잠금
 */
@Component
@RequiredArgsConstructor
public class AcademyScopeLocker {
    /**
     * 정책 저장소
     */
    private final AcademyAccessScopeRepository repository;

    /**
     * 정책 행을 쓰기 잠금으로 가져옴
     *
     * @param academyId 학원 ID
     * @return 잠근 정책 행
     * @throws AccessControlNotFoundException 초기화되지 않은 학원일 때
     */
    public AcademyAccessScopeEntity lock(UUID academyId) {
        return repository.findForUpdate(academyId).orElseThrow(() -> notInitialized(academyId));
    }

    /**
     * 잠금 없이 정책 행 조회
     *
     * @param academyId 학원 ID
     * @return 정책 행
     * @throws AccessControlNotFoundException 초기화되지 않은 학원일 때
     */
    public AcademyAccessScopeEntity get(UUID academyId) {
        return repository.findById(academyId).orElseThrow(() -> notInitialized(academyId));
    }

    /**
     * 초기화되지 않은 학원 예외 생성
     *
     * @param academyId 학원 ID
     * @return 던질 예외
     */
    private static AccessControlNotFoundException notInitialized(UUID academyId) {
        return new AccessControlNotFoundException(
                "ACADEMY_ACCESS_NOT_INITIALIZED", "학원 권한 정책이 초기화되지 않았습니다: " + academyId);
    }
}
