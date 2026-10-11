# ADR-0001: JPA 명령 모델과 jOOQ 조회 모델의 점진적 병행

> 상태: Accepted  
> 결정일: 2026-08-29  
> 결정자: NPR 프로젝트  

## 컨텍스트

이 애플리케이션은 Spring Boot, Spring Data JPA와 PostgreSQL을 사용하는 장기 유지 시스템이다. 학생, 반, 수강과 권한처럼 상태 변경과 불변 조건이 중요한 업무가 있는 한편, 목록 검색, 통계, 대시보드, 외부 ERP 동기화 검증과 데이터 대사처럼 복잡한 읽기 요구도 점차 늘어날 것으로 예상한다.

JPA는 Aggregate의 객체 그래프, 변경 감지, 낙관적 잠금과 트랜잭션 기반 상태 변경에 적합하다. 그러나 복잡한 조인, 집계, CTE, 윈도 함수, PostgreSQL 전용 기능과 읽기 전용 DTO를 JPQL과 Entity 중심으로만 구현하면 SQL을 통제하기 어렵고 조회 모델이 Domain Entity 구조에 끌려갈 수 있다.

Querydsl JPA는 타입 안전한 동적 JPQL 작성에 편리하지만 실제 SQL API가 아니므로 JPQL과 JPA Provider의 제약을 그대로 받는다. 또한 원본 Querydsl의 유지보수가 느려져 OpenFeign 포크가 만들어졌고, Spring Data는 해당 포크를 최선 노력 방식으로 지원한다.

반면 Spring Boot는 jOOQ 버전과 `DSLContext` 구성을 직접 지원한다. jOOQ는 JPA의 대체재가 아니라 SQL이 적합한 리포트, 분석과 복잡한 조회를 보완하는 도구로 사용할 수 있다.

## 결정 요인

- 상태 변경은 Domain Aggregate의 불변 조건을 반드시 통과해야 한다.
- 단순한 CRUD와 검색을 위해 두 개의 영속성 접근 방식을 강제하지 않는다.
- 복잡한 조회는 Entity 그래프가 아니라 필요한 읽기 모델에 맞게 설계할 수 있어야 한다.
- Flyway 마이그레이션과 실제 PostgreSQL 스키마를 데이터베이스 계약의 원본으로 유지한다.
- 빌드와 코드 생성 도구의 수를 불필요하게 늘리지 않는다.
- 모듈 데이터 소유권과 JPA 영속성 컨텍스트의 일관성을 훼손하지 않는다.

## 검토한 선택지

### JPA와 Spring Data 파생 쿼리만 사용

초기 구성이 가장 단순하다. 그러나 조건 조합이 늘어나면 Repository 메서드가 증가하고, 복잡한 조회를 JPQL 문자열이나 Native Query로 우회하게 될 가능성이 높다.

### JPA와 Spring Data Specification만 사용

Spring Data JPA 4의 `PredicateSpecification`과 `Specification`은 간단한 동적 조건을 조합하기에 충분하다. 다만 복잡한 프로젝션, 다중 집계와 PostgreSQL 중심 SQL을 표현하는 주 도구로 사용하면 Criteria API 코드가 읽기 어려워진다.

### JPA와 Querydsl JPA 사용

동적 조건과 Entity 중심 조회 문법이 간결하고 같은 `EntityManager`를 사용한다. 그러나 Querydsl JPA는 타입 안전한 JPQL 빌더이므로 SQL 기능 전체를 제공하지 않으며, Domain Entity의 Q 타입에 조회 코드가 결합한다. 현재 유지보수 주체와 Spring Data 통합도 프로젝트가 직접 검증해야 한다.

### JPA와 jOOQ를 모든 조회에 즉시 사용

복잡한 SQL을 가장 잘 통제할 수 있지만 단순한 Entity 조회까지 jOOQ로 이중 구현하면 학습과 빌드 복잡성만 증가한다. 실제 요구가 없는 조회 코드와 패키지를 미리 만들게 된다.

### JPA를 기본으로 사용하고 필요한 조회부터 jOOQ 도입

명령과 단순 조회는 JPA에 유지하고, Spring Data Specification으로 감당하기 어려운 첫 읽기 모델부터 jOOQ를 사용한다. 두 기술의 책임을 분리하면서 초기 복잡성을 제한할 수 있다.

## 결정

1. Flyway SQL 마이그레이션을 PostgreSQL 스키마의 유일한 원본으로 사용한다.
2. Aggregate 생성과 상태 변경, 일반 CRUD, 잠금과 단순 Entity 조회는 Spring Data JPA가 담당한다.
3. 선택 조건이 몇 개 조합되는 수준의 단순 동적 검색은 Spring Data JPA의 `PredicateSpecification` 또는 `Specification`을 우선 사용한다.
4. 복잡한 목록, 다중 조인, 통계, 리포트, 대시보드, 데이터 대사, CTE, 윈도 함수와 PostgreSQL 전용 SQL은 jOOQ 기반 전용 Query Repository가 담당한다.
5. Querydsl JPA는 초기 기본 의존성에 포함하지 않는다. JPA Specification과 jOOQ 사이에 별도의 Query DSL을 추가할 명확한 이점이 생길 때 새 ADR로 재검토한다.
6. jOOQ 조회는 Aggregate를 반환하지 않고 해당 유스케이스에 필요한 읽기 전용 DTO 또는 Projection을 반환한다.
7. JPA가 소유한 테이블에 대한 쓰기는 JPA로만 수행한다. jOOQ를 이용한 직접 `INSERT`, `UPDATE`, `DELETE`는 초기 규칙에서 금지한다.
8. jOOQ 생성 코드는 JPA Entity가 아니라 Flyway가 표현하는 실제 스키마를 기준으로 만든다.
9. 단순 조회를 억지로 jOOQ로 옮기지 않고, 실제 복잡한 읽기 요구가 생긴 시점에 프로덕션 jOOQ 쿼리를 추가한다. 기반 설정 단계에서는 codegen과 PostgreSQL 통합 smoke test까지만 둘 수 있다.
10. 조회가 여러 업무 모듈의 테이블을 결합하면 임의로 다른 모듈의 내부 Entity나 Repository를 사용하지 않는다. 공개 Query API 또는 소유권이 명시된 통합 읽기 모델로 둔다.

