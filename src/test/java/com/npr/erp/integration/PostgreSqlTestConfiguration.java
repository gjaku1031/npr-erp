package com.npr.erp.integration;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.sql.DataSource;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * 통합 테스트용 PostgreSQL 구성
 *
 * H2로 바꾸지 않고 실제 PostgreSQL을 프로세스로 띄움. advisory lock, 부분 유니크 인덱스, JSONB 같은 PostgreSQL
 * 고유 기능을 검사해야 하기 때문임
 */
@TestConfiguration(proxyBeanMethods = false)
public class PostgreSqlTestConfiguration {
    /**
     * 임베디드 PostgreSQL 시작
     *
     * 같은 구성을 쓰는 테스트 클래스들은 Spring이 컨텍스트를 재사용하므로 서버도 한 번만 뜸
     *
     * @return 컨텍스트가 닫힐 때 함께 종료되는 서버
     * @throws IOException 데이터 디렉터리를 만들거나 서버를 띄우지 못했을 때
     */
    @Bean(destroyMethod = "close")
    public EmbeddedPostgres embeddedPostgres() throws IOException {
        var baseDirectory = Path.of("build", "embedded-postgres").toAbsolutePath();
        Files.createDirectories(baseDirectory);
        return EmbeddedPostgres.builder()
                .setOverrideWorkingDirectory(baseDirectory.toFile())
                .setDataDirectory(Files.createTempDirectory(baseDirectory, "data-"))
                .setCleanDataDirectory(true)
                .setPort(0)
                .setServerConfig("timezone", "UTC")
                .start();
    }

    /**
     * 애플리케이션이 쓸 데이터 소스를 임베디드 서버로 교체
     *
     * @param postgres 임베디드 서버
     * @return 기본 데이터베이스의 데이터 소스
     */
    @Bean
    @Primary
    public DataSource dataSource(EmbeddedPostgres postgres) {
        return postgres.getPostgresDatabase();
    }
}
