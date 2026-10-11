# 인증

**로컬 DB 아이디·비밀번호 + Spring Security 폼 로그인 + 서버 HttpSession**을 사용한다.
JWT, refresh token, 외부 인증 공급자는 사용하지 않는다.
결정 배경은 [ADR-0006](../adr/0006-local-password-session-authentication.md)에 기록한다.

## 요청 흐름

```text
GET  /login  → 로그인 화면(CSRF 토큰 포함)
POST /login  → DB 계정 조회 → BCrypt 검증 → 세션 ID 교체 → /
GET  /       → 첫 소속 학원의 홈(/a/{academyId})으로 이동
POST /logout → CSRF 검증 → 세션 무효화 → /login
```

로그인하지 않은 요청은 `/login`으로 보낸다. 아이디 없음·비밀번호 오류·정지 계정은 같은 실패 문구를 보여 준다.
로그인 성공 후 원래 요청하던 임의의 주소로 돌려보내지 않고 `/`로 이동한다.

## 저장·보안

| 항목 | 계약 |
|---|---|
| Account | 안정적인 UUID, 고유 `username`, 표시 이름, 상태, BCrypt `password_hash` |
| 비밀번호 | 8자 이상, UTF-8 72바이트 이하. 원문을 DB·로그·세션에 보관하지 않음 |
| 세션 | `NPRSESSION`, HttpOnly, SameSite=Lax, 비활동 만료 8시간, HTTPS에서는 Secure |
| CSRF | 모든 변경 요청에 토큰 필요. 서버가 그리는 폼에 숨은 필드로 들어감 |
| 주체 | `AccountPrincipal`. 계정 ID만 의미가 있고 Spring Security의 권한 목록은 비워 둠 |
| 권한 | 세션에 Membership·Role·Permission을 저장하지 않고 요청마다 현재 DB 상태로 판단 |

학원 경로(`/a/{academyId}/…`)의 요청은 `AcademyContextInterceptor`가 매번 계정이 활성인지와 그 학원에 소속돼
있는지를 확인한다. 정지된 계정, 종료된 소속, 바뀐 역할은 다음 요청부터 반영된다.

## 계정

가입·초대·비밀번호 찾기는 없다. 계정은 권한 관리 화면의 직원 등록이나 [운영 명령](../operations/accounts.md)으로 만든다.
학원 관리자는 자기 학원 직원의 비밀번호를 바꿀 수 있지만, 플랫폼 슈퍼유저의 비밀번호는 슈퍼유저만 바꾼다.

## 의도적인 제약

세션은 단일 프로세스 메모리에 있다. 재시작하면 다시 로그인하며 다중 인스턴스 공유는 지원하지 않는다.
비밀번호를 바꿔도 이미 열린 세션을 회수하지 않고, 로그아웃은 현재 세션만 종료한다.
MFA·로그인 시도 제한은 구현하지 않았다. 외부에 공개하기 전에 HTTPS와 접근망 제한, 시도 제한을 따로 검토한다.
