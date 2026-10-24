import Database from 'libsql';
import * as fs from 'fs';
import * as path from 'path';
import { SCHEMA_SQL } from './schema';
import { seedIfEmpty, bootstrapClean } from './seed';

const TEACHER_CLASS_KEYS = ['월수금반', '화목토반', '특강 월수금반', '특강 화목토반'] as const;
const SPECIAL_ASSIGNEES_MIGRATION_KEY = 'db_migration_special_assignees_v1';
const SYSTEM_COUNSEL_TASKS_MIGRATION_KEY = 'db_migration_system_counsel_tasks_v1';

/** 기존 2그룹/손상된 JSON을 현재 4그룹 형태로 안전하게 올린다. */
function normalizedTeacherClasses(raw: unknown): Record<(typeof TEACHER_CLASS_KEYS)[number], string[]> {
  let parsed: any = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
  return Object.fromEntries(TEACHER_CLASS_KEYS.map((key) => [
    key,
    Array.isArray(parsed[key]) ? parsed[key].filter((v: unknown) => typeof v === 'string') : [],
  ])) as Record<(typeof TEACHER_CLASS_KEYS)[number], string[]>;
}

/**
 * DB 계층 — libSQL(better-sqlite3 호환).
 * - 로컬: 파일 SQLite (data/app.sqlite).
 * - Turso 연결(TURSO_DATABASE_URL 있음): 임베디드 리플리카 + 원격 동기화 → 서버리스에서도 데이터 영속.
 */
export class DbService {
  readonly db: any;
  private readonly counselDeliveryPrimaryDb: any;
  private turso = false;

  constructor() {
    const onServerless = !!process.env.VERCEL;
    const url = process.env.TURSO_DATABASE_URL;
    const token = process.env.TURSO_AUTH_TOKEN;
    const dataDir = onServerless ? '/tmp' : path.join(process.cwd(), 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, 'app.sqlite');

    if (url) {
      // Turso 원격 영속 (임베디드 리플리카). 로컬 파일은 캐시, 원격이 진실.
      this.db = new Database(file, { syncUrl: url, authToken: token } as any);
      // 상담 전송 선점은 여러 Vercel 인스턴스가 공유하는 원격 DB에서 직접 수행해야 한다.
      // 임베디드 리플리카의 로컬 트랜잭션만으로는 서로 다른 인스턴스의 동시 POST를 막을 수 없다.
      this.counselDeliveryPrimaryDb = new Database(url, { authToken: token } as any);
      this.turso = true;
    } else {
      this.db = new Database(file);
      this.counselDeliveryPrimaryDb = this.db;
      try { this.db.pragma('journal_mode = WAL'); } catch { /* Turso/일부 환경 미지원 */ }
    }
    try { this.db.pragma('foreign_keys = ON'); } catch { this.db.exec('PRAGMA foreign_keys = ON'); }
  }

  init() {
    if (this.turso) this.safeSync(); // 콜드스타트: 원격의 기존 데이터/스키마 pull
    this.db.exec(SCHEMA_SQL); // CREATE TABLE IF NOT EXISTS (기존 테이블이면 no-op)
    const migrated = this.migrate();
    const mode = (process.env.SEED_MODE || 'clean').toLowerCase();
    const seeded = mode === 'demo' ? seedIfEmpty(this.db) : bootstrapClean(this.db);
    // 실제 로컬 변경(마이그레이션/부트스트랩)이 있을 때만 push — 이미 부트된 콜드스타트는 pull만(약 1회 왕복 절약)
    if (this.turso && (migrated || seeded)) this.syncStrict();
  }

