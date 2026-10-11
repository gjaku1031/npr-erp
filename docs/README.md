# NPR 문서

이 디렉터리가 프로젝트 문서의 단일 원본이다. 현재 동작은 아래 설계·운영 문서에서,
결정의 배경과 대체 이력은 [ADR](adr/README.md)에서 확인한다.

## 개발

| 문서 | 내용 |
|---|---|
| [로컬 실행](development/quickstart.md) | 시연 실행, 시연 계정, 로컬 PostgreSQL, 테스트 |
| [개발 규칙](development/conventions.md) | Java, 모듈 경계, Javadoc, 테스트 |
| [문서 작성 규칙](development/documentation.md) | 간결한 Markdown, 배치·링크·ADR 규칙 |
| [현재 범위와 다음 작업](development/status.md) | 구현 상태와 남은 작업 |

## 설계

| 문서 | 내용 |
|---|---|
| [구조](architecture/overview.md) | 모듈, 의존 방향, 외부 경계의 포트 |
| [인증](architecture/authentication.md) | 아이디·비밀번호, 서버 세션, CSRF |
| [권한 엔진](architecture/authorization.md) | RBAC·ABAC·ACL, 판단 흐름, Permission·상속, 관리·동시성 계약 |
| [자료실](architecture/storage.md) | 트리, 작업 원장, 저장소 포트, 권한 연결 |
| [업무일지](architecture/worklog.md) | 업무·일일보고·상담, 대상 집합과 소유 조건, 전송 상태 |
| [외부 ERP 연동](architecture/tng.md) | 포트 하나와 대역 어댑터, 두지 않은 것 |
| [실행 환경](architecture/runtime.md) | 프로세스·상태 저장 위치·운영 제약 |

## 운영

| 문서 | 내용 |
|---|---|
| [계정·슈퍼유저 관리](operations/accounts.md) | 계정 생성, 비밀번호 설정, 슈퍼유저 부여·회수 |
| [ADR 목록](adr/README.md) | 승인·제안·대체된 아키텍처 결정 |

문서를 새로 만들기 전에 기존 문서에 통합할 수 있는지 확인한다.
학생 정보·계정 비밀·외부 시스템의 비공개 계약은 문서에 옮기지 않는다.
