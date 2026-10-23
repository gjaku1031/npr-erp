# 데이터 모델 + API 레퍼런스

npr-notice 앱의 DB 스키마와 HTTP API 전체 목록. 모든 내용은 `` 아래 실제 코드에서 확인한 것이다.

- 스키마 정의: `src/db/schema.ts` (raw SQL DDL 문자열 — ORM 없음)
- DB 계층: `src/db/db.service.ts` (libSQL, better-sqlite3 호환 API)
- 비즈니스 로직: `src/api/store.service.ts`
- 라우터: `pages/api/[[...slug]].ts` (Next.js Pages Router catch-all 하나로 전 API 처리)

---

## 1. DB 스키마

날짜는 전부 ISO `YYYY-MM-DD` 문자열로 저장하고, 표시 라벨(`7월 11일 (토)`)과 D-day는 `src/config.ts`의 `koDate`/`ddayFrom`가 계산한다. Boolean은 `INTEGER 0/1`, 구조체는 JSON 문자열 컬럼이다.

### teachers — 강사 계정

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `tid` | TEXT PK | 로그인 아이디 |
| `name` | TEXT | 강사 이름. **다른 테이블들이 tid가 아니라 이 이름으로 강사를 참조한다** (task_status.teacher, daily_reports.teacher, counsel_entries.teacher) |
| `pw` | TEXT, 기본 `'1234'` | 앱 로그인 비밀번호 |
| `classes` | TEXT(JSON), 기본 `{"월수금반":[],"화목토반":[],"특강 월수금반":[],"특강 화목토반":[]}` | 요일그룹 → 담당 반명 배열. 기존 DB의 2개 키도 부팅 시 4개 키로 정규화한다. 네 그룹 모두 읽기 전용이며, 일반 2개 그룹은 정규 반 동기화가, 특강 2개 그룹은 특강 반 동기화가 교체한다 |
| `ttt_id` | TEXT, 기본 `''` | 강사 개인 외부 ERP 아이디 |
| `ttt_pw` | TEXT, 기본 `''` | 외부 ERP 비밀번호 — **AES-256-GCM 암호화 저장** (`src/ttt/crypto.ts`, 키는 `APP_SECRET`에서 SHA-256 파생). 형식 `iv:tag:ciphertext` (base64). 복호화 실패 시 빈 문자열 반환 |
| `is_lead` | INTEGER, 기본 0 | 팀장 권한 부여 여부. 1이면 로그인 시 팀장 화면으로 시작하되 강사 모드 전환도 가능(본인 일일보고 작성). 마스터 팀장은 별도 `lead_account` |
| `is_other_team` | INTEGER, 기본 0 | 다른 팀 편의 기능 권한. 1이면 강사 현황에는 남지만 일일보고·공용 업무·정규 반 동기화 대상에서는 제외되고 `role='other'` 화면을 사용 |
| `sort` | INTEGER, 기본 0 | 정렬 순서 |

### lead_account — 마스터 팀장

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `id` | TEXT PK | 로그인 아이디 (부트스트랩 시 `LEAD_ID` 환경변수, 기본 `admin`) |
| `pw` | TEXT | 비밀번호 (`LEAD_PW` 환경변수) |
| `name` | TEXT | 표시 이름 (`LEAD_NAME` 환경변수) |

마스터 팀장은 강사가 아니므로 일일보고 작성 대상이 아니다(`login`이 `isTeacher:false` 반환).

### tasks — 업무

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `id` | TEXT PK | `t` + UUID 8자 |
| `title` / `descr` | TEXT | 제목 / 설명 |
| `tag` | TEXT, 기본 `'행정'` | tags.name 참조(FK 제약은 없음) |
| `start_date` / `due_date` | TEXT | ISO 날짜 |
| `scope` | TEXT(JSON), 기본 `'"all"'` | `"all"`(전 강사) 또는 `["강사이름", ...]`. `"all"`이면 현재 teachers 전원으로 동적 확장 |
| `report_req` | INTEGER 0/1 | 텍스트 보고 필수 — 미작성 시 완료 처리 거부(400) |
| `attach_req` | INTEGER 0/1 | 첨부파일 필수 — 없으면 완료 처리 거부(400) |
| `mt` | INTEGER 0/1 | **MT 업무**: 강사가 M(월수금)/T(화목토)를 따로 체크. 둘 다 done이어야 status='done' |
| `counsel` | INTEGER 0/1 | **전체 상담 업무**: 반별 학생 로스터를 받아 학생마다 상담을 작성·외부 ERP 전송. 완료 판정이 task_status가 아니라 counsel_entries 기준 |
| `special_counsel` | INTEGER 0/1 | **특강상담 업무**. `counsel`과 동시에 1일 수 없으며 서버가 생성·수정 모두 거부한다 |
| `special_source_month` | TEXT, 기본 `''` | 특강상담 생성 당시 수강년월(`YYYY-MM`). 업무가 참조하는 대상 월을 이후 동기화와 분리한다 |
| `special_assignees` | TEXT(JSON), 기본 `'[]'` | 특강상담 생성 당시 담당 강사명 스냅샷. `scope='all'`이어도 이후 추가·삭제된 강사에 따라 과거 업무 대상이 변하지 않는다 |
| `self_managed` | INTEGER 0/1 | 다른 팀 사용자가 직접 만든 개인 상담일정 여부. 공용 업무 목록·일일보고에서는 제외 |
| `created_by_tid` | TEXT, 기본 `''` | `self_managed=1` 상담일정의 소유 강사 `tid` |
| `self_source_month` | TEXT, 기본 `''` | 개인 상담일정의 본인 반 명단 기준 수강년월 |
| `archived` | INTEGER 0/1 | 보관 처리. **이 값을 1로 만드는 코드 경로가 없다** — `createTask`는 0 고정, `updateTask`는 컬럼 미포함, 전용 라우트도 없음. `demo` 시드의 t5만 `archived:1`. 프론트는 읽기만 하고(완료 취급·흐리게 표시·위저드 제외) 쓰지 않는다 |
| `links` | TEXT(JSON), 기본 `'[]'` | `[{label, url}]` |
| `atts` | TEXT(JSON), 기본 `'[]'` | `["파일명"]` (업무 지시용 첨부). `createTask`가 바디의 `atts`를 그대로 넣지만 **이를 보내는 프론트 경로가 없다** — `demo` 시드에만 값이 있고, 화면은 문자열을 그대로 `📎 파일명` 칩으로 렌더만 한다 |
| `created_at` | TEXT | 생성일(앱 기준 오늘) |
| `sort` | INTEGER | 정렬 |

