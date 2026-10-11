package com.npr.erp;

import com.npr.erp.integration.PostgreSqlTestConfiguration;
import org.springframework.boot.SpringApplication;

/**
 * 따로 DB를 띄우지 않고 시연 데이터가 든 서버를 실행
 *
 * 임베디드 PostgreSQL을 쓰므로 끄면 데이터가 사라짐. {@code ./gradlew demoRun}으로 실행함
 */
public final class DemoServer {
    /**
     * 인스턴스를 만들지 않는 실행 진입점
     */
    private DemoServer() {
    }

    /**
     * local 프로필로 서버 실행
     *
     * @param args 명령 인자
     */
    public static void main(String[] args) {
        var application = new SpringApplication(NprErpApplication.class, PostgreSqlTestConfiguration.class);
        application.setAdditionalProfiles("local");
        application.run(args);
    }
}
