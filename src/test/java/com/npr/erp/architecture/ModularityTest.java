package com.npr.erp.architecture;

import com.npr.erp.NprErpApplication;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

/**
 * 모듈 경계 검사
 */
class ModularityTest {
    /**
     * 모듈이 선언한 의존만 쓰고 다른 모듈의 internal 패키지를 참조하지 않는지 확인
     */
    @Test
    void modulesRespectDeclaredBoundaries() {
        ApplicationModules.of(NprErpApplication.class).verify();
    }
}