  /** 변경 후 원격 동기화 (Turso일 때만). */
  sync() { if (this.turso) this.safeSync(); }
  /** 최종 영속이 필수인 변경용 동기화. Turso는 즉시 최대 3회 시도하고 상세 오류는 외부에 노출하지 않는다. */
  syncStrict() {
    if (!this.turso) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { this.db.sync(); return; } catch { /* 즉시 재시도 */ }
    }
    throw new Error('원격 데이터 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  }
  private safeSync() { try { this.db.sync(); } catch { /* 네트워크 일시 오류 무시 */ } }

  /**
   * 상담 외부전송의 선점/증거 상태만 원격 primary에서 처리한다.
   * 일반 쿼리가 실수로 primary를 우회하지 않도록 연결 자체 대신 좁은 콜백 경계만 공개한다.
   */
  withCounselDeliveryPrimary<T>(operation: (primary: any) => T): T {
    return operation(this.counselDeliveryPrimaryDb);
  }

  /**
   * 정규반 전체 교체는 원격 원본에서 guard 확인과 모든 강사 UPDATE를 한 트랜잭션으로 수행한다.
   * 여러 Vercel 인스턴스의 임베디드 리플리카가 서로의 최신 반 배정을 덮지 않게 하는 좁은 경계다.
   */
  withRegularClassSyncPrimary<T>(operation: (primary: any) => T): T {
    return operation(this.counselDeliveryPrimaryDb);
  }

  /**
   * 특강상담 업무와 생성 시점 로스터 스냅샷을 원격 원본의 한 트랜잭션으로 만든다.
   * 범용 쿼리가 primary를 우회하지 않도록 업무 생성에만 쓰는 좁은 경계로 제한한다.
   */
  withTaskDefinitionPrimary<T>(operation: (primary: any) => T): T {
    return operation(this.counselDeliveryPrimaryDb);
  }

  /**
   * 상담 상세는 학생/연락처가 포함된 좁은 권한 경계다. 특강상담 생성 직후 embedded
   * replica pull을 기다리지 않아도 되도록, API가 인증을 끝낸 뒤 원격 원본에서 한 업무와
   * 한 강사의 스냅샷만 읽을 때 사용한다.
   */
  withCounselSnapshotPrimary<T>(operation: (primary: any) => T): T {
    return operation(this.counselDeliveryPrimaryDb);
  }

  /** 상담 로스터의 이력 보존 reconcile/연락처 갱신만 원격 원본에서 원자적으로 처리한다. */
  withCounselRosterPrimary<T>(operation: (primary: any) => T): T {
    return operation(this.counselDeliveryPrimaryDb);
  }

  /** primary의 최신 상담 전송 상태를 임베디드 리플리카에 best-effort로 반영한다. */
  refreshCounselDeliveryReplica() { if (this.turso) this.safeSync(); }

  /** primary 정규반 스냅샷을 현재 임베디드 리플리카로 즉시 반영한다. */
  refreshRegularClassSyncReplica() { if (this.turso) this.safeSync(); }

  /** primary 상담 로스터 갱신을 현재 임베디드 리플리카로 best-effort 반영한다. */
  refreshCounselRosterReplica() { if (this.turso) this.safeSync(); }

  private columnNames(table: string): string[] {
    return (this.db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((column) => column.name);
  }

  /**
   * 서버리스 콜드스타트 두 개가 같은 원격 DB를 동시에 마이그레이션할 수 있다.
   * PRAGMA 확인 뒤 다른 인스턴스가 먼저 ADD COLUMN을 끝냈다면 Turso 스키마를
   * 다시 pull해 실제 컬럼 존재를 확인한 경우에만 성공으로 간주한다.
   */
  private addColumn(table: string, column: string, definition: string): boolean {
    if (this.columnNames(table).includes(column)) return false;
    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column name/i.test(message)) throw error;
      if (this.turso) {
        try { this.db.sync(); } catch { throw error; }
      }
      if (this.columnNames(table).includes(column)) return false;
      throw error;
    }
  }