### task_status — 강사별 업무 처리 상태

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `task_id` + `teacher` | TEXT, 복합 PK | teacher는 **강사 이름** |
| `status` | TEXT | `'done'` / `'undone'` / `'none'` |
| `report_text` | TEXT | 텍스트 보고 |
| `report_files` | TEXT(JSON) | 첨부 배열 — **파일명만이 아니라 파일 내용까지 들어간다.** 현재 프론트(`lib/state.tsx`의 `addTaskFiles`)는 `{name, url}`을 넣고 `url`은 `data:application/octet-stream;base64,...` 형태의 base64 data URL이다(= 바이너리가 이 컬럼에 그대로 저장됨). 별도 파일 저장소·업로드 엔드포인트는 없다. 크기 제한은 **클라이언트에서만** 4MB/개로 거름(서버 검증 없음). 렌더러(`FileChips`, `components/ui.tsx`)는 구버전 문자열 파일명도 함께 처리한다 |
| `m_done` / `t_done` | INTEGER 0/1 | MT 업무의 월수금/화목토 부분 완료. 둘 다 1 → `done`, 하나만 1 → `undone`, 둘 다 0 → `none` |
| `at` | TEXT | 처리 시각 라벨(예: `'09:30'`, `'어제'`, `'방금'`) — 실제 타임스탬프가 아닌 표시용 문자열 |

### counsel_entries — 일반/특강 상담 업무의 학생별 엔트리

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `id` | TEXT PK | `ce` + UUID 8자 |
| `task_id` | TEXT | 대상 상담 업무 |
| `teacher` | TEXT | 강사 이름 |
| `cls` | TEXT | 반명 |
| `scode` | TEXT | 외부 ERP 원생 학번(상담쓰기 시 사용) |
| `student` | TEXT | 원생명 |
| `phone` | TEXT | 어머니 전화 — 로스터 동기화 때 갱신. **모 번호만 사용하고 부 번호로 대체하지 않는다**(비어 있으면 원부 누락으로 보고 화면에서 경고) |
| `subject` | TEXT | 상담 주제 (빈 값이면 전송 시 `'상담'`으로 기본값 적용) |
| `content` | TEXT | 상담 내용 — **로스터 재동기화 시 보존** |
| `synced` | INTEGER 0/1 | 외부 ERP 전송 완료 여부. 주제/내용을 저장하면 0으로 리셋(재전송 필요) |
| `synced_at` | TEXT | 전송 시각 라벨 (KST `MM/DD HH:mm`) |
| `done` | INTEGER 0/1 | 강사 수동 완료 표시(했음/안했음) — synced와 별개 |
| `delivery_state` | TEXT | `idle` · `pending` · `confirmed`. ERP POST 결과가 불확실한 동안 `pending`으로 원격 DB에 남겨 재전송을 차단 |
| `delivery_stage` | TEXT | `''` · `claimed` · `posting` · `confirmed`. `claimed`는 공유 primary 선점만 완료되어 ERP POST가 없었음을 증명하고, `posting`부터는 도달 여부가 불확실해 재전송을 금지 |
| `delivery_claim_token` | TEXT | 현재 `claimed/posting` 요청의 임의 소유 토큰. API 응답에는 노출하지 않고 단계 전환 CAS에만 사용하며 완료·안전 초기화 때 제거 |
| `delivery_fingerprint` | TEXT | 상담 날짜·주제·본문의 SHA-256 지문. 원문을 노출하지 않고 같은 요청을 멱등 처리 |
| `delivery_date` / `delivery_before_count` | TEXT / INTEGER | 실제 상담일과 POST 직전 동일 상담 건수. 이후 읽기 전용 결과 확인 기준 |
| `delivery_attempted_at` / `delivery_message` | TEXT | 전송 시도 시각과 화면 안내 메시지 |
| — | UNIQUE | `(task_id, teacher, cls, scode)` |

일반상담 로스터 동기화는 **보존갱신**이다: 현재 로스터의 학생은 `student`/`phone`만 갱신하고 `content`/`synced`는 유지, 로스터에 없는 학생(퇴원 등)은 삭제. 단 로스터가 비었으면(수업일 아님/조회 실패) 아무것도 지우지 않으며, `delivery_state='pending'` 행은 새 로스터에 없어도 보존해 미확인 ERP 쓰기가 새 ID로 재생성·중복 전송되는 일을 막는다.

특강상담은 업무 생성 시 해당 월의 `special_class_roster`를 이 테이블로 복사한다. 그 뒤 반 목록·학생·진행률·연락처 보강은 이 복사본을 기준으로 하므로 같은 수강년월을 다시 동기화해도 이미 만든 업무의 대상은 바뀌지 않는다. 기존 업무가 특강상담이면 엔트리가 0개여도 상담 종류나 배정 범위를 변경할 수 없고, 일반상담도 엔트리가 생긴 뒤에는 같은 잠금이 적용된다. 특강 대상이 0명인 담당자는 `noTarget`으로 완료 집계를 막지 않는다.

