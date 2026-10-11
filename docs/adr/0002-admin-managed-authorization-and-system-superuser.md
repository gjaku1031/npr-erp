# ADR-0002: 관리자 구성형 학원 권한과 SYSTEM_ADMIN 슈퍼유저

> 상태: Accepted  
> 결정일: 2026-08-30  
> 결정자: NPR 프로젝트  

> 후속 변경: `SYSTEM_ADMIN`의 슈퍼유저 의미는 유지하지만, 이를 `SYSTEM` Role과 Role Assignment로 저장하는 구현 해석은 [ADR-0003](0003-separate-platform-superuser-from-academy-rbac.md)으로 대체되었다.

## 컨텍스트

`identity`, `accesscontrol`, `storage` 모듈과 RBAC·ABAC·ACL 기반 인가 엔진을 두기로 한 뒤, 실제 관리 경험을 검토하면서 다음 정책을 더 명확히 정할 필요가 생겼다.

- 학원마다 조직과 업무 분담이 다르므로 `ACADEMY_OWNER`, `INSTRUCTOR` 같은 고정 역할 목록과 고정 Role-Permission 표를 제품 코드에 넣는 것은 유연성이 부족하다.
- 자료실의 기본 하위 폴더 구조 역시 학원마다 다르므로 아키텍처가 `공용`, `강사공용`, `인사` 같은 폴더를 고정하면 안 된다.
- Academy 관리자가 Role, Permission 조합, 사용자 역할과 폴더 ACL을 관리자 화면에서 변경할 수 있어야 한다.
- ACL 변경으로 Academy 내부 관리자가 모두 사라지는 잠금 상태를 방지해야 한다.
- `SYSTEM_ADMIN`을 단순 운영 도구 접근 역할로 제한하면 플랫폼 전체 장애 대응과 초기 Academy 권한 부트스트랩을 담당할 최고 관리자의 의미가 불명확하다.

## 결정 요인

- 애플리케이션이 제공하는 기능 단위 Permission과 관리자가 구성하는 운영 Policy를 분리한다.
- Academy마다 다른 역할과 폴더 구조를 지원하되, 권한 판단 알고리즘은 모든 Academy에서 동일하게 유지한다.
- 최고 관리자인 `SYSTEM_ADMIN`의 의미를 예외 없이 명확하게 한다.
- 기본 거부, 리소스 무결성 검사와 감사 추적은 슈퍼유저에게도 유지한다.
- 첫 버전의 인증·인가 범위를 한 명의 개발자가 구현하고 검증할 수 있는 수준으로 제한한다.
- 후속 기능을 위한 정책 DSL, 역할 계층과 명시적 DENY를 미리 도입하지 않는다.

## 검토한 선택지

### 고정 Academy 역할과 고정 Permission 매트릭스

코드와 초기 seed가 단순하지만 학원별 업무 분담 차이를 표현하기 어렵다. 역할 이름이나 Permission 조합이 바뀔 때마다 배포가 필요하고, 결국 역할별 조건문이 애플리케이션에 퍼질 위험이 있다.

### 전역 Role Template을 두고 Academy가 일부만 변경

공통 시작점을 제공할 수 있지만 Template과 실제 Role의 동기화, Template 변경의 기존 Academy 반영 여부, 관리자가 수정한 값과의 충돌 정책이 추가된다. 현재 제품 규모에서는 운영 편의보다 모델 복잡성이 더 크다.

### Permission은 시스템 관리, Academy Role과 폴더 Policy는 관리자 구성

애플리케이션은 안정적인 Permission 계약과 권한 알고리즘을 유지하고, Academy는 자신의 Role, Role-Permission 조합, Role Assignment, 폴더 구조와 ACL을 자유롭게 관리할 수 있다.

### SYSTEM_ADMIN을 일반 SYSTEM Role로 취급

Permission 또는 Academy Membership이 없는 경우 접근하지 못하게 할 수 있지만, 플랫폼 최고 관리자와 일반 운영 역할의 차이가 사라진다. 모든 Academy의 초기 권한 부트스트랩과 장애 복구를 위해 다시 별도 우회 경로가 필요해진다.

### SYSTEM_ADMIN을 명시적인 슈퍼유저로 취급

의미가 단순하고 초기 운영·복구가 가능하다. 대신 모든 슈퍼유저 접근을 명확히 감사하고, 계정 활성 상태와 리소스 무결성 검사를 우회하지 않아야 한다.

## 결정

### 1. Permission은 시스템 관리 계약이다

Permission은 애플리케이션이 제공하는 기능과 직접 연결되는 안정적인 식별자다.

```text
storage.folder.list
storage.folder.create
storage.file.read
storage.file.write
storage.acl.read
storage.acl.manage
storage.node.hide
access.role.read
access.role.manage
access.assignment.read
access.assignment.manage
```

- Permission key와 의미는 코드·Flyway seed가 관리한다.
- 관리자는 임의 Permission key를 만들거나 기존 key의 의미를 바꿀 수 없다.
- Permission 추가·폐기는 애플리케이션 변경으로 취급하고 배포와 마이그레이션을 거친다.
- Application Service는 Role 이름이 아니라 Permission key를 요구한다.

