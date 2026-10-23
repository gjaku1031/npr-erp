/** SQLite DDL. 모든 날짜는 ISO 'YYYY-MM-DD' 로 저장하고 표시 라벨/D-day는 계산한다. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS teachers (
  tid       TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  pw        TEXT NOT NULL DEFAULT '1234',
  classes   TEXT NOT NULL DEFAULT '{"월수금반":[],"화목토반":[],"특강 월수금반":[],"특강 화목토반":[]}',
  ttt_id    TEXT NOT NULL DEFAULT '',   -- 강사 통통통 아이디
  ttt_pw    TEXT NOT NULL DEFAULT '',   -- 강사 통통통 비밀번호(암호화 저장)
  is_lead   INTEGER NOT NULL DEFAULT 0, -- 팀장 권한 부여 여부(강사이면서 팀장). admin은 lead_account(마스터 팀장)
  is_other_team INTEGER NOT NULL DEFAULT 0, -- 다른 팀 전용 화면 사용 권한
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lead_account (
  id        TEXT PRIMARY KEY,
  pw        TEXT NOT NULL,
  name      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  name      TEXT PRIMARY KEY,
  color     TEXT NOT NULL,
  emoji     TEXT NOT NULL DEFAULT '🗂️',
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  descr       TEXT NOT NULL DEFAULT '',
  tag         TEXT NOT NULL DEFAULT '행정',
  start_date  TEXT NOT NULL,
  due_date    TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT '"all"',   -- JSON: "all" | ["이름",...]
  report_req  INTEGER NOT NULL DEFAULT 0,
  attach_req  INTEGER NOT NULL DEFAULT 0,
  mt          INTEGER NOT NULL DEFAULT 0,       -- MT 업무: 강사가 M(월수금)/T(화목토) 완료를 따로 체크
  counsel     INTEGER NOT NULL DEFAULT 0,       -- 전체 상담 업무: 반별 학생 로스터에 상담 작성 후 통통통 전송
  special_counsel INTEGER NOT NULL DEFAULT 0,   -- 특강 상담 업무: 동기화된 특강 로스터 사용
  special_source_month TEXT NOT NULL DEFAULT '', -- 특강상담 생성 당시 수강년월(YYYY-MM) 스냅샷
  special_assignees TEXT NOT NULL DEFAULT '[]', -- 특강상담 생성 당시 담당 강사명 JSON 스냅샷(scope='all'도 고정)
  self_managed INTEGER NOT NULL DEFAULT 0, -- 다른 팀 사용자가 스스로 만든 상담일정
  created_by_tid TEXT NOT NULL DEFAULT '', -- self_managed 상담일정 소유자 tid
  self_source_month TEXT NOT NULL DEFAULT '', -- 상담일정 생성/명단 갱신에 사용한 본인 반 수강년월
  archived    INTEGER NOT NULL DEFAULT 0,
  links       TEXT NOT NULL DEFAULT '[]',       -- JSON [{label,url}]
  atts        TEXT NOT NULL DEFAULT '[]',       -- JSON ["파일명"]
  created_at  TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0
);

-- 강사별 업무 처리 상태
CREATE TABLE IF NOT EXISTS task_status (
  task_id      TEXT NOT NULL,
  teacher      TEXT NOT NULL,               -- 강사 이름
  status       TEXT NOT NULL,               -- 'done' | 'undone' | 'none' (MT: m/t 둘 다 done이면 'done')
  report_text  TEXT NOT NULL DEFAULT '',
  report_files TEXT NOT NULL DEFAULT '[]',  -- JSON
  m_done       INTEGER NOT NULL DEFAULT 0,  -- MT 업무: 월수금(M) 완료
  t_done       INTEGER NOT NULL DEFAULT 0,  -- MT 업무: 화목토(T) 완료
  at           TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (task_id, teacher)
);

-- 개인일정 / 팀 일정 (업무와 같은 엔티티, type 으로 구분)
CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  owner       TEXT NOT NULL,               -- 'lead' | 'team' | 강사 tid
  type        TEXT NOT NULL,               -- 'personal' | 'team_event'
  tag         TEXT NOT NULL,               -- '개인일정' | '일정'
  title       TEXT NOT NULL,
  descr       TEXT NOT NULL DEFAULT '',
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL
);

-- 앱 전역 설정 kv (예: 주간테스트 날짜 wtest_m/wtest_t)
CREATE TABLE IF NOT EXISTS settings (
  k  TEXT PRIMARY KEY,
  v  TEXT NOT NULL DEFAULT ''
);

-- 상담 업무: 반별 학생 로스터 + 상담 드래프트/전송상태.
-- ERP 재동기화는 행을 삭제하지 않고 roster_active만 전환해 과거 상담/전송/부재 이력을 보존한다.
CREATE TABLE IF NOT EXISTS counsel_entries (
  id        TEXT PRIMARY KEY,
  task_id   TEXT NOT NULL,
  teacher   TEXT NOT NULL,               -- 강사 이름
  teacher_tid TEXT NOT NULL DEFAULT '',   -- 로컬 강사 고정 식별자(이름 변경과 동명이인 대비)
  cls       TEXT NOT NULL,               -- 반명
  class_code TEXT NOT NULL DEFAULT '',    -- 통통통 반 코드(재동기화의 안정 식별자)
  scode     TEXT NOT NULL,               -- 통통통 원생 학번(상담쓰기 scode)
  student   TEXT NOT NULL,               -- 원생명
  phone     TEXT NOT NULL DEFAULT '',    -- 어머니 전화(로스터 동기화 시 갱신)
  subject   TEXT NOT NULL DEFAULT '',    -- 상담 주제
  content   TEXT NOT NULL DEFAULT '',    -- 상담 내용(재동기화 시 보존)
  synced    INTEGER NOT NULL DEFAULT 0,  -- 통통통 전송 완료
  synced_at TEXT NOT NULL DEFAULT '',
  done      INTEGER NOT NULL DEFAULT 0,  -- 강사 수동 완료 표시(했음/안했음)
  -- ERP 쓰기는 성공했지만 조회/원격 DB 반영이 늦는 구간에도 재전송하지 않도록
  -- 전송 시도와 증거를 별도 상태로 보존한다. fingerprint는 원문을 노출하지 않는 SHA-256이다.
  delivery_state        TEXT NOT NULL DEFAULT 'idle', -- 'idle' | 'pending' | 'confirmed'
  delivery_stage        TEXT NOT NULL DEFAULT '',     -- '' | 'claimed' | 'posting' | 'confirmed'
  delivery_claim_token  TEXT NOT NULL DEFAULT '',     -- primary claim 소유자 토큰(응답 entry에는 노출하지 않음)
  delivery_fingerprint  TEXT NOT NULL DEFAULT '',
  delivery_date         TEXT NOT NULL DEFAULT '',
  delivery_before_count INTEGER NOT NULL DEFAULT -1,
  delivery_attempted_at TEXT NOT NULL DEFAULT '',
  delivery_message      TEXT NOT NULL DEFAULT '',
  roster_active         INTEGER NOT NULL DEFAULT 1, -- 최신 ERP 스냅샷에 포함된 상담 대상
  roster_source_month   TEXT NOT NULL DEFAULT '',   -- 마지막으로 확인한 수강년월(YYYY-MM)
  roster_seen_at        TEXT NOT NULL DEFAULT '',   -- 최신 스냅샷에서 확인한 시각
  roster_removed_at     TEXT NOT NULL DEFAULT '',   -- 최신 스냅샷에서 이탈로 판정한 시각
  UNIQUE (task_id, teacher, cls, scode)
);

-- 상담 중 전화 부재/문자 안내를 별도 이력으로 보존한다.
-- 한 학생에게 여러 번 연락할 수 있으므로 counsel_entries의 1학생 1행과 분리하며,
-- 각 행은 통통통 비멱등 POST의 선점/확인 상태를 독립적으로 가진다.
CREATE TABLE IF NOT EXISTS counsel_absence_attempts (
  id                    TEXT PRIMARY KEY,
  entry_id              TEXT NOT NULL,
  task_id               TEXT NOT NULL,
  teacher               TEXT NOT NULL,
  cls                   TEXT NOT NULL,
  scode                 TEXT NOT NULL,
  student               TEXT NOT NULL,
  kind                  TEXT NOT NULL DEFAULT '부재/문자',
  content               TEXT NOT NULL DEFAULT '',
  attempted_date        TEXT NOT NULL,
  synced                INTEGER NOT NULL DEFAULT 0,
  synced_at             TEXT NOT NULL DEFAULT '',
  delivery_state        TEXT NOT NULL DEFAULT 'pending',
  delivery_stage        TEXT NOT NULL DEFAULT 'claimed',
  delivery_claim_token  TEXT NOT NULL DEFAULT '',
  delivery_fingerprint  TEXT NOT NULL DEFAULT '',
  delivery_before_count INTEGER NOT NULL DEFAULT -1,
  delivery_attempted_at TEXT NOT NULL DEFAULT '',
  delivery_message      TEXT NOT NULL DEFAULT '',
  created_at            TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_counsel_absence_student
  ON counsel_absence_attempts(task_id, teacher, cls, scode, attempted_date);

-- 송파 본원 특강 반별 월간 캐시. 같은 월 재동기화 시 교체된다.
-- 특강상담 업무의 불변 로스터는 생성 시 counsel_entries로 복사하며, 이 표는 이후 업무 생성용 원본이다.
CREATE TABLE IF NOT EXISTS special_class_roster (
  source_month TEXT NOT NULL,              -- YYYY-MM
  class_code   TEXT NOT NULL,              -- 통통통 반 코드
  class_name   TEXT NOT NULL,
  teacher_tid  TEXT NOT NULL,              -- 로컬 강사 tid(정확히 매칭된 반만 저장)
  teacher_name TEXT NOT NULL,
  day_group    TEXT NOT NULL,              -- 'M' | 'T'
  scode        TEXT NOT NULL,
  student      TEXT NOT NULL,
  mother_phone TEXT NOT NULL DEFAULT '',
  synced_at    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (source_month, class_code, scode)
);
CREATE INDEX IF NOT EXISTS idx_special_roster_teacher
  ON special_class_roster(source_month, teacher_tid, day_group, class_name);

-- 다른 팀 사용자가 본인 통통통 계정으로 동기화한 월별 담당 반/학생 스냅샷.
-- 반과 학생을 분리해 원생이 0명인 반도 표시하고, 새 월 동기화가 과거 상담 이력을 지우지 않게 한다.
CREATE TABLE IF NOT EXISTS other_team_syncs (
  teacher_tid  TEXT NOT NULL,
  source_month TEXT NOT NULL,
  synced_at    TEXT NOT NULL DEFAULT '',
  class_count  INTEGER NOT NULL DEFAULT 0,
  student_count INTEGER NOT NULL DEFAULT 0,
  warnings     TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (teacher_tid, source_month)
);
CREATE INDEX IF NOT EXISTS idx_other_team_syncs_latest
  ON other_team_syncs(teacher_tid, synced_at DESC);

CREATE TABLE IF NOT EXISTS other_team_classes (
  teacher_tid   TEXT NOT NULL,
  source_month  TEXT NOT NULL,
  class_code    TEXT NOT NULL,
  class_name    TEXT NOT NULL,
  top_name      TEXT NOT NULL DEFAULT '',
  middle_name   TEXT NOT NULL DEFAULT '',
  day_group     TEXT NOT NULL DEFAULT '',
  schedule_code TEXT NOT NULL DEFAULT '',
  student_count INTEGER NOT NULL DEFAULT 0,
  synced_at     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (teacher_tid, source_month, class_code)
);
CREATE INDEX IF NOT EXISTS idx_other_team_classes_latest
  ON other_team_classes(teacher_tid, synced_at DESC, class_name);

CREATE TABLE IF NOT EXISTS other_team_students (
  teacher_tid  TEXT NOT NULL,
  source_month TEXT NOT NULL,
  class_code   TEXT NOT NULL,
  scode        TEXT NOT NULL,
  student      TEXT NOT NULL,
  grade        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT '',
  synced_at    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (teacher_tid, source_month, class_code, scode)
);
CREATE INDEX IF NOT EXISTS idx_other_team_students_class
  ON other_team_students(teacher_tid, source_month, class_code, student);

CREATE TABLE IF NOT EXISTS notices (
  id          TEXT PRIMARY KEY,
  text        TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  posted_date TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '팀장 김도현',
  sort        INTEGER NOT NULL DEFAULT 0
);

-- 날짜별 일일보고(체크리스트) 정의
CREATE TABLE IF NOT EXISTS journals (
  date        TEXT PRIMARY KEY,            -- ISO
  created_at  TEXT NOT NULL,
  special_period INTEGER NOT NULL DEFAULT 0 -- 생성 당시 전역 특강기간 설정 스냅샷
);
CREATE TABLE IF NOT EXISTS journal_items (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  text        TEXT NOT NULL,
  required    INTEGER NOT NULL DEFAULT 0,
  sort        INTEGER NOT NULL DEFAULT 0
);

-- 강사의 일일보고 제출물 (강사×날짜 1건)
CREATE TABLE IF NOT EXISTS daily_reports (
  id           TEXT PRIMARY KEY,
  teacher      TEXT NOT NULL,              -- 강사 이름
  date         TEXT NOT NULL,             -- ISO
  status       TEXT NOT NULL DEFAULT 'draft', -- 'draft' | 'submitted'
  confirmed    INTEGER NOT NULL DEFAULT 0,    -- 팀장 확인 완료
  payload      TEXT NOT NULL DEFAULT '{}',    -- JSON 위저드 상태
  submitted_at TEXT,
  UNIQUE (teacher, date)
);

`;
