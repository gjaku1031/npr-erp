# 시스템 구조

하나의 Spring Modulith 애플리케이션이다. 모듈 안에서는 JPA와 jOOQ를 직접 쓰고,
**바뀌거나 사라질 수 있는 외부 시스템 경계에만 포트와 어댑터를 둔다.**

## 모듈

```text
bootstrap ──▶ identity        계정, 비밀번호
          ──▶ accesscontrol   권한 원장, 권한 엔진, 감사
          ──▶ storage         자료실 트리, 작업 원장, 파일 전송
          ──▶ worklog ──▶ tng 업무·일일보고·상담 / 외부 ERP 포트
          ──▶ tng

identity / accesscontrol / storage / tng  → 다른 모듈 의존 없음
worklog                                   → tng의 공개 포트만
```

| 모듈 | 소유하는 것 | 모르는 것 |
|---|---|---|
| `identity` | Account, 비밀번호 해시, 계정 상태 | 학원, 역할 |
| `accesscontrol` | Membership·Role·Permission·ACL, 정책 버전, 감사 기록 | 자료실 노드나 업무가 실제로 있는지 |
| `storage` | 파일·폴더 메타데이터, 작업 원장 | 누가 요청했는지 |
| `tng` | 외부 ERP에서 읽고 쓰는 자료의 형태 | 업무 규칙 |
| `worklog` | 업무, 일일보고, 상담, 공지, 일정과 "본인의 것" 조건 | 누가 어떤 역할인지 |
| `bootstrap` | 로그인, 화면, 요청마다의 권한 확인, 시연 데이터 | 업무 규칙 |

공개 계약은 모듈의 루트 패키지에, 구현은 `internal` 아래에 둔다. 모듈 사이의 참조는 ID와 공개 계약으로만 한다.
`ModularityTest`가 의존 방향과 내부 패키지 침범을 검사한다.

## 권한을 확인하는 자리

업무 모듈은 권한 엔진에 의존하지 않는다. 요청을 받는 `bootstrap`의 컨트롤러가 **모듈을 부르기 전에** 엔진에 묻는다.

```text
요청 → AcademyContextInterceptor(계정 활성·학원 소속 확인)
     → Controller → Guard.require(권한, 대상) → Authorizer
     → 허용되면 모듈의 공개 계약 호출
```

역할이 무엇인지에 따라 달라지는 일은 모두 이 자리에서 정한다. 예를 들어 업무일지는 "업무를 받는 사람"을 스스로
정하지 않고, 컨트롤러가 권한 엔진에서 구한 계정 집합을 넘겨받는다. 반대로 "본인에게 배정된 업무인가",
"본인 담당 반인가" 같은 조건은 그 자료를 가진 `worklog`가 계정 ID로 직접 확인한다.
권한 판단의 규칙은 [권한 엔진](authorization.md)에 있다.

## 외부 경계의 포트

| 포트 | 위치 | 어댑터 | 이유 |
|---|---|---|---|
| `StorageGateway` | `storage.internal.gateway` | `LocalFilesystemStorageGateway` | 파일 본문을 두는 곳(로컬 디스크, NAS, 오브젝트 저장소)은 배포마다 달라짐 |
| `TngGateway` | `tng` (공개) | `MockTngGateway` | 외부 ERP는 계약과 가용성을 통제할 수 없음 |

포트는 이 둘뿐이다. DB 접근, 화면, 모듈 내부 서비스에는 포트를 두지 않는다. 구현이 하나뿐이고 바뀔 계획이 없는
곳에 인터페이스를 끼우면 읽을 코드만 늘어난다고 보았다.
`StorageGateway`는 자료실 안에서만 쓰므로 `internal`에, `TngGateway`는 `worklog`가 쓰므로 모듈 루트에 둔다.

## 영속성과 외부 작업

Flyway SQL이 스키마 원본이다. Hibernate는 스키마를 검증만 하고 `open-in-view=false`를 유지한다.
jOOQ 코드는 마이그레이션 SQL에서 생성하므로 DB 없이 빌드된다.

외부 호출은 `짧은 DB 기록 → 트랜잭션 밖 호출 → 짧은 DB 확정`으로 나눈다.
자료실은 작업 원장에, 상담 전송은 상담 행의 전송 상태에 "하려는 일"을 먼저 남긴다. 중간에 끊긴 뒤의 처리는
바깥이 멱등한지에 따라 다르다. 자료실의 저장소 연산은 작업 UUID로 멱등하므로 같은 작업을 다시 실행해 마무리하고,
멱등하지 않은 상담 기록은 다시 보내지 않고 외부 ERP의 기록과 대조해 판정한다.
분산 트랜잭션·범용 Job 프레임워크·메시지 브로커는 쓰지 않는다.

## 관련 문서

[인증](authentication.md), [권한 엔진](authorization.md), [자료실](storage.md), [업무일지](worklog.md),
[외부 ERP 연동](tng.md), [실행 환경](runtime.md). 코드 규칙은 [개발 규칙](../development/conventions.md)에만 둔다.
