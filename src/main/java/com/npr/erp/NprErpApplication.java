package com.npr.erp;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * NPR ERP 애플리케이션 진입점
 *
 * {@code --npr-command=} 인자가 있으면 운영 명령만 실행하고 종료함
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class NprErpApplication {
    /**
     * 운영 명령을 뜻하는 실행 인자 접두어
     */
    public static final String COMMAND_PREFIX = "--npr-command=";

    /**
     * 애플리케이션 시작
     *
     * @param args 실행 인자
     */
    public static void main(String[] args) {
        var context = SpringApplication.run(NprErpApplication.class, args);

        // 운영 명령은 웹 서버로 남지 않고 실행 결과를 종료 코드로 돌려줌
        for (var argument : args) {
            if (argument.startsWith(COMMAND_PREFIX)) {
                System.exit(SpringApplication.exit(context));
            }
        }
    }
}
