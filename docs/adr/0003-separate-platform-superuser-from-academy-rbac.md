# ADR-0003: 플랫폼 슈퍼유저를 Academy RBAC와 분리

> 상태: Accepted  
> 결정일: 2026-08-31  
> 결정자: NPR 프로젝트  
> 관련 결정: [ADR-0002](0002-admin-managed-authorization-and-system-superuser.md)

## 컨텍스트

[ADR-0002](0002-admin-managed-authorization-and-system-superuser.md)는 Academy Role과 폴더 Policy를 관리자 구성 데이터로 두고 `SYSTEM_ADMIN`을 플랫폼 전체 슈퍼유저로 정의했다.

초기 코드 계약에서는 이 슈퍼유저를 일반 RBAC 안의 특수한 `SYSTEM` Role로 표현했다.

```text
Role
├── SYSTEM_RESERVED / SYSTEM_ADMIN
└── ACADEMY_CUSTOM / 관리자 Role

Role Assignment
├── SYSTEM scope
└── ACADEMY scope

Permission
├── 플랫폼 운영 기능용 Permission
└── Academy 업무 Permission
```

이 방식은 저장 테이블을 재사용할 수 있지만 다음 복잡성을 만들었다.

- Academy Role은 학원 관리자가 구성하는 Permission 묶음인데 `SYSTEM_ADMIN`은 Permission과 ACL을 전부 우회하므로 같은 개념이 아니다.
- `SYSTEM_ADMIN` 한 종류를 표현하기 위해 `SYSTEM` target, system Role 종류, system Assignment와 system Permission이 일반 권한 엔진 전체에 들어갔다.
- 슈퍼유저만 접근할 플랫폼 운영 기능에도 실제로 사용되지 않는 Permission이 필요해졌다.
- Academy 관리자 API에서 시스템 예약 Role을 제외하는 예외 규칙이 계속 필요하다.
- 향후 제한된 플랫폼 운영 역할이 필요해지더라도 절대 슈퍼유저와 제한된 시스템 Role은 보안 의미가 다르다.

`SYSTEM_ADMIN`의 제품 의미는 그대로 유지한다.

> 유효하게 인증된 ACTIVE Account가 가진 플랫폼 최고 관리자 자격이며, 정상적으로 구성된 업무 요청의 Membership·Permission·ACL을 모두 우회한다.

문제는 이 자격을 일반 Academy RBAC의 Role로 모델링할 것인지 여부다.

## 결정 요인

- Academy RBAC는 학원 내부 조직과 업무 권한만 표현하도록 단순하게 유지한다.
- 슈퍼유저의 절대 우회 의미를 Permission 조합으로 오해할 수 없게 한다.
- 일반 Policy Engine의 순수 계산에서 플랫폼 운영 예외를 제거한다.
- 플랫폼 운영 기능과 초기 Academy 부트스트랩을 간단히 보호한다.
- 향후 제한된 플랫폼 운영 Role이 필요해져도 슈퍼유저의 의미를 변경하지 않는다.
- 슈퍼유저 자격 변경과 모든 우회 접근은 강하게 감사한다.
- 첫 버전에서 별도의 복잡한 플랫폼 IAM을 미리 만들지 않는다.

## 검토한 선택지

### 1. 기존처럼 SYSTEM_ADMIN을 예약 Role로 유지

하나의 Role·Assignment 모델을 재사용할 수 있다. 그러나 슈퍼유저는 Permission을 평가하지 않으므로 Role이 실제 의미를 설명하지 못하고, 일반 Academy 권한 코드에 system 예외가 계속 남는다.

### 2. Account에 `system_admin` Boolean을 직접 추가

판단은 가장 단순하지만 `identity.account`가 권한 정책을 소유하게 된다. `identity`와 `accesscontrol`의 데이터 소유 경계가 흐려지고, 권한 부여·회수 이력과 별도 운영 절차를 표현하기 어렵다.

### 3. accesscontrol의 별도 플랫폼 슈퍼유저 레지스트리로 분리

Academy RBAC는 Academy Role·Permission·Assignment만 다루고, 플랫폼 최고 관리자 자격은 별도의 작은 레지스트리가 소유한다. 두 정책은 `Authorizer` 조립 단계에서만 만난다.

### 4. 지금부터 범용 플랫폼 RBAC 추가

`PLATFORM_OPERATOR`, `PLATFORM_AUDITOR`, `SUPPORT` 같은 미래 역할을 표현할 수 있지만 현재 요구가 없는 Role·Permission·scope 모델을 다시 만든다. 절대 슈퍼유저와 제한 운영 역할도 여전히 구분해야 한다.

## 결정

### 1. 슈퍼유저는 Role이나 Permission이 아니다

운영 명칭 `SYSTEM_ADMIN`은 유지할 수 있지만 도메인 모델에서는 **플랫폼 슈퍼유저 자격**으로 취급한다.

다음으로 표현하지 않는다.