### special_class_roster — 특강 월별 반·원생 캐시

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `source_month` | TEXT, PK 일부 | 실제 조회된 수강년월(`YYYY-MM`) |
| `class_code` | TEXT, PK 일부 | 외부 ERP 반 코드 |
| `class_name` | TEXT | 외부 ERP 반명 |
| `teacher_tid` / `teacher_name` | TEXT | 이름을 trim한 뒤 로컬 강사와 정확히 1명 매칭된 tid·이름. 동명이인은 미매칭 처리 |
| `day_group` | TEXT | 지원 요일표만 `M`(월수금) 또는 `T`(화목토) |
| `scode` | TEXT, PK 일부 | 외부 ERP 원생 학번 |
| `student` | TEXT | 원생명 |
| `mother_phone` | TEXT, 기본 `''` | 특강상담에서 해당 반을 열 때 상세 조회로 보강한 어머니 연락처. 빈 조회값은 기존 값을 지우지 않는다 |
| `synced_at` | TEXT | 스냅샷 동기화 시각(ISO) |

기본키는 `(source_month, class_code, scode)`이고 `(source_month, teacher_tid, day_group, class_name)` 인덱스가 있다. 성공한 동기화는 해당 월 로스터와 모든 강사의 특강 M/T 그룹을 한 트랜잭션에서 전체 교체한다. 다른 월 캐시와 이미 생성된 특강상담의 `counsel_entries` 복사본은 유지한다. 파싱 실패·무매칭이면 트랜잭션에 들어가지 않아 기존 배정을 보존한다.

### other_team_syncs / other_team_classes / other_team_students — 다른 팀 본인 반 캐시

세 표는 `(teacher_tid, source_month)`를 공통 범위로 사용한다. `other_team_syncs`는 동기화 시각·반/학생 집계·경고를, `other_team_classes`는 반 코드·반명·요일표와 학생 수를, `other_team_students`는 반 코드별 원생 코드·이름·학년·상태를 저장한다. 최신 동기화 월만 화면·알림장 접근 범위로 쓰며, 이전 월 스냅샷은 과거 상담일정의 이력을 위해 보존한다. 기존 학생이 빠지는 새 스냅샷은 별도의 fresh ERP 조회가 같은 소속 집합을 반환한 경우에만 원격 primary 트랜잭션으로 교체한다.

다른 팀 상담일정 생성 시 최신 스냅샷의 학생을 `counsel_entries`로 복사하고 `teacher_tid`·`class_code`로 소유 범위를 고정한다. 이후 재동기화는 기존 드래프트·전송·부재 이력을 삭제하지 않고 최신 포함 여부를 `roster_active`로 갱신한다. 강사 계정을 삭제하면 이 세 표와 해당 강사의 `self_managed` 업무·상담/부재 이력도 함께 삭제한다.

### events — 개인/팀 일정

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `id` | TEXT PK | `e` + UUID 8자 |
| `owner` | TEXT | `'lead'`(마스터 팀장 개인) / `'team'`(팀 공용) / 강사 `tid` |
| `type` | TEXT | `'personal'` / `'team_event'` |
| `tag` | TEXT | `'개인일정'` / `'일정'` (또는 지정 태그) |
| `title` / `descr` | TEXT | 제목 / 메모 |
| `start_date` / `end_date` | TEXT | ISO. end 미지정 시 start와 동일 |

`updateEvent`는 owner/type을 바꾸지 않는다(소유 고정, 제목·메모·기간·태그만 수정).

### tags — 업무/일정 태그

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `name` | TEXT PK | 태그명(=식별자). 이름 변경 시 tasks/events의 tag가 연쇄 갱신됨 |
| `color` | TEXT | 색 이름 또는 hex 혼용. 해석은 `lib/helpers.ts`의 `tagMeta()` — 이름이 `COLORS` 맵(`올리브`/`블루`/`옐로`/`네이비`/`그린`/`레드`)에 있으면 그 CSS 변수 조합을 쓰고, `#`로 시작하면 hex로 보고 `color-mix`로 배경·글자색을 생성하며, 그 외/미등록 태그는 `네이비`로 폴백. 태그 생성 UI의 프리셋(`PRESETS`)은 `올리브`/`블루`/`옐로` 3종 + 직접 입력 hex |
| `emoji` | TEXT, 기본 `'🗂️'` | 표시 이모지 |
| `sort` | INTEGER | 정렬 |

`'상담'`은 고정 태그(`FIXED_TAGS`)로 삭제·이름변경 불가. 부팅 시 `ensureFixedTags()`가 없으면 생성한다. 다른 태그를 삭제하면 그 태그를 쓰던 업무는 `'행정'`으로 폴백.

### notices — 공지

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `id` | TEXT PK | `n` + UUID 8자 |
| `text` | TEXT | 내용 |
| `active` | INTEGER, 기본 1 | 노출 여부 |
| `posted_date` | TEXT | 게시일 |
| `author` | TEXT | 작성자. 생성 시 `'팀장 ' + lead_account.name`로 채움 (DDL 기본값은 하드코딩된 `'팀장 김도현'`) |
| `sort` | INTEGER | 노출 순서. 새 공지는 `MIN(sort)-1`로 맨 앞에 삽입 |

### journals / journal_items — 날짜별 일일보고(체크리스트) 정의

`journals`

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `date` | TEXT PK | ISO 날짜 = 일일보고 단위 |
| `created_at` | TEXT | 생성일 |
| `special_period` | INTEGER 0/1, 기본 0 | 날짜 생성 당시 전역 특강기간 토글의 불변 스냅샷. 토글을 나중에 꺼도 바뀌지 않는다 |

`journal_items`

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `id` | TEXT PK | `ji` + UUID 8자 |
| `date` | TEXT | 소속 journals.date |
| `text` | TEXT | 체크 항목 문구 |
| `required` | INTEGER 0/1 | 필수 항목 여부 |
| `sort` | INTEGER | 정렬 |

새 날짜를 만들면 오늘 날짜 체크리스트를 복사하고, 없으면 그 날짜 이전 가장 최근 journal의 항목을 복사한다.

