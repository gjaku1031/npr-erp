package com.npr.erp.accesscontrol;

import java.util.UUID;

/**
 * 플랫폼 슈퍼유저 부여·회수 계약
 *
 * 운영 명령에서만 호출함
 */
public interface SuperuserManagement {
    /**
     * 슈퍼유저 부여
     *
     * 등록된 슈퍼유저가 하나도 없을 때는 실행자 없이 첫 슈퍼유저만 부여할 수 있음
     *
     * @param targetAccountId 대상 계정 ID
     * @param actorAccountId 실행하는 기존 슈퍼유저. 첫 부여이면 null
     * @param reason 감사 기록에 남길 사유
     * @return 새로 부여했으면 true, 이미 슈퍼유저였으면 false
     * @throws AccessControlConflictException 첫 부여인데 실행자가 있거나, 추가 부여인데 실행자가 슈퍼유저가 아닐 때
     */
    boolean grant(UUID targetAccountId, UUID actorAccountId, String reason);

    /**
     * 슈퍼유저 회수
     *
     * @param targetAccountId 대상 계정 ID
     * @param actorAccountId 실행하는 슈퍼유저
     * @param reason 감사 기록에 남길 사유
     * @return 회수했으면 true, 원래 슈퍼유저가 아니었으면 false
     * @throws AccessControlConflictException 실행자가 슈퍼유저가 아닐 때
     */
    boolean revoke(UUID targetAccountId, UUID actorAccountId, String reason);
}
