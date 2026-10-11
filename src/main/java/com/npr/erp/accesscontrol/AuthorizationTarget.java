package com.npr.erp.accesscontrol;

import java.util.UUID;

/**
 * 권한을 적용할 대상
 *
 * 학원 전체에 대한 기능이거나, 특정 리소스에 대한 작업 둘 중 하나임
 */
public sealed interface AuthorizationTarget {
    /**
     * 대상이 속한 학원 ID
     *
     * @return 학원 ID
     */
    UUID academyId();

    /**
     * 학원 범위 기능의 대상
     *
     * @param academyId 권한을 평가할 학원 ID
     */
    record Academy(UUID academyId) implements AuthorizationTarget {
    }

    /**
     * 리소스와 ACL 작업을 함께 평가하는 대상
     *
     * @param context 리소스 소유 모듈이 만든 문맥
     * @param action 요구할 ACL 작업
     */
    record Resource(ResourceContext context, ResourceAction action) implements AuthorizationTarget {
        /**
         * 리소스를 소유한 학원 ID
         */
        @Override
        public UUID academyId() {
            return context.academyId();
        }
    }
}
