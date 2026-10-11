package com.npr.erp.accesscontrol;

import java.util.UUID;

/**
 * ACL을 받는 주체
 */
public sealed interface ResourceAclSubject {
    /**
     * 계정 하나
     *
     * @param accountId 계정 ID. 같은 학원에 활성 소속이 있어야 함
     */
    record Account(UUID accountId) implements ResourceAclSubject {
    }

    /**
     * 역할 하나
     *
     * @param roleId 역할 ID. 같은 학원의 활성 역할이어야 함
     */
    record Role(UUID roleId) implements ResourceAclSubject {
    }
}