### 2. Academy Role은 관리자 구성 데이터다

`SYSTEM_ADMIN`을 제외한 Academy Role은 고정 enum이나 코드 상수로 만들지 않는다.

```text
A Academy
├── 원장
├── 강사
├── 행정
└── 중등부팀장

B Academy
├── 대표관리자
├── 교사진
└── 운영팀
```

- 권한 있는 관리자는 자신의 Academy에서 Role을 생성·이름 변경·비활성화할 수 있다.
- Role에 시스템 Permission을 선택해 연결할 수 있다.
- 활성 Staff Membership에 Role을 부여·회수할 수 있다.
- Role 이름은 표시·운영 개념이고 권한 엔진은 이름을 비교하지 않는다.
- 역할 계층과 Role 상속은 v1에서 지원하지 않는다. 각 Role은 Permission을 직접 가진다.
- Academy Role은 다른 Academy에서 재사용하지 않고 해당 Academy가 소유한다.

### 3. SYSTEM_ADMIN은 예약된 진짜 슈퍼유저다

`SYSTEM_ADMIN`은 `SYSTEM` scope의 시스템 예약 Role이며 플랫폼 전체 최고 관리자다.

정상적으로 구성된 요청에 대해 다음을 우회한다.

```text
Academy Membership
Academy Role Assignment
Permission
Resource ACL
```

다음은 우회하지 않는다.

```text
유효한 로그인 세션
로컬 Account 존재와 ACTIVE 상태
요청 형식과 도메인 불변조건
리소스 존재 여부
URL academyId와 실제 resource academyId의 일치
부모·조상 관계와 resource 상태 검증
감사 로그
```

따라서 다른 Academy의 resource ID를 잘못된 URL academyId와 조합한 요청은 `SYSTEM_ADMIN`이어도 정상 요청으로 바꾸지 않고 존재하지 않는 리소스처럼 처리한다. 보호 리소스에 대한 슈퍼유저 허용은 `SUPERUSER_BYPASS` 사유로 감사한다.

`SYSTEM_ADMIN` Role은 Academy 관리자 화면에서 생성·이름 변경·삭제하거나 Permission을 편집할 수 없다. 기존 `SYSTEM_ADMIN` 또는 별도 일회성 운영 부트스트랩 절차만 Assignment를 관리한다.

### 4. Academy 폴더 구조와 ACL은 관리자 구성 데이터다

각 Academy에는 시스템이 소유하는 루트 `StorageNode` 하나가 존재한다.

- 루트 노드는 삭제, 이동, 이름 변경과 soft-hide 대상이 아니다.
- 루트 아래 기본 하위 폴더는 아키텍처나 migration에서 고정하지 않는다.
- 권한 있는 관리자가 하위 폴더를 자유롭게 생성한다.
- 폴더별 `ACCOUNT` 또는 `ROLE` Subject의 ACL을 관리자 화면에서 관리한다.
- 파일은 부모 폴더 ACL을 상속한다.
- ACL v1은 `ALLOW`만 지원하고 명시적 허용이 없으면 거부한다.
- 상위 폴더의 `ALLOW`는 `inherit_to_children=true`인 경우에만 하위 리소스에 적용한다.

파일 저장소 자체의 사용자·그룹 권한을 Role과 동기화하지 않는다. PostgreSQL 권한을 먼저 판단하고 `ALLOW`된 요청만 저장소 포트로 실행한다.

### 5. Academy ACL 관리자 lockout을 금지한다

`SYSTEM_ADMIN` 슈퍼유저가 복구할 수 있더라도, 정상 Academy 운영이 시스템 관리자에게만 의존하는 상태를 허용하지 않는다.

Role-Permission 변경, Role Assignment 회수, Staff Membership 종료, Role 비활성화·삭제와 루트 ACL 회수 후에도 다음 조건을 만족해야 한다.

> Academy마다 최소 한 개 이상의 **활성 StaffMembership + 유효 Role Assignment 경로**가 `storage.acl.manage` Permission과 Academy 루트의 유효한 `MANAGE_ACL` grant를 함께 가져야 한다.

조건을 0명으로 만드는 변경은 같은 트랜잭션에서 거부한다.

- `SYSTEM_ADMIN`의 슈퍼유저 bypass는 이 최소 인원 계산에 포함하지 않는다.
- 동시 변경으로 검사가 우회되지 않도록 Academy access scope의 잠금 행 또는 PostgreSQL transaction advisory lock을 사용한다.
- 초기 Academy 생성은 `SYSTEM_ADMIN`이 첫 Academy Role, Role Assignment와 루트 ACL을 하나의 부트스트랩 유스케이스로 구성한 뒤 활성화한다.
- Account 자체의 ACTIVE 상태는 `identity`가 소유하므로 v1 DB lockout 불변조건은 `accesscontrol`이 소유한 Membership·Role·Assignment·ACL 변경에 한정한다. Account 정지 화면은 영향받는 Academy 관리자 여부를 경고하고 `SYSTEM_ADMIN`이 대체 관리자를 먼저 구성할 수 있게 한다.