### daily_reports — 강사 일일보고 제출물 (강사 × 날짜 1건)

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `id` | TEXT PK | `dr` + UUID 8자 |
| `teacher` | TEXT | 강사 이름 |
| `date` | TEXT | ISO |
| `status` | TEXT, 기본 `'draft'` | `'draft'`(임시저장) / `'submitted'`(제출) |
| `confirmed` | INTEGER, 기본 0 | 팀장 확인 완료. **제출된 보고에만 유효** — 미제출인데 confirmed=1인 과거 데이터는 조회 시 false로 교정해 내려보냄 |
| `payload` | TEXT(JSON), 기본 `'{}'` | 위저드 상태. 실제 형태는 `{cl, nbByClass, nbSync, counselOk, attOk, myStatus, classSnapshot, specialPeriod, nb}`. `classSnapshot`은 그 보고가 실제 처리한 일반+특강 반 목록, `specialPeriod`는 해당 보고의 특강 여부라 이후 반 재동기화가 과거 열람 내용을 바꾸지 않는다. **`cl[].files`에는 base64 data URL이 들어갈 수 있어 payload가 수 MB가 될 수 있다** |
| `submitted_at` | TEXT NULL | 제출 시각 라벨(`submitReport`는 문자열 `'제출'`을 넣는다 — 실시각 아님) |
| — | UNIQUE | `(teacher, date)` |

`confirmReport`는 status가 `'submitted'`가 아니면 400을 던진다(미확인 보고 확인 시 draft가 생기던 버그 방지). `reopenReport`는 confirmed된 보고를 거부한다.

### settings — 전역 kv

| 컬럼 | 타입 | 의미 |
|---|---|---|
| `k` | TEXT PK | 키. `wtest_m`, `wtest_t`, 특강 설정 `special_period_enabled`, `special_sync_date`, `special_sync_month`, `special_sync_at`, `special_sync_summary`, 정규반 설정 `regular_sync_date`, `regular_sync_month`, `regular_sync_at`, `regular_sync_summary`를 사용한다 |
| `v` | TEXT | 값 |

특강 설정은 일반 `/api/settings`로 덮어쓸 수 없다. 전역 ON/OFF와 기준일은 `/api/special-period`가 함께 저장하고, 성공한 반 동기화만 최근 수강년월·시각·요약을 갱신한다. `special_sync_summary`에는 반/학생 수와 미매칭 목록 등 운영 진단 정보가 JSON으로 들어가며 팀장 상태 응답에만 노출된다.

정규반 동기화 설정도 일반 `/api/settings`로 덮어쓸 수 없다. 성공한 전체 스냅샷만 `regular_sync_*`를 갱신하고, 계정 실패·미귀속·충돌 또는 dry-run은 기존 강사 반과 기존 성공 요약을 바꾸지 않는다. 상세 요약은 팀장 상태에만 노출된다.

### 마이그레이션 방식 (`src/db/db.service.ts`)

마이그레이션 파일이나 버전 테이블 없이 **`PRAGMA table_info`로 컬럼 존재를 확인하고 없으면 `ALTER TABLE ADD COLUMN`** 하는 방식이다.

1. Turso 연결 시 `db.sync()`로 원격 스키마/데이터를 먼저 pull
2. `SCHEMA_SQL` 전체를 `exec` — 전부 `CREATE TABLE IF NOT EXISTS`라 기존 테이블에는 no-op
3. `migrate()`가 추가 컬럼을 개별 검사: `teachers.ttt_id`/`ttt_pw`/`is_lead`/`is_other_team`, `tasks.mt`/`counsel`/`special_counsel`/`special_source_month`/`special_assignees`/`self_managed`/`created_by_tid`/`self_source_month`, `task_status.m_done`/`t_done`, `counsel_entries.subject`/`done`/`delivery_*`, `journals.special_period`. 새 컬럼은 `NOT NULL DEFAULT`가 있어 기존 행에도 안전하게 붙는다. 기존 완료 상담은 `confirmed`, stage 도입 전 `pending`은 이미 ERP POST가 실행됐을 가능성을 보존해 `posting`으로 백필한다. 기존 특강상담의 `special_assignees`는 마이그레이션 시점 담당자로 백필하며, `special_class_roster`와 `other_team_*` 표는 앞 단계의 `CREATE TABLE IF NOT EXISTS`로 생성된다
4. 기존 `teachers.classes` JSON을 일반 2그룹 + 특강 2그룹 형태로 정규화한다. 기존 일반 반 값은 보존한다
5. `SEED_MODE`(기본 `clean`)에 따라 `bootstrapClean`(팀장 계정 + 기본 태그 5개만) 또는 `demo`면 `seedIfEmpty`(디자인 프로토타입 시드)
6. 실제 변경(마이그레이션 또는 부트스트랩)이 있었을 때만 원격 push — 이미 부팅된 콜드스타트는 pull만 해 왕복 1회 절약

DB 파일 위치는 서버리스(`process.env.VERCEL`)면 `/tmp/app.sqlite`, 로컬이면 `data/app.sqlite`. `TURSO_DATABASE_URL`이 있으면 임베디드 리플리카 모드(로컬 파일은 캐시, 원격이 진실)이고, 없으면 순수 로컬 파일 + WAL. `backend()`(`src/backend.ts`)가 DB/Store/Ttt를 프로세스당 1회만 생성하며, `init()`이 던지면 싱글톤을 남기지 않아 다음 요청이 재초기화를 시도한다.

---

## 2. API 레퍼런스

전 API가 `pages/api/[[...slug]].ts` 하나의 catch-all 핸들러다(`maxDuration: 120`; 긴 외부 ERP 조회 여유). 매칭되는 라우트가 없으면 404, `HttpError`는 자기 status로, 그 외 예외는 500.

### 인증 / 상태 / 헬스

