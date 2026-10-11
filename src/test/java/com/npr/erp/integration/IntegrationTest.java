package com.npr.erp.integration;

import com.npr.erp.NprErpApplication;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.junit.jupiter.api.Tag;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * 전체 컨텍스트와 실제 PostgreSQL을 쓰는 통합 테스트 표시
 *
 * {@code integrationTest} 작업에서만 실행됨
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Tag("integration")
@ActiveProfiles("test")
@SpringBootTest(classes = {NprErpApplication.class, PostgreSqlTestConfiguration.class})
public @interface IntegrationTest {
}
