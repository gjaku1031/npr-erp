# NPR ERP

학원 운영을 위한 사내 ERP다. 로그인, 권한 엔진, 자료실, 업무일지를 하나의 Spring Modulith 애플리케이션으로 제공한다.

| 구분 | 사용 기술 |
|---|---|
| 언어·프레임워크 | Java 25, Spring Boot 4, Spring Modulith, Spring Security |
| 영속성 | PostgreSQL, Flyway, JPA(Hibernate), jOOQ |
| 화면 | Thymeleaf(서버 렌더링), 폼 로그인, CSRF |

```bash
# DB를 따로 띄우지 않고 시연 데이터로 실행. http://localhost:8080
./gradlew demoRun
```

시연 계정과 실행 방법은 [로컬 실행](docs/development/quickstart.md), 문서 전체는 **[docs/README.md](docs/README.md)**에서 시작한다.