| 메서드 | 경로 | 용도 | 권한 |
|---|---|---|---|
| GET | `/api/health` | keep-warm 핑(외부 모니터가 주기 호출 → 콜드스타트 회피). DB 동기화 없이 즉시 `{ok:true,warm:true}` | 공개 |
| POST | `/api/login` | `{id, pw}` → `{role, tid, name, canLead, isTeacher, canOtherTeam}`. lead_account 우선 조회, 없으면 teachers. 다른 팀은 `role='other'`, 임명 팀장과 동시에 켜져 있으면 팀장 역할로 시작 | 공개 |
| GET | `/api/state?role=&tid=` | 전체 상태 스냅샷(아래 3장) | role/tid가 결정 |

### 업무 `/api/tasks`

| 메서드 | 경로 | 용도 | 권한(UI) |
|---|---|---|---|
| POST | `/api/tasks` | 업무 생성 → `{id}`. 바디: `title, descr, tag, start, due, all|pick, reportReq, attachReq, mt, counsel, specialCounsel, links, atts, requestId?`. `requestId`가 있으면 요청자와 함께 결정적 task ID를 만들어 같은 요청 재시도를 멱등 처리하고, 같은 ID의 다른 payload는 409. `counsel`과 `specialCounsel` 동시 선택은 400. 특강상담은 최근 성공한 수강년월과 담당자별 로스터를 즉시 고정 | 팀장 |
| POST | `/api/tasks/:id/edit` | 업무 수정. 일반/특강 상담 상호 배타를 재검증한다. 기존 특강상담은 대상이 0명이어도 상담 종류·배정 범위를 바꿀 수 없고, 일반상담은 엔트리가 생긴 뒤 같은 변경이 400이다. **`atts`·`archived`·`created_at`·`sort`는 수정 대상이 아니다** | 팀장 |
| POST | `/api/tasks/:id/status` | `{teacher, status, at}` 완료/미완료 토글. `done`이면 report_req/attach_req 검증 후 통과해야 저장 | 강사 본인 |
| POST | `/api/tasks/:id/mt` | `{teacher, part:'m'|'t', value, at}` MT 부분 완료 토글 | 강사 본인 |
| POST | `/api/tasks/:id/report` | `{teacher, text, files}` 보고 저장(상태 변경 없음, 행 없으면 `status:'none'`으로 생성) | 강사 본인 |
| DELETE | `/api/tasks/:id` | 업무 + 관련 task_status 삭제 | 팀장 |

### 일정 `/api/events`

| 메서드 | 경로 | 용도 | 권한(UI) |
|---|---|---|---|
| POST | `/api/events` | 생성 → `{id}`. `{mode:'team'|'personal', title, descr, start, end, tag}`. owner는 `mode==='team'`이면 `'team'`, 아니면 팀장 `'lead'` / 강사 `tid` | 팀 일정은 팀장, 개인일정은 각자 |
| POST | `/api/events/:id/edit` | 제목·메모·기간·태그 수정 | 소유자 |
| DELETE | `/api/events/:id` | 삭제 | 소유자(팀 일정=팀장) |

### 태그 `/api/tags`

| 메서드 | 경로 | 용도 | 권한(UI) |
|---|---|---|---|
| POST | `/api/tags` | `{name, color, emoji}` 생성. 중복 이름 400 | 팀장 |
| POST | `/api/tags/:name` | 수정(이름/색/이모지). 이름 변경 시 tasks·events 연쇄 갱신. 고정 태그(`상담`) 이름 변경 400 | 팀장 |
| DELETE | `/api/tags/:name` | 삭제(사용 중이던 업무는 `행정`으로 폴백). 고정 태그 400 | 팀장 |

`:name`은 URL 인코딩된 한글이라 서버가 `decodeURIComponent` 처리한다.

### 공지 `/api/notices`

| 메서드 | 경로 | 용도 | 권한(UI) |
|---|---|---|---|
| POST | `/api/notices` | `{text}` 생성 → `{id}`. 맨 앞 배치 | 팀장 |
| POST | `/api/notices/reorder` | `{ids:[...]}` 순서대로 sort 재부여 | 팀장 |
| POST | `/api/notices/:id` | `{text, active}` 수정 | 팀장 |
| DELETE | `/api/notices/:id` | 삭제 | 팀장 |

`reorder`가 `:id` 라우트보다 먼저 매칭되므로 `reorder`라는 id를 가진 공지는 수정 불가(실제로는 uid 형식이라 충돌 없음).

### 강사 `/api/teachers`

| 메서드 | 경로 | 용도 | 권한(UI) |
|---|---|---|---|
| POST | `/api/teachers` | `{name, tid, pw, tttId, tttPw}` 생성. tid 중복 400. pw 기본 `'1234'` | 팀장 |
| POST | `/api/teachers/:tid/classes` | `{group, classes}` 직접 수정은 정규·특강을 포함한 모든 반 그룹에서 400. 정규반은 `/api/regular-classes/sync`, 특강반은 `/api/special-classes/sync`만 갱신 가능 | 팀장(항상 거부) |
| POST | `/api/teachers/:tid/ttt` | `{tttId, tttPw}` 외부 ERP 계정 저장(빈 pw면 기존 유지, 검증 없음) | 팀장 |
| POST | `/api/teachers/:tid/lead` | `{isLead}` 팀장 권한 부여/해제 | 팀장 |
| POST | `/api/teachers/:tid/other-team` | `{isOtherTeam}` 다른 팀 편의 기능 권한 부여/해제. 강사·반 동기화 mutation lease로 직렬화 | 팀장 |
| POST | `/api/teachers/:tid/reset-pw` | 임시 비번 발급 → `{tmp}` (`'np' + 4자리`) | 팀장 |
| POST | `/api/teachers/:tid/password` | `{pw}` 비밀번호 직접 지정 | 팀장 |
| DELETE | `/api/teachers/:tid` | 강사 삭제 + 처리 상태/보고/리마인드/일정/특강 로스터 정리. 다른 팀이면 본인 반 캐시와 소유 개인 상담일정·상담/부재 이력도 삭제 | 팀장 |

