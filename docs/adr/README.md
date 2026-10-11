# 아키텍처 결정 기록

현재 동작은 [설계 문서](../architecture/overview.md)가 원본이다. ADR은 결정과 그 이유, 검토한 대안을 보존한다.

| 결정 | 상태 |
|---|---|
| [ADR-0001: JPA 명령 모델과 jOOQ 조회 모델의 점진적 병행](0001-jpa-command-and-jooq-query-models.md) | Accepted |
| [ADR-0002: 관리자 구성형 학원 권한과 SYSTEM_ADMIN 슈퍼유저](0002-admin-managed-authorization-and-system-superuser.md) | Accepted |
| [ADR-0003: 플랫폼 슈퍼유저를 Academy RBAC와 분리](0003-separate-platform-superuser-from-academy-rbac.md) | Accepted |
| [ADR-0004: 권한 엔진은 소비 도메인의 실제 요구가 생길 때만 확장한다](0004-evolve-authorization-only-from-consuming-domain-requirements.md) | Accepted |
| [ADR-0005: Storage 트리 변경과 명시적 휴지통 생명주기를 도입한다](0005-storage-tree-mutations-and-trash-lifecycle.md) | Accepted |
| [ADR-0006: 로컬 비밀번호와 서버 세션으로 로그인](0006-local-password-session-authentication.md) | Accepted |
| [ADR-0007: Java와 Thymeleaf의 단일 애플리케이션](0007-java-thymeleaf-single-application.md) | Accepted |
| [ADR-0008: 저장소를 프로세스 안의 포트로 두고 로컬 파일시스템 어댑터를 사용](0008-storage-gateway-as-in-process-port.md) | Accepted |
| [ADR-0009: 외부 ERP 연동을 포트 하나와 대역 어댑터로 둠](0009-single-tng-port-with-mock-adapter.md) | Accepted |
| [ADR-0010: 업무일지의 대상 판정을 계정 ID와 권한으로 함](0010-worklog-on-account-ids-and-permissions.md) | Accepted |

새 결정은 [문서 작성 규칙](../development/documentation.md)에 따라 다음 번호로 추가한다.
