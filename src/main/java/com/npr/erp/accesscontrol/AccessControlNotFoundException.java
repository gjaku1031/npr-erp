package com.npr.erp.accesscontrol;

/**
 * 권한 정책 데이터를 찾을 수 없음
 */
public final class AccessControlNotFoundException extends AccessControlException {
    /**
     * 오류 코드와 설명으로 예외 생성
     *
     * @param code 고정 오류 코드
     * @param message 진단용 설명
     */
    public AccessControlNotFoundException(String code, String message) {
        super(code, message);
    }
}