### 다른 팀 편의 기능 `/api/other-team`

| 메서드 | 경로 | 용도 | 권한 |
|---|---|---|---|
| GET | `/api/other-team/classes` | 로그인 `tid`의 최신 본인 반·학생 스냅샷 조회 | 다른 팀 본인 |
| POST | `/api/other-team/classes/sync` | `{targetDate}`. 본인 외부 ERP 자격증명으로 해당 월의 담당 반·현재 학생을 조회해 원격 primary에 저장. `[연장]` 제외, 미지원 요일표 포함, 학생 제거 시 fresh 2회 일치 확인 | 다른 팀 본인 |
| POST | `/api/other-team/counsel` | `{title, descr, start, due, requestId}`. 최신 본인 반 학생을 고정한 `self_managed` 상담일정 생성; `requestId` 재시도 멱등 | 다른 팀 본인 |
| DELETE | `/api/other-team/counsel/:id` | 본인이 만든 상담일정과 해당 상담/부재/상태 이력 삭제 | 다른 팀 본인 |

### 일일보고 정의 `/api/journals`, `/api/journal-items`

| 메서드 | 경로 | 용도 | 권한(UI) |
|---|---|---|---|
| POST | `/api/journals` | `{date}` 날짜 생성(이미 있으면 no-op). 오늘/직전 체크리스트를 복사하고 현재 전역 특강기간 값을 `special_period`로 고정 | 팀장 |
| DELETE | `/api/journals/:date` | 정의 + 항목 + **그 날 제출물 전부** 삭제 | 팀장 |
| POST | `/api/journals/:date/items` | `{text, required}` 항목 추가 | 팀장 |
| DELETE | `/api/journal-items/:id` | 항목 삭제 | 팀장 |
| POST | `/api/journal-items/:id/toggle-req` | 필수 여부 토글 | 팀장 |

### 일일보고 제출물 `/api/reports/:teacher/:date`

| 메서드 | 경로 | 용도 | 권한(UI) |
|---|---|---|---|
| GET | `/api/reports/:teacher/:date` | 단건 조회 → `{teacher,date,status,confirmed,payload,at}` 또는 `null` | 강사 본인 / 팀장 |
| POST | `.../draft` | `{payload}` 임시저장 | 강사 본인 |
| POST | `.../submit` | `{payload}` 제출(confirmed 리셋) | 강사 본인 |
| POST | `.../confirm` | 팀장 확인. 미제출이면 400 | 팀장 |
| POST | `.../reopen` | 제출 취소 → draft. confirmed면 400 | 강사 본인 / 팀장 |

`:teacher`는 강사 **이름**이며 URL 인코딩 → 서버가 디코딩.

### 설정 / 일반·특강 반 동기화

| 메서드 | 경로 | 용도 | 권한(UI) |
|---|---|---|---|
| POST | `/api/settings` | `{key, value}` upsert (주간테스트 날짜 `wtest_m`/`wtest_t`) | 팀장 |
| POST | `/api/special-period` | `{enabled, targetDate:'YYYY-MM-DD'}` — 전역 토글과 동기화 기준일을 한 트랜잭션으로 저장. 토글 OFF여도 유효한 날짜가 필요 | 팀장(서버 검사) |
| POST | `/api/special-classes/sync` | 종료된 자동 특강 반 동기화. 410 응답(반은 본인 반 관리에서 직접 선택) | — |
| POST | `/api/regular-classes/sync` | 종료된 자동 정규 반 동기화. 410 응답(반은 본인 반 관리에서 직접 선택) | — |

### 전체 상담 업무 `/api/counsel`

| 메서드 | 경로 | 용도 | 권한(UI) |
|---|---|---|---|
| GET | `/api/counsel/:taskId?teacher=&cls=` | `{kind:'regular'|'special', sourceMonth, classes, entries}`. 특강의 `sourceMonth`·`classes`는 업무 생성 시 고정된 엔트리 기준 | 강사 본인(서버가 tid에 바인딩), 팀장 |
| POST | `/api/counsel/:taskId/sync-roster` | `{cls, date, teacher, tid}`. 일반은 강사 계정으로 외부 ERP 로스터를 보존갱신한다. 특강은 고정 엔트리 중 선택한 반 학생의 상세만 학원 단위 조회로 읽어 어머니 연락처를 보강하고 `{entries, rosterCount, missingPhoneCount?, kind, sourceMonth, classes, warnings}` 반환 | 강사 본인(서버가 tid에 바인딩), 팀장 |
| POST | `/api/counsel/entry/:id/done` | `{done}` 수동 완료 표시 → `{entry}` | 강사 본인 |
| POST | `/api/counsel/entry/:id/write` | `{taskId, cls, scode, subject, content, openLevel, date, tid}`. 오래된 `id`는 강사에 바인딩된 자연키로 재해결한다. 공유 Turso primary에서 `claimed`를 원자 선점하고 사전 건수와 `posting`을 영속한 뒤 **한 번만** ERP POST한다. ERP 확인·영속은 201, ERP 결과 또는 앱 확정이 대기 중이면 재전송 금지 202. 내용이 비면 400 | 강사 본인 |
| POST | `/api/counsel/entry/:id/reconcile` | `{taskId, cls, scode, date, tid}`. `posting` 상담은 ERP 목록 읽기만으로 다시 확인하며 상담 저장 POST는 하지 않는다. `claimed`는 3분 소유 lease 동안 진행 중으로 두고, lease가 끝난 동일 토큰 선점만 CAS로 `idle/retryable`에 되돌린다. 확인 시 `confirmed/synced=1`, 아직 안 보이거나 조회가 지연되면 202와 재전송 금지를 유지 | 강사 본인 |
| POST | `/api/counsel/entry/:id/resolve` | `{taskId, cls, scode, resolution:'not-sent'|'sent', fingerprint, tid}`. 외부 ERP을 사람이 직접 확인한 뒤에만 쓰는 `posting` 전송의 수동 종결이다. ERP를 호출하지 않고, `not-sent`는 `idle`(드래프트 보존·재전송 허용), `sent`는 `confirmed/synced=1`로 옮기며 확인 주체를 메시지에 남긴다. 지문이 다르거나 아직 `claimed`면 409 | 강사 본인 |