  /** 기존 DB에 누락 컬럼 추가 (가벼운 마이그레이션). 변경 시 true. */
  private migrate(): boolean {
    let changed = false;
    if (this.addColumn('teachers', 'ttt_id', `TEXT NOT NULL DEFAULT ''`)) changed = true;
    if (this.addColumn('teachers', 'ttt_pw', `TEXT NOT NULL DEFAULT ''`)) changed = true;
    if (this.addColumn('teachers', 'is_lead', 'INTEGER NOT NULL DEFAULT 0')) changed = true;
    if (this.addColumn('teachers', 'is_other_team', 'INTEGER NOT NULL DEFAULT 0')) changed = true;
    // tasks.mt (MT 업무)
    if (this.addColumn('tasks', 'mt', 'INTEGER NOT NULL DEFAULT 0')) changed = true;
    if (this.addColumn('tasks', 'counsel', 'INTEGER NOT NULL DEFAULT 0')) changed = true;
    if (this.addColumn('tasks', 'special_counsel', 'INTEGER NOT NULL DEFAULT 0')) changed = true;
    if (this.addColumn('tasks', 'special_source_month', `TEXT NOT NULL DEFAULT ''`)) changed = true;
    if (this.addColumn('tasks', 'special_assignees', `TEXT NOT NULL DEFAULT '[]'`)) {
      changed = true;
    }
    if (this.addColumn('tasks', 'self_managed', 'INTEGER NOT NULL DEFAULT 0')) changed = true;
    if (this.addColumn('tasks', 'created_by_tid', `TEXT NOT NULL DEFAULT ''`)) changed = true;
    if (this.addColumn('tasks', 'self_source_month', `TEXT NOT NULL DEFAULT ''`)) changed = true;
    // 시스템 상담 태그 도입 전에는 화면 토글이 별도 컬럼을 채웠다. 정확한 시스템 태그가
    // 붙은 기존 업무는 태그를 단일 진실로 backfill해 일일보고 필수 조건으로 남지 않게 한다.
    const systemCounselTasksMigrated = this.db.prepare('SELECT v FROM settings WHERE k=?')
      .get(SYSTEM_COUNSEL_TASKS_MIGRATION_KEY)?.v === '1';
    const taskColumns = new Set(this.columnNames('tasks'));
    const canBackfillSystemCounselTasks = [
      'id', 'tag', 'scope', 'report_req', 'attach_req', 'mt', 'counsel', 'special_counsel',
      'special_source_month', 'special_assignees',
    ].every((column) => taskColumns.has(column));
    if (!systemCounselTasksMigrated && canBackfillSystemCounselTasks) {
      const allTeacherNames = (this.db.prepare('SELECT name FROM teachers WHERE is_other_team=0 ORDER BY name').all() as any[])
        .map((row) => row.name);
      const syncedMonth = String(this.db.prepare('SELECT v FROM settings WHERE k=?').get('special_sync_month')?.v || '');
      const validSyncedMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(syncedMonth) ? syncedMonth : '';
      const tx = this.db.transaction(() => {
        this.db.prepare(
          `UPDATE tasks SET counsel=1,special_counsel=0,report_req=0,attach_req=0,mt=0,
             special_source_month='',special_assignees='[]' WHERE TRIM(tag)='상담'`,
        ).run();
        for (const task of this.db.prepare(
          `SELECT id,scope,special_source_month,special_assignees FROM tasks WHERE TRIM(tag)='특강 상담'`,
        ).all() as any[]) {
          let scope: any = [];
          try { scope = JSON.parse(task.scope); } catch { /* 손상 scope는 빈 담당 목록으로 안전 처리 */ }
          const source = scope === 'all' ? allTeacherNames : (Array.isArray(scope) ? scope : []);
          const assignees = Array.from(new Set(source.filter((name: unknown) => typeof name === 'string' && !!name))) as string[];
          const existingMonth = String(task.special_source_month || '');
          const sourceMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(existingMonth) ? existingMonth : validSyncedMonth;
          this.db.prepare(
            `UPDATE tasks SET counsel=0,special_counsel=1,report_req=0,attach_req=0,mt=0,
               special_source_month=?,special_assignees=? WHERE id=?`,
          ).run(sourceMonth, JSON.stringify(assignees), task.id);
          if (!sourceMonth || !assignees.length) continue;
          const allowed = new Set(assignees);
          const roster = this.db.prepare(
            `SELECT class_code,class_name,teacher_name,scode,student,mother_phone
             FROM special_class_roster WHERE source_month=?`,
          ).all(sourceMonth) as any[];
          const insert = this.db.prepare(
            `INSERT OR IGNORE INTO counsel_entries(id,task_id,teacher,cls,scode,student,phone,content,synced,synced_at)
             VALUES(?,?,?,?,?,?,?,?,0,'')`,
          );
          for (const row of roster) {
            if (!allowed.has(row.teacher_name)) continue;
            insert.run(
              `migrated-${task.id}-${row.class_code}-${row.scode}`,
              task.id, row.teacher_name, row.class_name, row.scode, row.student, row.mother_phone || '', '',
            );
          }
        }
        this.db.prepare(`INSERT INTO settings(k,v) VALUES(?, '1') ON CONFLICT(k) DO UPDATE SET v='1'`)
          .run(SYSTEM_COUNSEL_TASKS_MIGRATION_KEY);
      });
      tx();
      changed = true;
    }
    // 컬럼을 추가한 인스턴스가 backfill 전에 종료되어도 다음 콜드스타트가 이어서 수행한다.
    // 완료 마커 전에는 같은 값을 다시 계산해도 결과가 같고, 완료 후에는 실제 빈 스냅샷을 건드리지 않는다.
    const specialAssigneesMigrated = this.db.prepare('SELECT v FROM settings WHERE k=?')
      .get(SPECIAL_ASSIGNEES_MIGRATION_KEY)?.v === '1';
    if (!specialAssigneesMigrated) {
      const allTeacherNames = (this.db.prepare('SELECT name FROM teachers ORDER BY name').all() as any[]).map((row) => row.name);
      for (const task of this.db.prepare(`SELECT id,scope FROM tasks WHERE special_counsel=1 AND special_assignees='[]'`).all() as any[]) {
        let scope: any = [];
        try { scope = JSON.parse(task.scope); } catch { /* 손상 scope는 빈 담당 목록으로 안전 처리 */ }
        const source = scope === 'all' ? allTeacherNames : (Array.isArray(scope) ? scope : []);
        const assignees = Array.from(new Set(source.filter((name: unknown) => typeof name === 'string' && !!name)));
        this.db.prepare('UPDATE tasks SET special_assignees=? WHERE id=?').run(JSON.stringify(assignees), task.id);
      }
      this.db.prepare(`INSERT INTO settings(k,v) VALUES(?, '1') ON CONFLICT(k) DO UPDATE SET v='1'`)
        .run(SPECIAL_ASSIGNEES_MIGRATION_KEY);
      changed = true;
    }
    // task_status.m_done / t_done (MT 부분완료)
    if (this.addColumn('task_status', 'm_done', 'INTEGER NOT NULL DEFAULT 0')) changed = true;
    if (this.addColumn('task_status', 't_done', 'INTEGER NOT NULL DEFAULT 0')) changed = true;
    // counsel_entries.subject / done (상담 주제 + 강사 수동 완료)
    if (this.columnNames('counsel_entries').length) {
      if (this.addColumn('counsel_entries', 'subject', `TEXT NOT NULL DEFAULT ''`)) changed = true;
      if (this.addColumn('counsel_entries', 'done', 'INTEGER NOT NULL DEFAULT 0')) changed = true;
      if (this.addColumn('counsel_entries', 'teacher_tid', `TEXT NOT NULL DEFAULT ''`)) changed = true;
      if (this.addColumn('counsel_entries', 'class_code', `TEXT NOT NULL DEFAULT ''`)) changed = true;
      if (this.addColumn('counsel_entries', 'roster_active', 'INTEGER NOT NULL DEFAULT 1')) changed = true;
      if (this.addColumn('counsel_entries', 'roster_source_month', `TEXT NOT NULL DEFAULT ''`)) changed = true;
      if (this.addColumn('counsel_entries', 'roster_seen_at', `TEXT NOT NULL DEFAULT ''`)) changed = true;
      if (this.addColumn('counsel_entries', 'roster_removed_at', `TEXT NOT NULL DEFAULT ''`)) changed = true;
      if (this.addColumn('counsel_entries', 'delivery_state', `TEXT NOT NULL DEFAULT 'idle'`)) changed = true;
      if (this.addColumn('counsel_entries', 'delivery_stage', `TEXT NOT NULL DEFAULT ''`)) changed = true;
      if (this.addColumn('counsel_entries', 'delivery_claim_token', `TEXT NOT NULL DEFAULT ''`)) changed = true;
      if (this.addColumn('counsel_entries', 'delivery_fingerprint', `TEXT NOT NULL DEFAULT ''`)) changed = true;
      if (this.addColumn('counsel_entries', 'delivery_date', `TEXT NOT NULL DEFAULT ''`)) changed = true;
      if (this.addColumn('counsel_entries', 'delivery_before_count', 'INTEGER NOT NULL DEFAULT -1')) changed = true;
      if (this.addColumn('counsel_entries', 'delivery_attempted_at', `TEXT NOT NULL DEFAULT ''`)) changed = true;
      if (this.addColumn('counsel_entries', 'delivery_message', `TEXT NOT NULL DEFAULT ''`)) changed = true;
      // 이전 버전에서 이미 전송 완료된 행도 새 상태 모델에서는 confirmed로 읽힌다.
      // fingerprint/date 증거가 없으므로 값은 만들지 않고, 이후 새 전송부터 완전한 증거를 저장한다.
      const legacyConfirmed = this.db.prepare(
        `SELECT COUNT(*) count FROM counsel_entries WHERE synced=1 AND delivery_state='idle'`,
      ).get()?.count || 0;
      if (legacyConfirmed) {
        this.db.prepare(
          `UPDATE counsel_entries SET delivery_state='confirmed' WHERE synced=1 AND delivery_state='idle'`,
        ).run();
        changed = true;
      }
      // stage 도입 전 pending은 이미 ERP POST가 실행됐을 가능성을 배제할 수 없으므로
      // 안전하게 posting으로 올린다. claimed는 새 코드가 primary에 기록한 시도에만 부여한다.
      const confirmedStage = this.db.prepare(
        `UPDATE counsel_entries SET delivery_stage='confirmed'
         WHERE delivery_state='confirmed' AND delivery_stage=''`,
      ).run();
      if (confirmedStage.changes) changed = true;
      const pendingStage = this.db.prepare(
        `UPDATE counsel_entries SET delivery_stage='posting'
         WHERE delivery_state='pending' AND delivery_stage=''`,
      ).run();
      if (pendingStage.changes) changed = true;
      // claim token 도입 전 claimed 행에는 소유자를 증명할 방법이 없다. 이미 POST됐을 수 있는
      // 보수적 상태(posting)로 승격해 새 인스턴스가 이를 회수·재전송하지 못하게 한다.
      const ownerlessClaim = this.db.prepare(
        `UPDATE counsel_entries SET delivery_stage='posting'
         WHERE delivery_state='pending' AND delivery_stage='claimed' AND delivery_claim_token=''`,
      ).run();
      if (ownerlessClaim.changes) changed = true;

      // 이름이 정확히 하나의 등록 강사와 일치하는 레거시 행만 tid를 채운다. 동명이인은 빈 값으로 남겨
      // 다음 명시적 강사 로스터 동기화가 안전하게 소유자를 확정하게 한다.
      const teacherTidBackfill = this.db.prepare(
        `UPDATE counsel_entries
         SET teacher_tid=(SELECT MIN(tid) FROM teachers WHERE name=counsel_entries.teacher)
         WHERE teacher_tid=''
           AND (SELECT COUNT(*) FROM teachers WHERE name=counsel_entries.teacher)=1`,
      ).run();
      if (teacherTidBackfill.changes) changed = true;
      const specialMonthBackfill = this.db.prepare(
        `UPDATE counsel_entries
         SET roster_source_month=coalesce((SELECT special_source_month FROM tasks WHERE tasks.id=counsel_entries.task_id),'')
         WHERE roster_source_month=''
           AND EXISTS(SELECT 1 FROM tasks WHERE tasks.id=counsel_entries.task_id AND tasks.special_counsel=1)`,
      ).run();
      if (specialMonthBackfill.changes) changed = true;

      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_counsel_entries_active_teacher
           ON counsel_entries(task_id,teacher_tid,roster_active,cls,student);
         CREATE INDEX IF NOT EXISTS idx_counsel_entries_class_student
           ON counsel_entries(task_id,teacher_tid,class_code,scode);`,
      );
    }
    // journals.special_period (생성 당시 전역 토글 스냅샷)
    if (this.addColumn('journals', 'special_period', 'INTEGER NOT NULL DEFAULT 0')) changed = true;

    // 공통 반 관리 도입 전 다른 팀 전용 캐시에는 분류 정보가 없었다. 새 선택부터
    // 통통통의 최상/중간 분류를 보존해 특강기간 노출을 반명 추측 없이 결정한다.
    if (this.columnNames('other_team_classes').length) {
      if (this.addColumn('other_team_classes', 'top_name', `TEXT NOT NULL DEFAULT ''`)) changed = true;
      if (this.addColumn('other_team_classes', 'middle_name', `TEXT NOT NULL DEFAULT ''`)) changed = true;
    }

    // 기존 강사 JSON은 정규반 2키만 있으므로 읽기 전에 특강 2키를 추가한다.
    for (const row of this.db.prepare('SELECT tid,classes FROM teachers').all() as any[]) {
      const normalized = JSON.stringify(normalizedTeacherClasses(row.classes));
      if (normalized !== row.classes) {
        this.db.prepare('UPDATE teachers SET classes=? WHERE tid=?').run(normalized, row.tid);
        changed = true;
      }
    }
    return changed;
  }

  // 편의 래퍼 (libSQL의 _metadata 필드 제거)
  all<T = any>(sql: string, ...params: any[]): T[] {
    const rows = this.db.prepare(sql).all(...params) as any[];
    for (const r of rows) if (r && r._metadata) delete r._metadata;
    return rows as T[];
  }
  get<T = any>(sql: string, ...params: any[]): T | undefined {
    const r = this.db.prepare(sql).get(...params) as any;
    if (r && r._metadata) delete r._metadata;
    return r as T | undefined;
  }
  run(sql: string, ...params: any[]) {
    return this.db.prepare(sql).run(...params);
  }
}
