package com.npr.erp.worklog.internal.staff;

import com.npr.erp.tng.TngClassroom;
import com.npr.erp.tng.TngGateway;
import com.npr.erp.worklog.StaffView;
import com.npr.erp.worklog.WorklogConflictException;
import com.npr.erp.worklog.WorklogStaffDirectory;
import com.npr.erp.worklog.WorklogValidationException;
import com.npr.erp.worklog.internal.support.WorklogJson;
import java.time.Instant;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;

/**
 * {@link WorklogStaffDirectory} 구현
 */
@Service
@RequiredArgsConstructor
public class JpaWorklogStaffDirectory implements WorklogStaffDirectory {
    /**
     * 담당 반 목록의 JSON 타입
     */
    private static final TypeReference<List<TngClassroom>> CLASSROOMS = new TypeReference<>() {
    };

    /**
     * 직원 설정 저장소
     */
    private final WorklogStaffRepository repository;

    /**
     * 외부 시스템 포트
     */
    private final TngGateway tngGateway;

    /**
     * JSON 변환
     */
    private final WorklogJson json;

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public StaffView staff(UUID academyId, UUID accountId) {
        return repository.findById(new WorklogStaffId(academyId, accountId))
                .map(this::toView)
                .orElseGet(() -> emptyView(academyId, accountId));
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional(readOnly = true)
    public Map<UUID, StaffView> staffOf(UUID academyId, Collection<UUID> accountIds) {
        var views = new LinkedHashMap<UUID, StaffView>();
        for (var accountId : accountIds) {
            views.put(accountId, emptyView(academyId, accountId));
        }
        if (!accountIds.isEmpty()) {
            for (var entity : repository.findAllByIdAcademyIdAndIdAccountIdIn(academyId, accountIds)) {
                views.put(entity.getId().getAccountId(), toView(entity));
            }
        }
        return views;
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public StaffView linkTngStaff(UUID academyId, UUID accountId, String staffCode) {
        var normalized = staffCode == null || staffCode.isBlank() ? null : staffCode.strip();
        if (normalized != null && tngGateway.staff().stream().noneMatch(staff -> staff.code().equals(normalized))) {
            throw new WorklogValidationException("TNG_STAFF_UNKNOWN", "외부 시스템에 없는 직원 코드입니다.");
        }
        var entity = findOrCreate(academyId, accountId);
        if (!Objects.equals(entity.getTngStaffCode(), normalized)) {
            entity.linkTngStaff(normalized, Instant.now());
        }
        return toView(entity);
    }

    /**
     * {@inheritDoc}
     */
    @Override
    @Transactional
    public StaffView syncClassrooms(UUID academyId, UUID accountId) {
        var entity = findOrCreate(academyId, accountId);
        if (entity.getTngStaffCode() == null) {
            throw new WorklogConflictException("TNG_STAFF_NOT_LINKED", "외부 시스템 직원 코드를 먼저 연결해 주세요.");
        }
        var classrooms = tngGateway.classroomsOf(entity.getTngStaffCode());
        entity.replaceClassrooms(json.write(classrooms), Instant.now());
        return toView(entity);
    }

    /**
     * 설정을 찾고 없으면 빈 설정을 만들어 저장
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     * @return 영속 상태의 설정
     */
    private WorklogStaffEntity findOrCreate(UUID academyId, UUID accountId) {
        return repository.findById(new WorklogStaffId(academyId, accountId))
                .orElseGet(() -> repository.save(new WorklogStaffEntity(academyId, accountId, Instant.now())));
    }

    /**
     * 엔티티를 공개 조회 결과로 변환
     *
     * @param entity 직원 설정
     * @return 담당 반을 타입 있는 목록으로 푼 조회 결과
     */
    private StaffView toView(WorklogStaffEntity entity) {
        return new StaffView(
                entity.getId().getAcademyId(),
                entity.getId().getAccountId(),
                entity.getTngStaffCode(),
                json.read(entity.getClassrooms(), CLASSROOMS),
                entity.getClassroomsSyncedAt());
    }

    /**
     * 저장된 설정이 없는 직원의 빈 조회 결과
     *
     * @param academyId 학원 ID
     * @param accountId 계정 ID
     * @return 연결과 담당 반이 빈 값
     */
    private static StaffView emptyView(UUID academyId, UUID accountId) {
        return new StaffView(academyId, accountId, null, List.of(), null);
    }
}