`write`가 드래프트와 `pending` 시도를 전송보다 먼저 원격 DB에 저장하는 이유는 전송 실패에도 입력을 보존하고, 서버리스 인스턴스가 바뀌거나 응답이 유실돼도 같은 상담을 다시 보내지 않기 위해서다. 서로 다른 서버리스 인스턴스도 direct Turso primary의 소유 토큰 guarded UPDATE에서 한 요청만 `send` 권한을 얻는다. fresh `claimed`는 3분 동안 다른 요청이 회수하지 못하며, 오래되어 회수된 뒤에는 이전 소유 토큰이 어떤 단계도 바꿀 수 없다. ERP 저장 POST는 자동 재시도하지 않는다. 외부 ERP 상담 목록은 긴 본문을 9~10자 미리보기로 반환하므로 원생코드·일자·주제·정확한 9자 이상 앞부분이 같은 행의 저장 전후 건수가 증가해야 성공이다(`src/ttt/counsel-write.ts`). `posting` 이후 확인 불가나 `persistence='pending'` 응답은 `/reconcile`로 읽기 확인만 하며 다시 보내면 안 된다. 확인되지 않은 `/reconcile`은 읽기 전용 진단(반 명단에 원생이 있는지, 강사별 상담 목록에 같은 상담이 있는지)을 한 번 더 수행해 원인을 안내 문구와 `counsel_delivery_unconfirmed` 로그에 남긴다. ERP가 저장을 거부하면 그 사유는 저장 응답의 안내문에만 남으므로 `write`가 이를 함께 보존한다. 자동 조회만으로는 "저장 실패"와 "조회 실패"를 끝내 구분할 수 없어, 외부 ERP를 직접 확인한 강사만 `/resolve`로 종결할 수 있다. 특강상담도 실제 상담 쓰기는 강사 개인 계정 경로를 재사용한다.

### 외부 ERP 프록시 `/api/ttt`

응답은 외부 ERP 서비스 계층(`src/ttt/ttt.service.ts`)이 그대로 반환한다. `tid`로 강사 개인 외부 ERP 자격증명을 DB에서 꺼내(복호화) 그 계정으로 포트(`TttGateway`)를 호출한다. 공개 저장소의 포트 구현은 모의 구현(`src/ttt/ttt.mock.ts`)뿐이다.

| 메서드 | 경로 | 용도 | 비고 |
|---|---|---|---|
| GET | `/api/ttt/status?tid=` | 연동 상태 배지 → `{notebook:'mock', ok, message, memberName}` | — |
| POST | `/api/ttt/teacher-creds` | `{tid, tttId, tttPw}` — 포트의 계정 확인 후 저장 → `{ok, memberName}`. 실패 시 400. tttPw 생략 시 기존 저장분 사용 | 유일하게 검증하는 저장 경로 |
| GET | `/api/ttt/notebook?cls=&date=&tid=` | 알림장 조회 | — |
| POST | `/api/ttt/notebook` | `{cls, date, title, body, files, cmtId, attach, tid}` 게시/수정. `attach`(`NbAttach`, `src/ttt/ttt.gateway.ts`) = `{urls?, images?: [{filename,b64}], files?: [{filename,b64}], keepImages?, keepImageSizes?, keepFiles?, keepFileSizes?}` — `keep*`는 수정 시 유지할 기존 첨부 참조 | — |
| GET | `/api/ttt/attendance?cls=&date=&tid=` | 출결 조회(읽기 전용) | 계정 없으면 `[]` |
| GET | `/api/ttt/counsel?date=&classes=&tid=` | 상담 조회. `classes`는 콤마 구분 | 계정 없으면 `[]` |
| GET | `/api/ttt/scores?cls=&date=&hwdate=&tid=` | 성적 조회 | 계정 없으면 `[]` |
| GET | `/api/ttt/roster?cls=&date=&tid=` | 반 학생 로스터 | 계정 없으면 `[]` |
| POST | `/api/ttt/counsel-write` | 레거시 상담 직접 쓰기 | **410 비활성화**. 상담 엔트리·primary 선점·앱 DB 기록을 우회하므로 `/api/counsel/entry/:id/write`만 사용 |

출결·상담·성적·로스터는 실패 시 빈 배열을 주고, 강사 본인 계정이 없으면 공유 계정으로 대체하지 않는다(가짜 데이터·타 강사 자료 노출 방지). 기능별 실패 정책의 정본은 [requirements.md](requirements.md) §3.11이다.

### fold-state 패턴 (왕복 1회 제거)

`GET`이 아닌 모든 요청은 핸들러가 응답을 조립할 때 **최신 전체 state를 함께 실어 보낸다**:

```
{ ok: true, state: { ...getState(role, tid) } }   // 또는 { id: 't1a2b3c4', state: {...} }
```

- 조건: `slug[0]`이 `login`도 `ttt`도 아니고, 라우트 반환값이 `null`이 아닐 것 (`login`/`ttt`는 자체 응답 형태 유지)
- `role`/`tid`는 쿼리 우선, 없으면 바디, 기본값 `'lead'`/`'admin'`
- fold가 실패해도 변경 자체는 성공 처리(try/catch로 감쌈)
- 클라이언트는 이 덕분에 변경 후 별도 `GET /api/state`를 하지 않는다
- 상태코드: POST는 201, 그 외(DELETE 등)는 200

