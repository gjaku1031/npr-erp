/**
 * 로그인 계정과 비밀번호를 소유하는 모듈
 *
 * 다른 업무 모듈에 의존하지 않음. 계정의 학원 소속과 권한은 accesscontrol이 소유함
 */
@ApplicationModule(displayName = "Identity", allowedDependencies = {})
package com.npr.erp.identity;

import org.springframework.modulith.ApplicationModule;
