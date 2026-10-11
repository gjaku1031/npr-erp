package com.npr.erp.accesscontrol.internal.role;

import com.npr.erp.accesscontrol.AccessControlValidationException;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.PermissionKey;
import java.util.Set;

/**
 * 역할에 넣으려는 권한 키 검증
 */
public final class RolePermissionValidator {
    /**
     * 인스턴스를 만들지 않는 도우미
     */
    private RolePermissionValidator() {
    }

    /**
     * 요청한 권한이 모두 코드에 정의된 것인지 확인
     *
     * @param permissionKeys 요청한 권한 키
     * @throws AccessControlValidationException 정의되지 않은 키가 있을 때
     */
    public static void requireKnown(Set<PermissionKey> permissionKeys) {
        var unknown = permissionKeys.stream()
                .filter(key -> PermissionCatalog.find(key).isEmpty())
                .map(PermissionKey::value)
                .sorted()
                .toList();
        if (!unknown.isEmpty()) {
            throw new AccessControlValidationException(
                    "UNKNOWN_PERMISSION", "정의되지 않은 권한이 들어 있습니다: " + String.join(", ", unknown));
        }
    }
}