### 6. 권한 관리도 같은 권한 엔진을 통과한다

Role, Role-Permission, Role Assignment와 ACL 관리자 API에 별도 하드코딩된 역할 검사를 두지 않는다.

예:

```text
Role 조회       → access.role.read
Role 변경       → access.role.manage
Assignment 조회 → access.assignment.read
Assignment 변경 → access.assignment.manage
ACL 조회        → storage.acl.read + folder READ/MANAGE_ACL 정책
ACL 변경        → storage.acl.manage + folder MANAGE_ACL
```

`SYSTEM_ADMIN`은 슈퍼유저 규칙으로 통과하고, 일반 Academy 관리자는 자신에게 구성된 Permission과 ACL 범위 안에서 관리한다.

## 결과

### 긍정적 결과

- Academy마다 조직에 맞는 Role과 Permission 조합을 배포 없이 관리할 수 있다.
- 폴더 구조와 ACL도 실제 운영자가 제품 사용 중 구성할 수 있다.
- 애플리케이션 코드는 Role 이름이 아니라 안정적인 Permission 계약에 의존한다.
- `SYSTEM_ADMIN`의 의미가 단순하고 초기 Academy 부트스트랩·장애 복구가 가능하다.
- Academy 내부 ACL 관리자가 사라지는 운영 잠금을 트랜잭션 불변조건으로 막는다.

### 부정적 결과와 비용

- Role·Permission·Assignment·ACL 관리자 UI와 관리 API가 첫 제품 범위에 포함된다.
- 잘못된 Role-Permission 변경이 많은 사용자에게 즉시 영향을 줄 수 있으므로 변경 감사와 확인 UI가 중요하다.
- `SYSTEM_ADMIN` 계정 탈취의 영향이 플랫폼 전체이므로 계정 보호, 최소 인원, 자격증명 운영과 모든 우회 접근 감사가 필요하다.
- lockout 방지는 여러 테이블의 변경을 함께 검증해야 하므로 단순 FK만으로 구현할 수 없다.
- 고정 Role Template을 제공하지 않으므로 새 Academy 생성 시 `SYSTEM_ADMIN`이 첫 정책을 구성해야 한다.

## 구현 제약

- Permission catalog는 Flyway seed와 코드 상수의 일치 테스트를 둔다.
- Academy Role name은 Academy 안에서 정규화된 값으로 유일하게 한다.
- Academy Role은 자신의 Academy Permission만 부여받고 다른 Academy에 Assignment할 수 없다.
- 모든 권한 관리 변경은 actor, academy, 대상, 변경 전후, 결과와 request ID를 감사한다.
- `SYSTEM_ADMIN`의 보호 리소스 ALLOW는 일반 조회라도 `SUPERUSER_BYPASS`로 식별할 수 있어야 한다.
- 권한 변경 결과는 캐시 없이 다음 요청부터 PostgreSQL 원장 값으로 반영한다.
- Root lockout guard는 변경 전 단순 조회만 하지 않고 Academy별 직렬화 잠금 안에서 변경 후 상태를 검증한다.
- ResourceContext는 보호 대상 모듈이 실제 데이터를 읽어 만들며 클라이언트가 academy, ancestor 또는 resource type을 정책 입력으로 직접 제공하지 않는다.

## 검증 조건

- Academy마다 서로 다른 Role 이름과 Permission 조합을 만들 수 있다.
- Role 이름을 바꿔도 Application Permission 검사가 바뀌지 않는다.
- 일반 사용자는 다른 Academy Role, Assignment와 ACL을 관리할 수 없다.
- 마지막 Academy-local ACL 관리자를 제거하는 모든 변경 경로가 거부된다.
- 동시에 실행된 두 권한 회수도 lockout invariant를 우회하지 못한다.
- `SYSTEM_ADMIN`은 모든 정상 Academy Permission과 ACL 검사를 우회한다.
- `SYSTEM_ADMIN`도 존재하지 않거나 Academy가 불일치하는 resource 요청을 통과하지 못한다.
- `SYSTEM_ADMIN`의 우회 접근과 모든 권한 관리 변경이 감사된다.
- 미인증·비활성 Account는 `SYSTEM_ADMIN` Assignment가 있어도 보호 요청을 수행하지 못한다.

## 후속 검토

- 신규 Academy의 첫 Role·관리자·루트 ACL을 입력하는 관리자 UX
- `SYSTEM_ADMIN` 최소 인원, Assignment 승인과 복구 운영 절차
- Role 복제 또는 Template 기능이 실제 운영 편의에 필요한지 여부
- 권한 변경 미리보기와 영향받는 Account 수 계산
- 권한 감사 로그 보존 기간과 관리자 조회 기능
- 명시적 DENY, 상속 차단과 파일별 ACL 필요 여부
