package com.npr.erp.accesscontrol;

/**
 * 권한 키, 역할 이름, ACL 주체 같은 요청 값이 규칙에 어긋남
 */
public final class AccessControlValidationException extends AccessControlException {
    /**
     * 오류 코드와 설명으로 예외 생성
     *
     * @param code 고정 오류 코드
     * @param message 진단용 설명
     */
    public AccessControlValidationException(String code, String message) {
        super(code, message);
    }
}
