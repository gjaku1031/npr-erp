/**
 * 조합 모듈: 로그인, 화면, 시연 데이터처럼 여러 모듈을 엮는 일을 맡음
 *
 * 업무 규칙은 두지 않음. 화면 요청마다 누가 무엇을 하려는지를 권한 엔진에 묻고, 허용되면 해당 모듈의 공개 계약을
 * 호출함. 다른 모듈은 이 모듈에 의존하지 않음
 */
@ApplicationModule(
        displayName = "Bootstrap",
        allowedDependencies = {"identity", "accesscontrol", "storage", "tng", "worklog"})
package com.npr.erp.bootstrap;

import org.springframework.modulith.ApplicationModule;