**Turso 일관성 처리**: 서버리스는 요청마다 다른 인스턴스가 각자 `/tmp` 리플리카를 갖는다. 일반 상태 조회 전·변경 후에는 실패를 삼키는 `db.sync()`를 쓰지만, 일일보고 날짜 생성·업무 정의·상담·특강 설정/동기화는 실패를 호출자에게 전달하는 `db.syncStrict()`를 요청 전후에 쓴다. 상담 외부전송의 선점·단계·확정만은 임베디드 리플리카가 아니라 공유 Turso primary에 직접 기록해 인스턴스 간 원자성을 확보하고, 이후 리플리카를 다시 pull한다. ERP 조회가 긴 특강 동기화는 적용 직전에도 다시 pull해 토글/기준일이 그대로인지 확인한다. Turso가 아니면 같은 로컬 SQLite 연결을 사용한다.

---

## 3. `getState` 응답 형태

`store.getState(role, tid)` (`src/api/store.service.ts`). N+1을 피하려고 task_status·journal_items·daily_reports를 각각 한 번에 로드해 메모리에서 그룹핑한다.

### 공통 필드

| 필드 | 내용 |
|---|---|
| `today`, `todayLabel`, `todayGroup` | 앱 기준 오늘(ISO / `2026년 7월 11일 (토)` / `월수금반`\|`화목토반`\|`null`). 기본은 KST 실제 날짜, `APP_TODAY` 지정 시 고정 |
| `role`, `me`, `leadName` | 아래 참조 |
| `teacherNames` | 일일보고·공용 업무 대상인 일반 강사 이름 배열. 다른 팀은 제외 |
| `tags`, `notices`, `journals` | 태그(+`fixed` 플래그) / 공지 / 날짜별 체크리스트. `journals[].specialPeriod`가 생성 당시 특강 여부를 보존한다 |
| `settings` | `{wtestM, wtestT, specialPeriodEnabled, specialSyncDate, specialSyncMonth, specialSyncAt, specialSyncSummary}`. 마지막 요약은 팀장에게만 반환하고 강사에게는 `null` |

`journals[]` 각 항목은 `{date, label(`7월 11일 (토)`), items, specialPeriod, kind, reports}`이고 `kind`는 today 대비 `'today'|'past'|'future'`다. `reports`는 `{강사명: {submitted, confirmed}}` 형태로 날짜별 실제 현황이 붙고, `confirmed`는 `submitted && confirmed`로 계산해 미제출+confirmed=1인 과거 데이터를 표시상 교정한다.

### 역할별로 달라지는 필드

| 필드 | 팀장(`lead`) | 강사(`teacher`) | 다른 팀(`other`) |
|---|---|---|---|
| `me` | `{tid, name, classes:null, isLead:true, isTeacher}` | `{tid, name, classes, tttId, hasTtt, isLead, isTeacher:true}` | `{tid, name, classes, tttId, hasTtt, isOtherTeam:true, isTeacher:false}` |
| `tasks` | `self_managed`를 제외한 전체 공용 업무 | **본인이 assignee인 공용 업무만** | 본인 `created_by_tid`의 `self_managed` 상담일정만 |
| `tasks[].statuses` | 전 일반 강사 상태 맵 | **본인 항목 하나만** | 본인 항목 하나만 |
| `events` | `owner`가 `'lead'` 또는 `'team'`인 것 | `owner`가 `'team'` 또는 본인 `tid`인 것 | 빈 배열 |
| `teachers` | 전 강사 목록(+`isOtherTeam`, 일반 강사만 제출 상태) | **본인 1건만** | 본인 1건만 |
| `todayReports` | 일반 강사 전원 제출현황 | **`{}`** | **`{}`** |
| `myReport` / `myPastLogs` | `null` / `[]` | 오늘 본인 보고 / 제출 완료 과거 로그 | 항상 `null` / `[]` |

다른 팀 상태는 `teacherNames`, `events`, `notices`, `journals`를 빈 배열로 내리고, `tags`도 개인 상담 표시에 필요한 고정 `상담` 태그만 반환한다.

`teachers[]`에도 외부 ERP 비밀번호는 없고 `tttId` + `hasTtt`만 내려간다.

### `tasks[]` 항목 파생 필드

`buildTask()`가 만들어내는 값:

- `startLabel`/`dueLabel`(`7월 13일 (월)`), `dday`(양수=남음, 0=당일, 음수=지남), `sm/sd/em/ed`(캘린더 렌더용 월·일 숫자)
- `assignees`: `scope === 'all'`이면 현재 전 강사 이름으로 확장
- `specialCounsel`, `specialSourceMonth`: 특강상담 여부와 생성 시 고정한 수강년월. `counsel`과 `specialCounsel`은 동시에 true일 수 없다
- `doneCount` / `total`: 일반 업무는 `status==='done'`인 assignee 수. 상담 업무는 담당 학생 전원이 외부 ERP 전송 완료여야 완료다. 특강상담에서 학생이 없는 강사는 `noTarget:true`로 완료 취급한다
- `counselProg`: 상담 업무일 때 `{강사명: {synced, total, noTarget?}}`. 강사 상태 응답은 본인 진행률만 포함한다

`events[]`에는 `mine` 플래그가 붙는다 — 팀 일정은 팀장이면 true, 개인일정은 소유자 본인일 때 true(삭제/수정 가능 여부 판단용).

---

## 참고 — 환경변수

`LEAD_ID`/`LEAD_PW`/`LEAD_NAME`(초기 팀장 계정), `SEED_MODE`(`clean`|`demo`), `APP_TODAY`(오늘 고정), `APP_SECRET`(외부 ERP 비밀번호 암호화·반 목록 확인 정보 서명 키 — 운영에서 필수, 개발에서 비우면 프로세스마다 임의 키), `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`. 실제 값은 `.env.local` 또는 배포 플랫폼의 환경변수에만 두고 문서·저장소·`NEXT_PUBLIC_*`에 남기지 않는다.