```text
Role row
Role Assignment
SYSTEM scope
Permission 묶음
Academy ACL Subject
```

`SYSTEM_ADMIN`이 `storage.file.read`를 가진 것이 아니다. 슈퍼유저이기 때문에 정상적인 `storage.file.read` 검사 자체를 우회한다.

### 2. accesscontrol이 별도 현재 상태 레지스트리를 소유한다

v1의 현재 상태 모델은 다음처럼 작게 유지한다.

```text
platform_superuser
├── account_id       PK
├── granted_by       nullable; 최초 운영 bootstrap만 null 허용
└── granted_at
```

- row가 존재하면 해당 Account에 플랫폼 슈퍼유저 자격이 있다.
- Account 존재와 ACTIVE 상태는 `identity/bootstrap`이 먼저 확인한다.
- `accesscontrol`은 다른 모듈의 Entity를 참조하지 않고 `account_id` 값만 보관한다.
- 회수는 현재 상태 row 삭제로 표현한다.
- grant/revoke의 역사와 사유는 `authorization_audit_log`에 보존한다.
- 슈퍼유저 여부를 세션 권한에 고정하지 않고 보호 요청마다 PostgreSQL 현재 상태에서 확인한다.

별도 상태 이력 테이블은 감사 로그로 충분하지 않다는 운영 요구가 확인될 때 추가한다.

### 3. 일반 Academy Policy Engine은 슈퍼유저를 모른다

공개 `Authorizer` 구현의 조립 순서는 다음과 같다.

```text
정상적인 AuthorizationRequest
        ↓
PlatformSuperuserRepository 확인
        │
        ├── 슈퍼유저 → ALLOW / SUPERUSER_BYPASS + 감사
        │
        └── 일반 Account
               ↓
          Academy Access Snapshot
               ↓
          AuthorizationPolicyEngine
               ├── ACTIVE Membership
               ├── Permission
               └── Resource이면 ACL
```

`AuthorizationPolicyEngine`은 다음만 계산한다.

```text
ACADEMY policy
RESOURCE policy
```

다음은 일반 Policy Engine 계약에서 제거한다.

```text
SYSTEM target
SYSTEM permission scope
SYSTEM_V1 policy
systemAdmin Boolean이 포함된 EffectiveAccess
```

### 4. 슈퍼유저 전용 기술 경계는 별도 공개 계약을 사용한다

플랫폼 운영 기능처럼 Academy Permission이 아닌 기능은 일반 Permission catalog를 거치지 않는다.

```text
Spring HttpSession + ACTIVE Account
        ↓
SuperuserAccess
        ↓
platform_superuser row
```

따라서 Permission catalog에 플랫폼 운영 기능용 Permission을 두지 않는다.

보호 대상 업무 유스케이스는 일반 `Authorizer`를 호출하며, `Authorizer` 내부에서 같은 슈퍼유저 레지스트리를 먼저 확인한다. Controller나 Storage Adapter가 직접 우회 조건을 구현하지 않는다.

### 5. 리소스 무결성은 슈퍼유저 우회 전에 검증한다

다음은 보호 대상 모듈의 책임이며 슈퍼유저도 우회하지 않는다.

```text
요청 형식
리소스 존재 여부
URL academyId와 실제 resource academyId 일치
부모·조상 관계
resource 상태
도메인 불변조건
```

Storage는 정상적인 `ResourceContext`를 만든 뒤 `Authorizer`를 호출한다. 슈퍼유저는 그 이후 Membership·Permission·ACL만 우회한다.

### 6. v1 슈퍼유저 변경은 운영 명령으로 제한한다

슈퍼유저 수가 매우 적고 영향 범위가 플랫폼 전체이므로 v1 관리자 Web UI와 일반 Role API에서 관리하지 않는다.

- 최초 부여는 명시적인 일회성 운영 bootstrap 명령으로 수행한다.
- 후속 grant/revoke도 인증된 애플리케이션 사용자용 일반 API가 아니라 제한된 운영 명령으로 수행한다.
- 명령은 대상 ACTIVE Account, 실행자 또는 운영자, 사유와 확인 플래그를 요구한다.
- 모든 변경을 `authorization_audit_log`에 기록한다.
- 슈퍼유저가 0명이 되어도 Academy의 기존 업무는 계속 동작한다. 복구는 동일한 제한 운영 bootstrap 명령을 사용한다.

마지막 슈퍼유저 회수 금지와 다중 승인 UI는 실제 운영 인원과 절차가 필요해질 때 결정한다. Academy-local ACL 관리자 lockout 방지 불변조건은 그대로 유지한다.

### 7. 향후 제한된 플랫폼 Role은 별도 결정으로 추가한다

향후 다음과 같은 요구가 실제로 생길 수 있다.

```text
감사 로그만 조회하는 사용자
모니터링·장애 진단만 수행하는 사용자
특정 Academy를 지원하는 운영자
```

그 시점에는 별도의 플랫폼 RBAC 또는 명시적인 운영 Capability를 설계한다.

