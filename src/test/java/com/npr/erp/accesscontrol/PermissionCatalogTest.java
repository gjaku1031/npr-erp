package com.npr.erp.accesscontrol;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * 권한 목록의 계약 검사
 */
class PermissionCatalogTest {
    /**
     * 권한 키가 영역.대상.동작 형식이고 중복이 없는지 확인
     */
    @Test
    void keysAreUniqueAndWellFormed() {
        var keys = PermissionCatalog.definitions().stream().map(definition -> definition.key().value()).toList();

        assertThat(keys).doesNotHaveDuplicates();
        assertThat(keys).allMatch(key -> key.split("\\.").length == 3);
    }

    /**
     * 리소스 권한은 리소스 종류와 ACL 작업을 가지고, 학원 권한은 가지지 않는지 확인
     */
    @Test
    void resourceContractMatchesTargetType() {
        for (var definition : PermissionCatalog.definitions()) {
            var resource = definition.targetType() == PermissionTargetType.RESOURCE;

            assertThat(definition.resourceType() != null).isEqualTo(resource);
            assertThat(definition.resourceAction() != null).isEqualTo(resource);
        }
    }

    /**
     * 권한은 계약과 정확히 같은 대상·작업만 지원하는지 확인
     */
    @Test
    void supportsOnlyTheExactTargetAndAction() {
        var academyId = UUID.randomUUID();
        var context = new ResourceContext(academyId, ResourceType.STORAGE_NODE, UUID.randomUUID(), List.of());
        var academy = new AuthorizationTarget.Academy(academyId);
        var read = new AuthorizationTarget.Resource(context, ResourceAction.READ);
        var write = new AuthorizationTarget.Resource(context, ResourceAction.WRITE);

        assertThat(PermissionCatalog.ACCESS_ROLE_READ.supports(academy)).isTrue();
        assertThat(PermissionCatalog.ACCESS_ROLE_READ.supports(read)).isFalse();
        assertThat(PermissionCatalog.STORAGE_FILE_READ.supports(read)).isTrue();
        assertThat(PermissionCatalog.STORAGE_FILE_READ.supports(write)).isFalse();
        assertThat(PermissionCatalog.STORAGE_FILE_READ.supports(academy)).isFalse();
    }

    /**
     * 형식에 맞지 않는 권한 키는 만들 수 없는지 확인
     */
    @Test
    void rejectsMalformedKey() {
        assertThatThrownBy(() -> new PermissionKey("Storage.File")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new PermissionKey("storage")).isInstanceOf(IllegalArgumentException.class);
    }
}
