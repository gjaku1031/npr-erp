package com.npr.erp.bootstrap.web;

import com.npr.erp.accesscontrol.AcademyCapabilities;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.PermissionDefinition;
import com.npr.erp.identity.AuthenticatedAccount;
import java.util.UUID;

/**
 * 한 요청이 누구의 것이고 어느 학원을 향하는지
 *
 * 권한 요약은 메뉴와 버튼을 보여 줄지 정하는 데만 씀. 실제 허용 여부는 요청을 처리할 때 권한 엔진에 다시 물음
 *
 * @param academyId 학원 ID
 * @param academyName 학원 이름
 * @param account 로그인한 계정
 * @param capabilities 이 학원에서 가진 권한 요약
 */
public record AcademyContext(
        UUID academyId, String academyName, AuthenticatedAccount account, AcademyCapabilities capabilities) {
    /**
     * 요청 속성과 화면 모델에서 쓰는 이름
     */
    public static final String ATTRIBUTE = "ctx";

    /**
     * 로그인한 계정 ID
     *
     * @return 계정 ID
     */
    public UUID accountId() {
        return account.accountId();
    }

    /**
     * 권한 엔진에 넘길 주체
     *
     * @return 로그인한 계정을 가리키는 주체
     */
    public AuthorizationSubject subject() {
        return new AuthorizationSubject(account.accountId());
    }

    /**
     * 권한을 가졌는지
     *
     * @param permission 권한 정의
     * @return 권한 요약에 있으면 true
     */
    public boolean can(PermissionDefinition permission) {
        return capabilities.has(permission);
    }

    /**
     * 권한 키로 권한을 가졌는지 확인. 화면에서 씀
     *
     * @param permissionKey 권한 키
     * @return 권한 요약에 있으면 true
     */
    public boolean can(String permissionKey) {
        return capabilities.permissions().contains(permissionKey);
    }

    /**
     * 여러 권한 가운데 하나라도 가졌는지 확인. 화면에서 씀
     *
     * @param permissionKeys 권한 키 목록
     * @return 하나라도 있으면 true
     */
    public boolean canAny(String... permissionKeys) {
        for (var key : permissionKeys) {
            if (can(key)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 변경 요청에 실어 보낼 정책 버전
     *
     * @return 화면을 그릴 때의 정책 버전
     */
    public long policyVersion() {
        return capabilities.policyVersion();
    }

    /**
     * 이 학원 안의 경로
     *
     * @param suffix 학원 경로 뒤에 붙일 부분
     * @return 학원 ID가 들어간 경로
     */
    public String path(String suffix) {
        return "/a/" + academyId + suffix;
    }
}
