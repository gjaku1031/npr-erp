# 개발 규칙

## 변경 범위

필요한 수직 기능만 구현한다. 미래를 위한 빈 모듈, 전역 `common/shared/utils`, 범용 정책 DSL과
불필요한 인터페이스를 만들지 않는다.

## Java·Spring

- 메인·테스트 소스는 Java만 사용한다. 정확한 버전은 `build.gradle`이 원본이다.
- 업무 모듈을 먼저 나누고 내부는 기능별 패키지로 구성한다. 공개 계약은 모듈 루트, 구현은 `internal`에 둔다.
- 다른 모듈의 Entity·Repository·내부 패키지를 참조하지 않는다. 공개 계약과 ID로 협력한다.
  Java의 `public`만으로는 경계가 지켜지지 않으므로 Modulith 검증(`ModularityTest`)을 함께 실행한다.
- `bootstrap`이 다른 모듈을 조합한다. `identity`, `accesscontrol`, `storage`, `tng`는 서로 의존하지 않고,
  `worklog`는 `tng`의 공개 포트에만 의존한다.
- 클래스는 `final`로 선언한다. 프록시 대상(`@Transactional`이 붙은 Spring 빈, JPA Entity)만 예외다.
- 의존성은 `private final` 필드와 Lombok `@RequiredArgsConstructor`로 주입한다.
- Entity는 `@Getter`, protected 기본 생성자, 업무 생성자, 상태를 바꾸는 도메인 메서드로 구성한다. setter를 두지 않는다.
  Entity를 모듈 밖이나 화면으로 내보내지 않는다. 조회 결과와 입력은 `record`로 만든다.
- JPA는 상태 전이가 있는 변경에, jOOQ는 집계·목록 조회와 행 단위 자료에 사용한다.
  Flyway SQL이 스키마 원본이며 jOOQ 코드는 그 SQL에서 생성한다. 적용된 SQL은 수정하지 않는다.
- 외부 호출 동안 DB 트랜잭션을 유지하지 않는다. `짧은 DB 기록 → 트랜잭션 밖 호출 → 짧은 DB 확정`으로 나누고,
  결과를 알 수 없는 호출은 다시 보내기 전에 외부 상태와 대조한다.

## 주석

설명 주석과 Javadoc은 한국어로, 명사형이나 `~함` 형태로 쓴다. 식별자·표준 기술명은 원문을 유지한다.
모든 타입·필드·메서드 앞에 여러 줄 Javadoc을 두고, 동작의 번역보다 계약·이유·보안 경계를 설명한다.
`record`의 구성 요소는 `@param`으로, 메서드는 필요한 `@param`, `@return`, `@throws`로 적는다.
구현체는 `{@inheritDoc}`로 공개 계약을 가리킨다. 패키지 전체 이름을 본문에 쓰지 않고 import한다.

## 보안·오류

인증은 [서버 세션](../architecture/authentication.md), 업무 권한은 [권한 엔진](../architecture/authorization.md)이 담당한다.
권한을 세션에 복사하거나 개발 편의를 위해 CSRF를 끄지 않는다.
컨트롤러는 모듈의 공개 계약을 부르기 전에 `Guard`로 권한 엔진을 거친다. 메뉴와 버튼을 숨기는 것으로 이를 대신하지 않는다.
업무 예외는 안정적인 `code`를 가진다. 내부 예외 메시지·stack trace·비밀번호 해시는 화면에 노출하지 않는다.
사용자가 넣은 글은 이스케이프해서 출력하고, 올린 파일은 항상 내려받기로 응답한다.

## 검증

| 종류 | 확인할 것 |
|---|---|
| 단위 | 순수 정책·상태 전이, 외부 경계 대역 |
| 구조 | Modulith 의존 방향 |
| 통합 | 실제 PostgreSQL, Flyway, JPA·jOOQ, 동시성, 화면 요청의 권한 강제 |

DB 통합 테스트를 H2로 바꾸지 않는다. 임베디드 PostgreSQL을 사용한다.
문서 변경은 [작성 규칙](documentation.md)을 따르고 코드 변경과 함께 반영한다.
