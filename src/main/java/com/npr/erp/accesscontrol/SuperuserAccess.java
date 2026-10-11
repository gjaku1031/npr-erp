package com.npr.erp.accesscontrol;

/**
 * 플랫폼 슈퍼유저 전용 경계의 확인 계약
 */
public interface SuperuserAccess {
    /**
     * 슈퍼유저인지 확인하고 결과를 감사 기록에 남김
     *
     * @param subject 확인할 주체
     * @param requestId 감사 기록과 연결할 요청 추적 ID. 없으면 null
     * @return 슈퍼유저이면 허용 결정
     */
    AuthorizationDecision authorize(AuthorizationSubject subject, String requestId);

    /**
     * 감사 기록 없이 슈퍼유저 여부만 확인
     *
     * 화면에 메뉴를 보여 줄지 정할 때 씀
     *
     * @param subject 확인할 주체
     * @return 슈퍼유저이면 true
     */
    boolean isSuperuser(AuthorizationSubject subject);
}
