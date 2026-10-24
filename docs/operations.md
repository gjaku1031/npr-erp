# 운영·배포 가이드

NPR 업무일지 앱의 환경변수, 로컬 실행(모의 ERP), 테스트, DB, 배포 시 주의사항.

스택: Next.js 14 (Pages Router) + React/TSX + libSQL(Turso). Node 22.x (`package.json`의 `engines`).

---

## 1. 환경변수

코드에서 실제로 읽는 변수만 정리했다. (`src/config.ts`, `src/secret.ts`, `src/db/db.service.ts`, `src/db/seed.ts`, `pages/_document.tsx`)

### 앱 공통

| 이름 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `APP_TODAY` | 아니오 | (빈값) | 앱 기준 '오늘'을 `YYYY-MM-DD`로 고정. **비워두면 KST 실제 날짜**(`todayKST()`). 데모/테스트 전용. 외부 ERP 상담일자는 이 값과 무관하게 KST 실제 날짜를 쓴다. |
| `APP_SECRET` | **운영 필수** | (없음) | 세션 쿠키 서명 키, 강사 외부 ERP 비밀번호 암호화 키(AES-256-GCM), 반 목록 확인 정보 서명 키. 아래 경고 참조. |
| `SEED_MODE` | 아니오 | `clean` | `clean`=팀장 계정 + 기본 태그만 생성. `demo`=디자인 프로토타입 기준 데모 데이터(`seedIfEmpty`). |
| `LEAD_ID` | 아니오 | `admin` | 최초 부트스트랩 시 생성되는 팀장 로그인 ID. **이미 부트스트랩된 DB에는 반영 안 됨**(`lead_account`가 비어 있을 때만 INSERT). |
| `LEAD_PW` | 아니오 | `1234` | 팀장 초기 비밀번호. 배포 시 반드시 바꿔 지정. |
| `LEAD_NAME` | 아니오 | `팀장` | 팀장 표시 이름. |
| `PORT` | 아니오 | `3000` | `config.port`로 읽기는 하나 앱 코드에 사용처가 없다. 포트 변경은 `next dev -p`로 한다. |

> `LEAD_*` 3개는 `bootstrapClean()`(=`SEED_MODE=clean`) 경로에서만 읽는다. `SEED_MODE=demo`(`seedIfEmpty()`)는 데모 계정(`admin`, `lee.he` 등, 비밀번호 `1234`)을 만들고 데모 강사에게 모의 ERP 계정을 미리 연결한다.

> **`APP_SECRET`**
> 강사별 외부 ERP 비밀번호는 `APP_SECRET`에서 SHA-256으로 파생한 키로 암호화되어 DB(`teachers.ttt_pw`)에 저장된다(`src/ttt/crypto.ts`).
> 운영(`NODE_ENV=production`, 즉 `next start`)에서 값이 없으면 API가 요청을 처리하지 않는다(500, 로그에 `APP_SECRET 환경변수가 필요합니다.`). 개발(`next dev`)과 테스트에서 비어 있으면 프로세스마다 임의 키를 만들므로 재시작하면 로그인이 풀린다(`src/secret.ts`).
> **값을 바꾸면 기존에 저장된 외부 ERP 비밀번호를 복호화할 수 없다.** `decrypt()`는 실패 시 빈 문자열을 반환한다. 배포 전에 한 번 정하고 고정한다.

### 외부 ERP

공개 저장소의 외부 ERP 구현은 모의 구현(`src/ttt/ttt.mock.ts`)뿐이라 연동용 환경변수가 없다. 실제 ERP에 붙이려면 `TttGateway`(`src/ttt/ttt.gateway.ts`)를 구현해 `src/backend.ts`에서 모의 구현 대신 넣는다. 상담 쓰기 확인 규칙(`src/ttt/counsel-write.ts`)과 계정·조회 규칙(`src/ttt/ttt.service.ts`)은 그대로 적용된다.

### DB (Turso)

| 이름 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `TURSO_DATABASE_URL` | 서버리스 배포 시 필수 | (없음) | 있으면 임베디드 리플리카 모드(`syncUrl`). 없으면 순수 로컬 파일 SQLite. |
| `TURSO_AUTH_TOKEN` | `TURSO_DATABASE_URL` 사용 시 | (없음) | Turso 인증 토큰. |

### 플랫폼 자동 주입 (직접 설정 금지)

