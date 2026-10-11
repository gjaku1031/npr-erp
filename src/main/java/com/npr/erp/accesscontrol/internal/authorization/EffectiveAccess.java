package com.npr.erp.accesscontrol.internal.authorization;

import com.npr.erp.accesscontrol.PermissionKey;
import java.util.Set;
import java.util.UUID;

/**
 * 한 계정이 한 학원에서 지금 가진 권한
 *
 * 유효한 소속, 회수되지 않은 배정, 활성 역할만 반영한 값
 *
 * @param academyId 권한을 읽은 학원 ID. 활성 소속이 없으면 null
 * @param membershipActive 활성 소속이 있는지
 * @param permissions 유효한 역할들의 권한을 합친 집합
 * @param roleIds 유효한 역할 ID
 */
public record EffectiveAccess(
        UUID academyId, boolean membershipActive, Set<PermissionKey> permissions, Set<UUID> roleIds) {
    /**
     * 활성 소속이 없는 상태
     *
     * @return 권한과 역할이 빈 값
     */
    public static EffectiveAccess none() {
        return new EffectiveAccess(null, false, Set.of(), Set.of());
    }
}
