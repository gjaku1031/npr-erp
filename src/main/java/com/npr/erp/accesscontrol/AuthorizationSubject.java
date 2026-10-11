package com.npr.erp.accesscontrol;

import java.util.UUID;

/**
 * 인가를 요청하는 주체
 *
 * 호출 전에 계정이 활성 상태인지 확인해야 함. 권한 회수가 다음 요청부터 바로 반영되도록 소속·역할·권한 사본은
 * 담지 않고, 판단할 때마다 DB의 현재 값을 읽음
 *
 * @param accountId 활성 계정 ID
 */
public record AuthorizationSubject(UUID accountId) {
}