## 트랜잭션과 일관성 규칙

JPA와 jOOQ는 같은 Spring DataSource와 트랜잭션 경계에서 사용할 수 있다. 그러나 JPA가 이미 적재한 행을 같은 트랜잭션에서 jOOQ로 변경하면 JPA 1차 캐시와 데이터베이스 상태가 달라질 수 있다. 이 위험을 피하기 위해 jOOQ를 읽기 전용으로 제한한다.

향후 대량 쓰기 성능 때문에 jOOQ DML이 필요해지면 다음 항목을 별도 결정한다.

- 해당 테이블과 트랜잭션의 명시적 소유자
- JPA `flush`와 영속성 컨텍스트 `clear` 시점
- 낙관적 잠금과 감사 필드 처리
- 실패 원자성, 재시도와 멱등성
- 동일 동작을 검증하는 실제 PostgreSQL 통합 테스트

## 결과

### 긍정적 결과

- 상태 변경은 JPA Aggregate의 행위와 불변 조건을 계속 통과한다.
- 단순한 기능은 Spring Data JPA만으로 빠르게 구현할 수 있다.
- 복잡한 조회는 실제 SQL 구조와 실행 계획을 직접 통제할 수 있다.
- 읽기 DTO가 JPA 연관관계와 Entity 그래프에 끌려가지 않는다.
- Querydsl, JPA와 jOOQ 세 가지 조회 방식을 동시에 유지하는 상황을 피한다.
- Flyway 스키마 변경이 jOOQ 생성 코드와 컴파일 오류에 반영된다.

### 부정적 결과와 비용

- jOOQ를 도입하는 시점부터 codegen과 생성 소스 관리가 빌드에 추가된다.
- 개발자는 JPA 객체 그래프 방식과 SQL 집합 처리 방식을 모두 이해해야 한다.
- JPA와 jOOQ 사이의 쓰기 책임을 코드 리뷰와 테스트에서 계속 지켜야 한다.
- 복잡한 통합 읽기 모델은 모듈 간 데이터 소유권을 별도로 설명해야 한다.
- jOOQ Open Source Edition은 각 릴리스에서 최신 PostgreSQL dialect를 공식 지원하므로 실제 PostgreSQL 버전과 jOOQ 버전의 지원 조합을 확인해야 한다.

## 안전 조건

- `spring.jpa.hibernate.ddl-auto=validate`를 사용하고 애플리케이션이 스키마를 생성하거나 변경하지 않게 한다.
- H2로 PostgreSQL 동작을 대체하지 않고 Testcontainers의 실제 PostgreSQL로 JPA와 jOOQ 통합 테스트를 실행한다.
- jOOQ codegen 입력과 Flyway 마이그레이션 순서가 CI와 로컬에서 결정적으로 같아야 한다.
- 중요한 목록과 통계 쿼리는 결과뿐 아니라 페이지 경계, 정렬 안정성, N+1과 실행 SQL을 검증한다.
- jOOQ Query Repository가 다른 업무 모듈의 내부 타입이나 Repository에 의존하지 않게 Spring Modulith 검증을 유지한다.
- Spring Boot가 관리하는 jOOQ 버전과 배포 PostgreSQL의 공식 지원 조합을 프로젝트 기반 설정에서 확정한다. 지원 범위가 맞지 않으면 DB 버전, jOOQ 버전 또는 Edition 선택을 명시적으로 결정한다.

## 후속 작업

- 기반 설정에서 Flyway, JPA와 실제 PostgreSQL 통합 테스트를 먼저 구성한다.
- 단순 동적 검색의 공통 규칙과 `PredicateSpecification` 예제를 첫 검색 기능에서 확정한다.
- 첫 복잡한 읽기 요구가 생기면 jOOQ codegen, 생성 소스 위치와 Query Repository 테스트 규칙을 구현한다.
- jOOQ를 구성할 때 Spring Boot 관리 버전과 PostgreSQL major version의 공식 지원 조합을 확인하고 기록한다.
- 성능이 중요한 조회는 운영 데이터와 유사한 분포에서 `EXPLAIN` 기반으로 검증한다.

## 관련 문서

- [Pragmatic Hexagonal Modular Monolith](../architecture/overview.md)

## 공식 참고 자료

- [Spring Data JPA Specifications](https://docs.spring.io/spring-data/jpa/reference/jpa/specifications.html)
- [Spring Data Querydsl Extension과 OpenFeign 포크 지원 정책](https://docs.spring.io/spring-data/relational/reference/repositories/core-extensions.html)
- [Spring Boot SQL Database와 jOOQ 지원](https://docs.spring.io/spring-boot/reference/data/sql.html)
- [Spring Boot 관리 의존성 버전](https://docs.spring.io/spring-boot/appendix/dependency-versions/coordinates.html)
- [jOOQ and JPA](https://www.jooq.org/doc/latest/manual/getting-started/jooq-and-jpa/)
- [jOOQ Code Generation](https://www.jooq.org/doc/latest/manual/code-generation/)
- [jOOQ RDBMS Support Matrix](https://www.jooq.org/download/support-matrix)
