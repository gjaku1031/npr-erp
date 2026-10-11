# ADR-0004: 권한 엔진은 소비 도메인의 실제 요구가 생길 때만 확장한다

> 상태: Accepted  
> 결정일: 2026-08-31  
> 결정자: NPR 프로젝트  
> 관련 결정: [ADR-0003](0003-separate-platform-superuser-from-academy-rbac.md)

## 컨텍스트

`identity + accesscontrol` 권한 엔진 v1 구현이 완료되었다. 현재 엔진은 다음 공통 인가 기반을 제공한다.

```text
ACTIVE Account
→ 플랫폼 슈퍼유저 확인
→ Academy Membership
→ Role / Permission
→ Academy 범위
→ Resource 요청이면 ACL
→ ALLOW / DENY와 감사
```

다음 제품 단계는 파일 저장소를 다루는 `storage`이며, 이후 ERP의 `student`, `classroom`, `enrollment` 같은 실제 업무 도메인이 추가된다.

이 시점에 TEAM, CLASSROOM scope, 범용 ABAC DSL, Role hierarchy, 명시적 ACL DENY, 외부 Policy Engine 등을 미리 추가하면 실제 소비자가 없는 추상화와 정책 복잡성이 증가한다. 반대로 `강사는 본인이 담당하는 반의 학생만 조회할 수 있다` 같은 규칙은 공통 권한 엔진만으로 결정할 수 없고 Classroom·Enrollment 원장 관계가 실제로 존재해야 안전하게 판단할 수 있다.

## 결정

### 1. 권한 엔진 v1을 현재 상태에서 기능 동결한다

Storage 또는 ERP의 실제 수직 기능이 요구하기 전에는 `accesscontrol`의 정책 모델을 선제적으로 확장하지 않는다.

현재 공통 엔진의 책임은 다음으로 유지한다.

```text
공통 인가
├── ACTIVE Account 전제
├── 플랫폼 슈퍼유저
├── Academy Membership
├── Role / Permission
├── Academy 범위
├── Resource ACL
├── 권한 변경 동시성·lockout
└── 감사
```

다음 항목은 실제 소비 요구가 생기기 전에는 추가하지 않는다.

```text
TEAM / CLASSROOM 공통 scope
범용 Attribute Map
범용 ABAC DSL
Role hierarchy
명시적 ACL DENY
파일별 ACL
권한 cache
OPA / Cedar / OpenFGA 같은 외부 Policy Engine
```

### 2. Storage는 기존 권한 엔진을 소비한다

Storage 단계의 작업은 새로운 범용 권한 모델을 설계하는 일이 아니라 현재 공개 계약을 실제 Resource에 연결하는 일이다.

```text
StorageNode 원장 조회
→ 실제 academyId·부모·조상 검증
→ ResourceContext 생성
→ Authorizer.authorize() 또는 filterPermitted()
→ ALLOW 뒤에만 저장소 호출
```

Folder ACL HTTP 경계는 Storage가 리소스 존재성과 Academy 일치를 검증한 뒤 `ResourceAclManagement`를 호출한다.

Storage 구현 중 기존 계약으로 표현할 수 없는 실제 사례가 발견되면 그 사례를 근거로 최소한의 `ResourceType`, `ResourceAction`, Permission 또는 공개 계약 확장을 검토한다.

### 3. ERP의 담당 반 같은 규칙은 도메인 ABAC로 구현한다

예를 들어 다음 정책은 현재 권한 엔진 v1에 미리 넣지 않는다.

> 강사는 본인이 담당하는 반의 학생만 조회할 수 있다.

ERP 도메인이 구현되면 판단을 다음처럼 결합한다.

```text
공통 Authorizer
├── ACTIVE Membership
├── erp.student.read Permission
└── Academy 범위

Student / Classroom / Enrollment 도메인
└── 요청 학생이 현재 강사의 담당 반에 속하는가?

둘 다 통과
→ ALLOW
```

담당 반, 담당 강사, 재원 상태와 팀 관계의 원장은 해당 업무 모듈이 소유한다. `accesscontrol`은 이를 얻기 위해 `student`, `classroom`, `enrollment` Repository를 직접 조회하지 않는다.

### 4. 공통 권한 엔진과 도메인 정책의 경계를 유지한다

공통 엔진은 여러 업무에서 재사용 가능한 기능 자격과 공통 범위를 판단한다.

도메인 정책은 해당 업무 원장만이 알 수 있는 관계를 판단한다.

```text
공통 권한 엔진
→ "이 Account가 학생 조회 기능을 사용할 기본 자격이 있는가?"

Student 도메인 정책
→ "이 Account가 이 정확한 학생을 조회할 관계가 있는가?"
```

Application Service의 PEP가 필요한 판단을 결합하며, 허용되기 전에는 데이터 반환이나 외부 부작용을 실행하지 않는다.

### 5. 권한 엔진 재개발 조건

다음 중 하나가 실제 수직 기능에서 확인될 때에만 권한 엔진 확장을 시작한다.

- 기존 Permission과 Target 계약으로 필요한 기능을 표현할 수 없다.
- 하나의 도메인 규칙이 여러 독립 업무 모듈에서 반복되어 공통화 가치가 확인된다.
- 현재 ACL 모델로 실제 Resource 정책을 표현할 수 없다.
- 권한 조회가 측정 가능한 성능 병목이 된다.
- 여러 서비스가 같은 권한 원장을 공유해야 한다.
- 현재 감사·회수 일관성 요구를 충족하지 못하는 실제 운영 사례가 생긴다.

확장이 아키텍처 의미를 바꾸면 새 ADR을 작성한다.

## 결과

### 긍정적 결과

- 첫 권한 엔진을 불필요하게 범용 정책 플랫폼으로 키우지 않는다.
- Storage와 ERP 개발이 실제 요구를 권한 모델에 공급한다.
- `accesscontrol`의 leaf 모듈 경계를 유지할 수 있다.
- Classroom·Enrollment 같은 업무 관계를 소유 모듈에서 정확하게 판단할 수 있다.
- 새로운 권한 기능마다 구체적인 소비 사례와 테스트 시나리오가 존재하게 된다.

### 비용과 한계

- ERP 첫 수직 기능에서는 공통 Permission 외에 도메인 ABAC를 새로 구현해야 한다.
- 향후 여러 모듈에서 같은 관계 정책이 반복되면 뒤늦게 공통 추상화를 추출할 수 있다.
- 현재 v1이 모든 미래 권한 요구를 해결한다고 가정하지 않는다.