```text
platform Role / Permission
!=
platform superuser
```

제한된 플랫폼 Role이 추가되어도 `platform_superuser`는 절대 우회 자격으로 독립 유지한다. 따라서 이번 분리는 장기 확장성을 막지 않는다.

## 대체하는 기존 내용

이 ADR은 충돌하는 범위에서 [ADR-0002](0002-admin-managed-authorization-and-system-superuser.md)의 다음 구현 해석을 대체한다.

- `SYSTEM_ADMIN`을 `SYSTEM` scope의 시스템 예약 Role로 저장하는 방식
- 일반 `role`, `role_assignment`에서 `SYSTEM_RESERVED`를 표현하는 방식
- `AuthorizationTarget.System`, `PermissionTargetScope.SYSTEM`과 `SYSTEM_V1` Policy

ADR-0002의 다음 결정은 유지한다.

- Academy Role·Role-Permission·Role Assignment는 관리자 구성 데이터
- Permission catalog는 애플리케이션 관리 계약
- `SYSTEM_ADMIN`은 정상적인 보호 요청의 Membership·Permission·ACL을 우회하는 진짜 슈퍼유저
- 리소스 무결성과 Account ACTIVE 상태는 우회하지 않음
- Academy-local ACL 관리자 lockout 방지
- 모든 슈퍼유저 우회 접근 감사

## 결과

### 긍정적 결과

- Academy Role 모델이 `academy_id + name + Permission`이라는 단일 의미만 가진다.
- `SYSTEM` scope, 시스템 예약 Role과 사용되지 않는 system Permission이 사라진다.
- 순수 `AuthorizationPolicyEngine`이 Membership·Permission·ACL 계산에만 집중한다.
- 슈퍼유저의 절대 권한이 Permission 조합으로 오해되지 않는다.
- 플랫폼 운영 기능의 보호가 `SuperuserAccess` 한 번으로 단순해진다.
- 향후 제한된 플랫폼 운영 역할을 슈퍼유저와 분리해 추가할 수 있다.

### 부정적 결과와 비용

- 슈퍼유저 현재 상태와 Academy Role Assignment가 서로 다른 저장 경로를 사용한다.
- grant/revoke 운영 명령과 감사가 일반 Role 관리 API와 별도로 필요하다.
- 슈퍼유저가 0명이 된 경우 일반 UI가 아닌 운영 bootstrap 절차로 복구해야 한다.
- 향후 제한된 플랫폼 Role이 필요하면 별도 플랫폼 RBAC를 새로 설계해야 한다.

## 구현 제약

- `platform_superuser`는 `accesscontrol`이 소유한다.
- `Account.systemAdmin`과 세션 권한을 슈퍼유저 원장으로 사용하지 않는다.
- `SYSTEM_ADMIN` 이름을 Role enum, Role key 또는 ACL Subject로 사용하지 않는다.
- 일반 Academy Role 관리 API는 `platform_superuser`를 조회·변경하지 않는다.
- `Authorizer`와 `SuperuserAccess` 구현은 같은 PostgreSQL 슈퍼유저 조회 컴포넌트를 사용한다.
- 슈퍼유저 ALLOW는 `SUPERUSER_BYPASS`로 일반 ALLOW와 구분해 감사한다.
- Permission catalog와 Flyway seed에는 Academy 업무 Permission만 둔다.
- 제한 운영 bootstrap 명령은 운영 배포에서 명시적으로 실행할 때만 동작하고 공개 HTTP endpoint로 노출하지 않는다.

## 검증 조건

- Academy Role 스키마와 코드에 SYSTEM scope 또는 시스템 예약 Role 종류가 없다.
- Permission catalog에 플랫폼 운영 기능용 Permission이 없다.
- 일반 `AuthorizationPolicyEngine` 입력에 `systemAdmin` Boolean이 없다.
- 일반 Policy Engine 단위 테스트는 Academy Membership·Permission·ACL만 검증한다.
- `SuperuserAccess`는 활성 슈퍼유저만 허용하고 그 결과를 감사할 수 있다.
- 일반 `Authorizer`는 슈퍼유저이면 Access Snapshot과 ACL 조회 없이 `SUPERUSER_BYPASS`를 반환할 수 있다.
- 슈퍼유저가 아니면 기존 Academy RBAC·ACL 규칙이 그대로 적용된다.
- 플랫폼 운영 기능은 인증된 ACTIVE Account이면서 `platform_superuser`에 등록된 사용자만 접근한다.
- 잘못된 Academy/Resource 조합은 슈퍼유저도 통과하지 못한다.

## 후속 검토

- 운영 bootstrap 명령의 구체적인 실행·승인·복구 Runbook
- 슈퍼유저 최소·최대 인원과 마지막 슈퍼유저 회수 금지 여부
- 제한된 플랫폼 운영 Role 또는 감사 전용 Role의 실제 필요성
- 슈퍼유저 grant/revoke 전용 이력 테이블 필요 여부
