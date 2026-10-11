# ADR-0006: 로컬 비밀번호와 서버 세션으로 로그인

- 상태: **Accepted**
- 날짜: 2026-09-06

## 맥락

외부 인증 공급자를 쓰면 클라이언트 등록과 비밀값 설정이 로컬 실행의 선행 조건이 된다.
화면은 서버 세션과 CSRF를 사용하므로 JWT를 새로 도입할 필요가 없다.

## 결정

Spring Security 기본 폼 로그인과 HttpSession을 사용한다.
Account에 고유 `username`과 BCrypt 비밀번호 해시를 저장하고 `/login`으로 인증한다.
JWT·refresh token·blacklist·Redis·외부 인증 공급자는 추가하지 않는다.

CSRF, 로그인 시 세션 ID 교체, HttpOnly 쿠키와 운영 Secure 설정을 유지한다.
활성 계정·슈퍼유저·업무 권한은 보호 요청의 현재 DB 상태로 확인한다.
개발 계정 준비는 `local & !prod`에만 허용하고 자동 로그인·자동 권한 부여는 하지 않는다.

## 대안

Access-token-only JWT도 가능하지만 발급·검증·키 관리와 프런트엔드 전달 경로가 추가된다.
단일 서버와 세션 사용이라는 현재 조건에서는 표준 세션이 더 작다.
인증 없는 개발 우회는 실제 로그인 경로를 검증하지 못하므로 두지 않는다.

## 결과

세션은 프로세스 메모리이므로 재시작 시 재로그인한다. 비밀번호 변경은 기존 세션을 일괄 회수하지 않는다.
공개 가입·복구·MFA·로그인 시도 제한은 현재 범위 밖이다. 외부 공개나 다중 인스턴스가 필요해지면
접근망·시도 제한·복구·공유 세션을 새 요구로 검토한다.

현재 계약: [인증](../architecture/authentication.md), [계정 운영](../operations/accounts.md).
참고: [Spring Security Form Login](https://docs.spring.io/spring-security/reference/servlet/authentication/passwords/form.html),
[CSRF](https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html).