| 이름 | 출처 | 용도 |
|---|---|---|
| `VERCEL` | 서버리스 런타임 | 존재하면 DB 파일 경로를 `/tmp`로(`db.service.ts`). |
| `VERCEL_GIT_COMMIT_SHA` | Git 연동 빌드 | CSS 캐시버스팅 `?v=` 값. 없으면 빌드 시각으로 폴백(§5). |

---

## 2. 로컬 실행 (모의 ERP)

```bash
pnpm install              # 또는 npx pnpm@10 install
cp .env.example .env.local
# .env.local: SEED_MODE=demo, APP_TODAY=2026-07-10 (데모 데이터 주간의 평일)
pnpm dev                  # http://localhost:3000
```

- 데모 계정: 팀장 `admin` / `1234`, 강사 `lee.he` / `1234`(그 밖의 강사 아이디는 `src/db/seed.ts`).
- 데모 강사는 모의 ERP 계정이 연결돼 있어 [반 관리 → 반 불러오기], 일일보고 2~4단계(알림장·상담·출결), 상담 전송을 바로 시험할 수 있다. 모의 ERP는 강사 이름에서 반·원생을 결정적으로 만든다.
- 운영 모드 확인: `npm run build && APP_SECRET=<임의 문자열> npm start`. 운영 모드의 세션 쿠키는 Secure라 HTTPS나 `localhost`에서만 로그인이 유지된다.
- DB는 `data/app.sqlite`에 생긴다. 데모를 처음부터 다시 보려면 `data/` 폴더를 지운다.

### 자동 테스트

```bash
npm test                  # Node 내장 테스트 러너, 임시 격리 SQLite, 외부 접속 없음
npx tsc --noEmit          # next.config.js가 빌드에서 타입 오류를 무시하므로 따로 확인
npm run build
```

- 상담 쓰기 확인 규칙(`tests/counsel-write.test.cjs`): 저장 전후 건수 대조, 9~10자 미리보기 일치, 다시 읽기 실패·세션 만료 응답·응답 유실의 확인 불가 처리, `onBeforePost` 실패 시 저장 요청 차단, 읽기 전용 재확인
- 상담 전송 상태(`tests/counsel-delivery-store.test.cjs`, `tests/counsel-api-reconcile.test.cjs`, `tests/counsel-absence-api.test.cjs`): 선점·전송 중·확인 단계 전환, 소유 토큰, 재확인과 종결
- 읽기 일관성·반 동기화(`tests/read-consistency-api.test.cjs`, `tests/regular-class-*.test.cjs`, `tests/counsel-roster-*.test.cjs`)
- 특강 도메인(`tests/special-feature.test.cjs`): 특강기간 ON/OFF와 일일보고 생성 시점 플래그 보존, 정확한 강사 매칭, 수강년월·학생 로스터 고정, 특강일 반 병합
- 모의 ERP(`tests/ttt-mock-gateway.test.cjs`): 결정적 반·원생, 계정 없는 조회의 빈 값, 모의 구현 위 상담 쓰기
- 인증과 권한(`tests/auth-session.test.cjs`): 비밀번호 해시와 강도 매개변수 갱신, 세션 토큰 위조·만료, 요청의 `role`·`tid` 위조 무시, 팀장 전용·본인 전용 경로, 다른 출처 요청 차단, 로그인 시도 제한
- 주간테스트 PPT/PDF(`tests/weekly-*.test.cjs`)와 화면 단위 테스트(`tests/*-ui.test.cjs`)

CI 워크플로와 브라우저 E2E는 없다.

---

## 3. DB

`src/db/db.service.ts` 기준.

- **로컬 (`TURSO_DATABASE_URL` 없음)**: `<cwd>/data/app.sqlite` 파일 SQLite. `journal_mode = WAL` 적용(실패해도 무시).
- **Turso 연결 (`TURSO_DATABASE_URL` 있음)**: 같은 파일 경로를 **임베디드 리플리카**로 열고 `syncUrl`/`authToken`으로 원격과 동기화. 로컬 파일은 캐시, 원격이 진실. 서버리스에서 데이터가 영속되는 이유.
- **서버리스(`process.env.VERCEL`)에서는 데이터 디렉터리가 `/tmp`** — 인스턴스별로 다르고 휘발된다. Turso 없이 서버리스에 올리면 데이터가 유실된다.
- 부팅 시퀀스(`init()`): Turso면 먼저 `sync()`로 원격 pull → `SCHEMA_SQL`(CREATE TABLE IF NOT EXISTS) → 가벼운 마이그레이션(`migrate()`: 누락 컬럼 ALTER) → `SEED_MODE`에 따라 `bootstrapClean` 또는 `seedIfEmpty` → 실제 변경이 있었을 때만 push.
- 요청 단위 동기화(`pages/api/[[...slug]].ts`): `GET /api/state`, `GET /api/reports`, `GET /api/counsel`, `GET /api/other-team` 전에 pull하고 변경 뒤 push한다. 일일보고 날짜 생성·업무 정의·상담·특강 설정·다른 팀 변경은 실패를 호출자에게 전달하는 `syncStrict()` 또는 좁은 원격 primary 트랜잭션을 사용한다. ERP 조회가 긴 반 적용은 적용 직전에 최신 권한·자격증명을 다시 확인한다. Turso가 아니면 동기화 메서드는 no-op이다.
- 마이그레이션은 컬럼 추가만 한다. 컬럼 삭제/타입 변경은 지원하지 않는다.

