package com.npr.erp.accesscontrol;

/**
 * 정책 버전이 어긋났거나 마지막 관리자를 없애는 변경처럼 현재 상태와 충돌함
 */
public final class AccessControlConflictException extends AccessControlException {
    /**
     * 오류 코드와 설명으로 예외 생성
     *
     * @param code 고정 오류 코드
     * @param message 진단용 설명
     */
    public AccessControlConflictException(String code, String message) {
        super(code, message);
    }
}