---

## 4. 배포

운영에서는 Vercel 서버리스 함수와 Turso로 배포했다. 공개 저장소에는 배포 설정 파일을 두지 않는다.

- API 함수 `maxDuration: 120`초(`pages/api/[[...slug]].ts`) — 긴 외부 ERP 조회(반 명단·연락처)를 위한 상한이다. 배포 플랫폼이 120초 함수를 허용해야 한다.
- `next.config.js`의 `outputFileTracingIncludes`로 `/api/[[...slug]]`·`/api/utility/weekly-ppt` 함수에 `libsql` 네이티브 바이너리와 PPT 템플릿·글꼴을 포함시킨다. 이 설정이 빠지면 배포된 함수에서 DB 로드나 PPT 생성이 실패한다.
- 환경변수: `APP_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `LEAD_*`. 비밀값은 플랫폼의 비밀 환경변수로 저장하고 `NEXT_PUBLIC_*` 이름으로 만들지 않는다.
- 미리보기 배포는 운영과 다른 격리 DB를 쓴다.
- `GET /api/health` → `{ ok: true, warm: true }`. DB 동기화 없이 즉시 응답한다. 외부 핑으로 콜드스타트를 줄이는 용도.

---

## 5. CSS 캐시버스팅

`pages/_document.tsx`:

```tsx
const V = process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8) : String(Date.now());
```

- 디자인 토큰/컴포넌트 CSS는 `public/` 정적 파일을 `<link href="/app.css?v=${V}">`로 직접 링크한다. 파일명에 콘텐츠 해시가 없다.
- `next.config.js`의 `headers()`가 `/app.css`와 `/tokens/*`에 `public, max-age=3600, stale-while-revalidate=604800`을 건다. 즉 `?v` 없이는 최대 1시간 동안 옛 CSS가 그대로 서빙된다.
- 커밋 SHA가 없는 빌드는 빌드 시각(`Date.now()`)으로 폴백한다. 모듈 스코프라 빌드 시 1회 평가 → 배포별 고정값.
- `_next/static`(해시 파일)은 Next가 이미 immutable 처리하므로 건드리지 않는다.

---

## 6. 배포 전 확인

- [ ] `npm test`, `npx tsc --noEmit`, `npm run build` 모두 통과
- [ ] `APP_SECRET` 설정됨 — 그리고 **이전 배포와 동일한 값**인가?
- [ ] `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` 설정됨(서버리스에서 없으면 데이터 유실)
- [ ] `APP_TODAY` **비어 있음** — 값이 있으면 앱 전체가 그 날짜에 고정된다
- [ ] `LEAD_PW` 기본값(`1234`)이 아닌 값으로 지정 — 이미 부트스트랩된 DB라면 앱에서 직접 변경
- [ ] `SEED_MODE`가 `demo`가 아님(운영 기본은 `clean`)

### 알아둘 점

- `next.config.js`는 `eslint.ignoreDuringBuilds`와 `typescript.ignoreBuildErrors`가 켜져 있다. **타입 에러가 빌드를 막지 않는다.**
- 강사 외부 ERP 비밀번호의 평문 반환은 서버 내부 `getTeacherTtt()`에서만 일어나고 API 응답에는 실리지 않는다.
- 실제 비밀번호·학생/학부모 전화번호는 문서·이슈·커밋에 남기지 않는다. 모의 구현의 연락처는 모두 `010-0000-XXXX` 형태의 가짜 값이다.
- `reactStrictMode: false` (낙관적 업데이트 이중 렌더 방지).
