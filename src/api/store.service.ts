import { createHash, randomInt, randomUUID } from 'crypto';
import { DbService } from '../db/db.service';
import { config, koDate, koDateFull, ddayFrom, groupOf } from '../config';
import { encrypt, decrypt } from '../ttt/crypto';
import { HttpError } from '../http-error';
import { hashPassword, verifyPassword } from '../auth/password';

type Role = 'lead' | 'teacher' | 'other';
// 삭제·이름변경 불가 시스템 태그. 색상/이모지만 관리자가 바꿀 수 있다.
export const SYSTEM_COUNSEL_TAGS = {
  regular: '상담',
  special: '특강 상담',
} as const;
const FIXED_TAG_DEFINITIONS = [
  { name: SYSTEM_COUNSEL_TAGS.regular, color: '블루', emoji: '💬' },
  { name: SYSTEM_COUNSEL_TAGS.special, color: '올리브', emoji: '✦' },
] as const;
const FIXED_TAGS: readonly string[] = FIXED_TAG_DEFINITIONS.map((tag) => tag.name);
export const REGULAR_CLASS_GROUPS = ['월수금반', '화목토반'] as const;
export const SPECIAL_CLASS_GROUPS = ['특강 월수금반', '특강 화목토반'] as const;
export const TEACHER_CLASS_GROUPS = [...REGULAR_CLASS_GROUPS, ...SPECIAL_CLASS_GROUPS] as const;
export type TeacherClassGroup = (typeof TEACHER_CLASS_GROUPS)[number];
export type SpecialDayGroup = 'M' | 'T';

export interface SpecialRosterStudentInput {
  scode: string;
  student: string;
  motherPhone?: string;
}

/** 통통통에서 파싱한 반 한 개. 강사 매칭과 원자적 저장은 StoreService가 담당한다. */
export interface SpecialClassSnapshotInput {
  classCode: string;
  className: string;
  teacherName: string;
  dayGroup: SpecialDayGroup | string;
  scheduleLabel?: string;
  students: SpecialRosterStudentInput[];
}

export interface SpecialSyncApplyInput {
  targetDate: string;
  sourceMonth: string;
  classes: SpecialClassSnapshotInput[];
  syncedAt?: string;
  unmatchedTeachers?: string[];
  unmatchedClasses?: string[];
  unsupportedClasses?: string[];
}

export interface SpecialSyncResult {
  targetDate: string;
  sourceMonth: string;
  syncedAt: string;
  matchedTeacherCount: number;
  classCount: number;
  studentCount: number;
  unmatchedTeachers: string[];
  unmatchedClasses: string[];
  unsupportedClasses: string[];
}

/** 통통통에서 파싱한 일반 반 한 개. 학생 로스터는 일반 반 배정 동기화에 필요하지 않다. */
export interface RegularClassSnapshotInput {
  classCode: string;
  className: string;
  /** 강사별 통통통 계정으로 확정한 로컬 강사 id. 이름 중복보다 우선한다. */
  teacherTid?: string;
  teacherName: string;
  dayGroup: SpecialDayGroup | string;
  scheduleLabel?: string;
}

export interface RegularSyncApplyInput {
  targetDate: string;
  sourceMonth: string;
  syncMode?: 'routine' | 'quarter-start';
  previousSourceMonth?: string;
  addedClassCount?: number;
  removedClassCount?: number;
  changedTeacherCount?: number;
  classes: RegularClassSnapshotInput[];
  syncedAt?: string;
  excludedExtensionClasses?: string[];
  unmatchedTeachers?: string[];
  unmatchedClasses?: string[];
  unsupportedClasses?: string[];
  ambiguousClasses?: string[];
  retainedByCurrentOwner?: string[];
  uniquelyClaimedClassCount?: number;
  registeredTeacherCount?: number;
  connectedTeacherCount?: number;
  listedClassCount?: number;
  listedEnrollmentCount?: number;
  searchedMonths?: string[];
}

export interface RegularSyncResult {
  applied: true;
  canApply: true;
  targetDate: string;
  sourceMonth: string;
  syncMode: 'routine' | 'quarter-start';
  previousSourceMonth: string;
  addedClassCount: number;
  removedClassCount: number;
  changedTeacherCount: number;
  syncedAt: string;
  matchedTeacherCount: number;
  classCount: number;
  excludedExtensionClasses: string[];
  unmatchedTeachers: string[];
  unmatchedClasses: string[];
  unsupportedClasses: string[];
  ambiguousClasses: string[];
  retainedByCurrentOwner: string[];
  uniquelyClaimedClassCount: number;
  registeredTeacherCount: number;
  connectedTeacherCount: number;
  listedClassCount: number;
  listedEnrollmentCount: number;
  searchedMonths: string[];
  unclaimedClasses: string[];
  accountFailures: string[];
}

export interface TeacherRosterStudentInput {
  scode: string;
  student: string;
  grade?: string;
  status?: string;
}

export interface TeacherRosterClassInput {
  classCode: string;
  className: string;
  topName?: string;
  middleName?: string;
  dayGroup?: string;
  scheduleCode?: string;
  students: TeacherRosterStudentInput[];
}

export interface TeacherRosterApplyInput {
  teacherTid: string;
  sourceMonth: string;
  syncedAt?: string;
  classes: TeacherRosterClassInput[];
  warnings?: string[];
  /** 후보를 연 뒤 다른 화면에서 선택이 바뀌었는지 확인하는 CAS 토큰. */
  expectedRevision?: string;
}

/** 이전 다른 팀 전용 호출부와 저장 데이터의 호환 별칭. */
export type OtherTeamRosterStudentInput = TeacherRosterStudentInput;
export type OtherTeamRosterClassInput = TeacherRosterClassInput;
export type OtherTeamRosterApplyInput = TeacherRosterApplyInput;

export type CounselDeliveryState = 'idle' | 'pending' | 'confirmed';
export type CounselDeliveryStage = '' | 'claimed' | 'posting' | 'confirmed';
type CounselProgress = {
  synced: number;
  total: number;
  absenceCount: number;
  absencePendingCount: number;
};

export interface CounselRosterSnapshotStudentInput {
  scode: string;
  student: string;
}

export interface CounselRosterSnapshotClassInput {
  classCode: string;
  className: string;
  students: CounselRosterSnapshotStudentInput[];
}

export interface CounselRosterReconcileInput {
  taskId: string;
  teacher: string;
  teacherTid: string;
  kind: 'special' | 'regular';
  sourceMonth: string;
  classes: CounselRosterSnapshotClassInput[];
  syncedAt: string;
  /** 서버가 파괴적 정규 명단을 ERP에서 2회 동일 확인한 경우에만 채우는 membership 서명. */
  confirmedRemovalSignature?: string;
}

export interface CounselRosterMembership {
  classCode: string;
  className?: string;
  scode: string;
}

export function counselRosterMembershipSignature(rows: CounselRosterMembership[]): string {
  const unique = new Map<string, [string, string]>();
  for (const raw of rows || []) {
    const classCode = String(raw?.classCode || '').trim();
    const scode = String(raw?.scode || '').trim();
    if (!scode) throw new HttpError(409, '기존 상담 학생 코드를 확인할 수 없어 명단을 변경하지 않았습니다.');
    const tuple: [string, string] = [classCode, scode];
    unique.set(JSON.stringify(tuple), tuple);
  }
  return JSON.stringify([...unique.values()].sort((left, right) =>
    left[0].localeCompare(right[0]) || left[1].localeCompare(right[1])));
}

export interface CounselRosterContactInput {
  classCode: string;
  scode: string;
  motherPhone: string;
  /** false는 상세 ERP 조회 실패를 뜻한다. 이때 기존 번호는 절대 변경하지 않는다. */
  success: boolean;
}

export interface CounselRosterContactsUpdateInput {
  taskId: string;
  teacher: string;
  teacherTid: string;
  kind: 'special' | 'regular';
  sourceMonth: string;
  contacts: CounselRosterContactInput[];
  syncedAt?: string;
}

/** 오래된 화면이 보낸 entry id를 현재 로스터의 유일 자연키로 안전하게 재해결할 때 사용한다. */
export interface CounselEntryNaturalKey {
  taskId: string;
  teacher: string;
  cls: string;
  scode: string;
}

export interface CounselDeliveryDraft {
  subject: string;
  content: string;
  date: string;
  attemptedAt?: string;
}

export interface CounselAbsenceDraft {
  content: string;
  date: string;
  requestId: string;
  attemptedAt?: string;
}

export type CounselDeliveryBeginAction = 'send' | 'pending' | 'confirmed';
export const COUNSEL_DELIVERY_CLAIM_LEASE_MS = 3 * 60 * 1000;

const J = (v: any) => JSON.stringify(v);
const P = (s: any, d: any = null) => {
  try { return JSON.parse(s); } catch { return d; }
};
const uid = (p = '') => p + randomUUID().slice(0, 8);
const uniqueStrings = (values: unknown): string[] => Array.from(new Set(
  (Array.isArray(values) ? values : []).filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean),
));
const uniqueNames = (values: unknown): string[] => Array.from(new Set(
  (Array.isArray(values) ? values : []).filter((v): v is string => typeof v === 'string' && !!v),
));

/** 상담 원문/학생 식별자를 저장하거나 노출하지 않는 재전송 방지용 지문. */
export function counselDeliveryFingerprint(input: { subject: string; content: string; date: string }): string {
  const normalized = [
    String(input.date || '').trim(),
    String(input.subject || '').trim(),
    String(input.content || '').trim(),
  ];
  return createHash('sha256')
    .update('npr-counsel-delivery-v1\n')
    .update(JSON.stringify(normalized))
    .digest('hex');
}
export const normalizeTeacherClasses = (raw: unknown): Record<TeacherClassGroup, string[]> => {
  const parsed = typeof raw === 'string' ? P(raw, {}) : (raw && typeof raw === 'object' ? raw : {});
  return Object.fromEntries(TEACHER_CLASS_GROUPS.map((key) => [key, uniqueStrings(Array.isArray((parsed as any)?.[key]) ? (parsed as any)[key] : [])])) as Record<TeacherClassGroup, string[]>;
};

const isIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const isSourceMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const SPECIAL_SETTING_KEYS = {
  enabled: 'special_period_enabled',
  targetDate: 'special_sync_date',
  sourceMonth: 'special_sync_month',
  syncedAt: 'special_sync_at',
  summary: 'special_sync_summary',
} as const;
const REGULAR_SETTING_KEYS = {
  targetDate: 'regular_sync_date',
  sourceMonth: 'regular_sync_month',
  syncedAt: 'regular_sync_at',
  summary: 'regular_sync_summary',
} as const;
const TEACHER_MUTATION_LEASE_KEY = '_teacher_class_mutation_lease';
const TEACHER_MUTATION_LEASE_MS = 3 * 60 * 1000;
// SQLite/Turso 변수 한도보다 충분히 낮게 유지해 동적 VALUES 절을 예측 가능한 크기로 제한한다.
const MAX_SPECIAL_COUNSEL_ASSIGNEES = 200;
const MAX_JOURNAL_ITEM_TEXT_LENGTH = 300;
const MAX_COUNSEL_ROSTER_CLASSES = 500;
const MAX_COUNSEL_ROSTER_STUDENTS = 5000;

export class StoreService {
  constructor(private readonly db: DbService) {}
  private d() { return this.db.db; }
  private primaryGet<T = any>(primary: any, sql: string, ...params: any[]): T | undefined {
    const row = primary.prepare(sql).get(...params) as any;
    if (row && row._metadata) delete row._metadata;
    return row as T | undefined;
  }
  private connectionAll<T = any>(connection: any, sql: string, ...params: any[]): T[] {
    const rows = connection.prepare(sql).all(...params) as any[];
    for (const row of rows) if (row && row._metadata) delete row._metadata;
    return rows as T[];
  }
  private withCounselDeliveryPrimary<T>(operation: (primary: any) => T, refreshReplica = false): T {
    const result = this.db.withCounselDeliveryPrimary(operation);
    if (refreshReplica) this.db.refreshCounselDeliveryReplica();
    return result;
  }
  private regularSyncRows(connection: any): any[] {
    const rows = connection.prepare(
      'SELECT tid,name,classes,ttt_id,ttt_pw FROM teachers WHERE is_other_team=0 ORDER BY sort,name,tid',
    ).all() as any[];
    for (const row of rows) if (row && row._metadata) delete row._metadata;
    return rows;
  }
  private regularSyncGuardForRows(rows: any[]): string {
    return createHash('sha256').update(JSON.stringify(rows.map((row) => ({
      tid: String(row.tid || ''),
      name: String(row.name || ''),
      classes: String(row.classes || ''),
      tttId: String(row.ttt_id || ''),
      // 암호문 변경도 감지하되 API 메모리나 응답에 복호화 비밀번호를 guard로 남기지 않는다.
      tttPasswordCiphertext: String(row.ttt_pw || ''),
    })))).digest('hex');
  }

  /** 긴 ERP 읽기 전후 원격 원본 상태를 비교하는 비가역 지문. 자격증명·반명 원문은 반환하지 않는다. */
  getRegularClassSyncGuard(): string {
    return this.regularSyncGuardForRows(this.regularSyncRows(this.d()));
  }

  /**
   * teachers 행/반 JSON/ERP 자격증명을 read-modify-write하는 API끼리 공유하는 원격 primary lease.
   * 정규·특강 동기화와 강사·ERP 자격증명 변경이 서로의 stale JSON을 덮지 않게 요청 전체를 직렬화한다.
   */
  acquireTeacherClassMutationLease(purpose: string, now = Date.now()): string {
    const token = randomUUID();
    const value = J({ token, purpose: String(purpose || 'teacher-mutation'), expiresAt: now + TEACHER_MUTATION_LEASE_MS });
    this.db.withRegularClassSyncPrimary((primary) => {
      const tx = primary.transaction(() => {
        const row = primary.prepare('SELECT v FROM settings WHERE k=?').get(TEACHER_MUTATION_LEASE_KEY) as any;
        const current = P(row?.v, null);
        if (current?.token && Number(current.expiresAt) > now) {
          throw new HttpError(409, '다른 반 또는 강사 계정 변경 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
        }
        primary.prepare('INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)').run(TEACHER_MUTATION_LEASE_KEY, value);
      });
      tx();
    });
    return token;
  }

  releaseTeacherClassMutationLease(token: string): void {
    if (!token) return;
    this.db.withRegularClassSyncPrimary((primary) => {
      const tx = primary.transaction(() => {
        const row = primary.prepare('SELECT v FROM settings WHERE k=?').get(TEACHER_MUTATION_LEASE_KEY) as any;
        const current = P(row?.v, null);
        if (current?.token === token) {
          primary.prepare('DELETE FROM settings WHERE k=? AND v=?').run(TEACHER_MUTATION_LEASE_KEY, row.v);
        }
      });
      tx();
    });
  }

  // ────────────────────────── 인증 ──────────────────────────
  login(id: string, pw: string): { role: Role; tid: string; name: string; canLead: boolean; isTeacher: boolean; canOtherTeam: boolean; accountKind: 'lead' | 'teacher' } {
    const normalizedId = String(id || '').trim();
    const lead = this.db.get<any>('SELECT * FROM lead_account WHERE id=?', normalizedId);
    if (lead) {
      this.assertPassword(lead.pw, pw, (hash) => this.db.run('UPDATE lead_account SET pw=? WHERE id=?', hash, lead.id));
      // 마스터 팀장(admin): 팀장 권한만, 강사 일일보고는 없음
      return { role: 'lead', tid: lead.id, name: lead.name, canLead: true, isTeacher: false, canOtherTeam: false, accountKind: 'lead' };
    }
    const t = this.db.get<any>('SELECT * FROM teachers WHERE tid=?', normalizedId);
    if (!t) throw new HttpError(400,'등록된 계정을 찾을 수 없습니다.');
    this.assertPassword(t.pw, pw, (hash) => this.db.run('UPDATE teachers SET pw=? WHERE tid=?', hash, t.tid));
    // 다른 팀 권한은 일일보고 대상에서 제외되는 편의 기능 전용 역할이다.
    // 팀장 권한도 함께 있으면 관리 화면을 우선 시작하고, 역할 전환으로 다른 팀 화면을 열 수 있다.
    const canLead = !!t.is_lead;
    const canOtherTeam = !!t.is_other_team;
    return {
      role: canLead ? 'lead' : canOtherTeam ? 'other' : 'teacher',
      tid: t.tid,
      name: t.name,
      canLead,
      isTeacher: !canOtherTeam,
      canOtherTeam,
      accountKind: 'teacher',
    };
  }

  /** 비밀번호 확인. 저장된 해시의 강도 매개변수가 지금과 다르면 맞은 비밀번호로 그 자리에서 다시 해시해 저장한다. */
  private assertPassword(stored: string, pw: string, rehash: (hash: string) => void) {
    if (!pw) throw new HttpError(400,'비밀번호를 입력해 주세요.');
    const result = verifyPassword(stored, pw);
    if (!result.ok) throw new HttpError(400,'비밀번호가 올바르지 않습니다.');
    if (result.needsRehash) rehash(hashPassword(pw));
  }

  /** 세션 쿠키의 계정을 현재 DB 권한으로 다시 읽는다. 계정이 없으면 null. */
  getSessionAccount(kind: 'lead' | 'teacher', tid: string): { tid: string; canLead: boolean; isTeacher: boolean; canOtherTeam: boolean } | null {
    if (kind === 'lead') {
      const lead = this.db.get<any>('SELECT id FROM lead_account WHERE id=?', tid);
      return lead ? { tid: lead.id, canLead: true, isTeacher: false, canOtherTeam: false } : null;
    }
    const t = this.db.get<any>('SELECT tid,is_lead,is_other_team FROM teachers WHERE tid=?', tid);
    if (!t) return null;
    return { tid: t.tid, canLead: !!t.is_lead, isTeacher: !t.is_other_team, canOtherTeam: !!t.is_other_team };
  }

  /** 팀장 권한 부여/해제 (강사 → 팀장) */
  setTeacherLead(tid: string, isLead: boolean) {
    const t = this.teacherByTid(tid);
    if (!t) throw new HttpError(400, '강사를 찾을 수 없습니다.');
    this.db.run('UPDATE teachers SET is_lead=? WHERE tid=?', isLead ? 1 : 0, tid);
  }

  /** 다른 팀 편의 기능 권한 부여/해제. 강사 명단에는 유지하되 일일보고 대상에서는 제외한다. */
  setTeacherOtherTeam(tid: string, isOtherTeam: boolean) {
    const t = this.teacherByTid(tid);
    if (!t) throw new HttpError(400, '강사를 찾을 수 없습니다.');
    this.db.run('UPDATE teachers SET is_other_team=? WHERE tid=?', isOtherTeam ? 1 : 0, tid);
  }

  private teacherByTid(tid: string) {
    return this.db.get<any>('SELECT * FROM teachers WHERE tid=?', tid);
  }
  /** API에서 teacher 역할 요청을 로그인 tid의 실제 강사명으로 고정할 때 사용한다. */
  resolveTeacherName(tid: string): string | null {
    return this.teacherByTid(tid)?.name || null;
  }
  isOtherTeamTeacher(tid: string): boolean {
    return !!this.teacherByTid(tid)?.is_other_team;
  }
  isRegularTeacher(tid: string): boolean {
    const teacher = this.teacherByTid(tid);
    return !!teacher && !teacher.is_other_team;
  }
  isOwnedOtherTeamCounselTask(taskId: string, tid: string): boolean {
    const normalizedTaskId = String(taskId || '').trim();
    const normalizedTid = String(tid || '').trim();
    return this.db.withCounselSnapshotPrimary((primary) => {
      const task = this.primaryGet<any>(
        primary,
        `SELECT task.self_managed,task.created_by_tid
         FROM tasks task
         JOIN teachers teacher ON teacher.tid=task.created_by_tid AND teacher.is_other_team=1
         WHERE task.id=?`,
        normalizedTaskId,
      );
      return !!task?.self_managed && task.created_by_tid === normalizedTid;
    });
  }
  isOtherTeamRosterClass(tid: string, className: string): boolean {
    const normalizedTid = String(tid || '').trim();
    const normalizedClass = String(className || '').trim();
    if (!normalizedTid || !normalizedClass) return false;
    return this.db.withCounselSnapshotPrimary((primary) => {
      const teacher = this.primaryGet<any>(primary, 'SELECT is_other_team FROM teachers WHERE tid=?', normalizedTid);
      if (!teacher?.is_other_team) return false;
      return !!this.primaryGet<any>(
        primary,
        `SELECT 1 FROM other_team_classes
         WHERE teacher_tid=? AND class_name=? AND source_month=(
           SELECT source_month FROM other_team_syncs
           WHERE teacher_tid=? ORDER BY synced_at DESC,source_month DESC LIMIT 1
         ) LIMIT 1`,
        normalizedTid, normalizedClass, normalizedTid,
      );
    });
  }

  /** 일반/다른 팀 공통: 현재 직접 선택한 반인지 반 코드 스냅샷으로 확인한다. */
  isTeacherRosterClass(tid: string, className: string): boolean {
    const normalizedTid = String(tid || '').trim();
    const normalizedClass = String(className || '').trim();
    if (!normalizedTid || !normalizedClass) return false;
    return this.db.withCounselSnapshotPrimary((primary) => {
      if (!this.primaryGet<any>(primary, 'SELECT 1 FROM teachers WHERE tid=?', normalizedTid)) return false;
      return !!this.primaryGet<any>(
        primary,
        `SELECT 1 FROM other_team_classes
         WHERE teacher_tid=? AND class_name=? AND source_month=(
           SELECT source_month FROM other_team_syncs
           WHERE teacher_tid=? ORDER BY synced_at DESC,source_month DESC LIMIT 1
         ) LIMIT 1`,
        normalizedTid, normalizedClass, normalizedTid,
      );
    });
  }

  hasTeacherRosterSelection(tid: string): boolean {
    const normalizedTid = String(tid || '').trim();
    if (!normalizedTid) return false;
    return this.db.withCounselSnapshotPrimary((primary) => !!this.primaryGet<any>(
      primary,
      'SELECT 1 FROM other_team_syncs WHERE teacher_tid=? LIMIT 1',
      normalizedTid,
    ));
  }
  private teacherNames(): string[] {
    return this.db.all<any>('SELECT name FROM teachers WHERE is_other_team=0 ORDER BY name').map((r) => r.name);
  }

  // ────────────────────────── 파생 ──────────────────────────
  private taskAssignees(scope: any): string[] {
    return scope === 'all' ? this.teacherNames() : uniqueNames(scope);
  }

  private taskAssigneesOn(connection: any, scope: any): string[] {
    return scope === 'all'
      ? this.connectionAll<any>(connection, 'SELECT name FROM teachers WHERE is_other_team=0 ORDER BY name').map((row) => row.name)
      : uniqueNames(scope);
  }

  /** 특강 로스터 VALUES 절을 만들기 전에 담당자가 현재 등록된 강사인지와 안전한 상한을 확인한다. */
  private validatedSpecialAssigneesOn(connection: any, scope: any): string[] {
    const registered = uniqueNames(this.connectionAll<any>(connection, 'SELECT name FROM teachers WHERE is_other_team=0 ORDER BY name')
      .map((row) => String(row.name || ''))
      .filter(Boolean));
    const assignees = scope === 'all' ? registered : uniqueNames(scope);
    if (assignees.length > MAX_SPECIAL_COUNSEL_ASSIGNEES) {
      throw new HttpError(400, `특강 상담 담당 강사는 최대 ${MAX_SPECIAL_COUNSEL_ASSIGNEES}명까지 선택할 수 있습니다.`);
    }
    const registeredSet = new Set(registered);
    if (assignees.some((name) => !registeredSet.has(name))) {
      throw new HttpError(400, '등록되지 않은 강사가 특강 상담 담당자에 포함되어 있습니다. 강사 목록을 새로고침해 주세요.');
    }
    return assignees;
  }

  private normalizedSpecialAssigneePicks(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((name) => typeof name !== 'string' || !name.trim())) {
      throw new HttpError(400, '특강 상담 담당 강사 목록을 확인해 주세요.');
    }
    if (value.length > MAX_SPECIAL_COUNSEL_ASSIGNEES) {
      throw new HttpError(400, `특강 상담 담당 강사는 최대 ${MAX_SPECIAL_COUNSEL_ASSIGNEES}명까지 선택할 수 있습니다.`);
    }
    return uniqueNames(value);
  }

  /** 공용 업무는 일일보고 대상인 일반 강사에게만 배정한다. */
  private validatedTaskAssigneesOn(connection: any, value: unknown): string[] {
    if (!Array.isArray(value) || value.some((name) => typeof name !== 'string' || !name.trim())) {
      throw new HttpError(400, '업무 담당 강사 목록을 확인해 주세요.');
    }
    const assignees = uniqueNames(value);
    const registered = new Set(this.connectionAll<any>(
      connection,
      'SELECT name FROM teachers WHERE is_other_team=0 ORDER BY name',
    ).map((row) => String(row.name || '')).filter(Boolean));
    if (assignees.some((name) => !registered.has(name))) {
      throw new HttpError(400, '다른 팀 또는 등록되지 않은 인원은 공용 업무에 배정할 수 없습니다. 강사 목록을 새로고침해 주세요.');
    }
    return assignees;
  }

  /** 업무 카드에는 집계 숫자만 싣고 학생명·전화·부재 내용은 상담 상세 API에만 둔다. */
  private counselAggregateOn(connection: any, taskId?: string): Record<string, Record<string, CounselProgress>> {
    const result: Record<string, Record<string, CounselProgress>> = {};
    const where = taskId ? ' WHERE task_id=?' : '';
    const params = taskId ? [taskId] : [];
    for (const row of this.connectionAll<any>(connection,
      `SELECT task_id,teacher,COUNT(*) total,
              SUM(CASE WHEN synced=1 THEN 1 ELSE 0 END) synced
       FROM counsel_entries${where}${where ? ' AND' : ' WHERE'} roster_active=1 GROUP BY task_id,teacher`,
      ...params,
    )) {
      const byTeacher = result[row.task_id] || (result[row.task_id] = {});
      byTeacher[row.teacher] = {
        synced: Number(row.synced || 0),
        total: Number(row.total || 0),
        absenceCount: 0,
        absencePendingCount: 0,
      };
    }
    for (const row of this.connectionAll<any>(connection,
      `SELECT a.task_id,a.teacher,
              SUM(CASE WHEN a.delivery_stage='posting' OR a.delivery_state='confirmed' THEN 1 ELSE 0 END) absence_count,
              SUM(CASE WHEN a.delivery_state='pending' THEN 1 ELSE 0 END) absence_pending_count
       FROM counsel_absence_attempts a
       JOIN counsel_entries e ON e.id=a.entry_id AND e.roster_active=1
       ${taskId ? 'WHERE a.task_id=?' : ''} GROUP BY a.task_id,a.teacher`,
      ...params,
    )) {
      const byTeacher = result[row.task_id] || (result[row.task_id] = {});
      const progress = byTeacher[row.teacher] || (byTeacher[row.teacher] = {
        synced: 0, total: 0, absenceCount: 0, absencePendingCount: 0,
      });
      progress.absenceCount = Number(row.absence_count || 0);
      progress.absencePendingCount = Number(row.absence_pending_count || 0);
    }
    return result;
  }

  private buildTask(
    t: any,
    stByTask: Record<string, any[]>,
    allTeacherNames: string[],
    counselAgg: Record<string, Record<string, CounselProgress>> = {},
  ) {
    const scope = P(t.scope, 'all');
    const statuses = stByTask[t.id] || [];
    const stMap: Record<string, any> = {};
    for (const s of statuses) stMap[s.teacher] = { status: s.status, at: s.at, reportText: s.report_text, reportFiles: P(s.report_files, []), mDone: !!s.m_done, tDone: !!s.t_done };
    const eligibleTeachers = new Set(allTeacherNames);
    const scopedAssignees: string[] = t.special_counsel
      ? uniqueNames(P(t.special_assignees, []))
      : (scope === 'all' ? allTeacherNames : uniqueNames(scope));
    const assignees: string[] = t.self_managed
      ? uniqueNames(scope)
      : scopedAssignees.filter((name) => eligibleTeachers.has(name));
    // 상담 업무: 완료 = 담당 학생 전원 통통통 전송. 특강상담에서 배정 학생이 없는 강사는 '대상 없음'으로 완료 집계한다.
    const isCounsel = !!t.counsel || !!t.special_counsel;
    let cprog: Record<string, CounselProgress & { noTarget?: boolean }> | undefined;
    if (isCounsel) {
      cprog = {};
      for (const name of assignees) {
        const entry = counselAgg[t.id]?.[name] || { synced: 0, total: 0, absenceCount: 0, absencePendingCount: 0 };
        if (t.special_counsel) {
          // 특강상담은 생성 시 counsel_entries에 고정한 로스터가 진실이다. 월간 캐시 재동기화의 영향을 받지 않는다.
          cprog[name] = { ...entry, noTarget: entry.total === 0 };
        } else {
          cprog[name] = entry;
        }
      }
    }
    const done = isCounsel
      ? assignees.filter((n) => t.special_counsel
        ? !!cprog![n]?.noTarget || cprog![n].synced >= cprog![n].total
        : (cprog![n]?.total || 0) > 0 && cprog![n].synced >= cprog![n].total).length
      : assignees.filter((n) => stMap[n]?.status === 'done').length;
    const dday = ddayFrom(config.today, t.due_date);
    return {
      id: t.id, title: t.title, descr: t.descr, tag: t.tag,
      start: t.start_date, due: t.due_date, startLabel: koDate(t.start_date), dueLabel: koDate(t.due_date),
      dday, scope, assignees, reportReq: !!t.report_req, attachReq: !!t.attach_req, mt: !!t.mt,
      counsel: !!t.counsel, specialCounsel: !!t.special_counsel, specialSourceMonth: t.special_source_month || '', counselProg: cprog, archived: !!t.archived,
      selfManaged: !!t.self_managed, createdByTid: t.created_by_tid || '', selfSourceMonth: t.self_source_month || '',
      links: P(t.links, []), atts: P(t.atts, []), statuses: stMap, doneCount: done, total: assignees.length,
      sm: Number(t.start_date.slice(5, 7)), sd: Number(t.start_date.slice(8, 10)),
      em: Number(t.due_date.slice(5, 7)), ed: Number(t.due_date.slice(8, 10)),
    };
  }

  private buildEvent(e: any, viewerTid: string, isLead: boolean, isMasterLead: boolean) {
    // 팀 일정은 팀장 모드에서 관리하고, 개인일정은 역할 전환 후에도 같은 tid 소유자만 관리한다.
    // 기존 owner='lead'는 마스터 lead_account의 레거시 개인일정으로만 해석한다.
    const teamEvent = e.owner === 'team' || e.type === 'team_event';
    const ownsPersonal = e.owner === 'lead' ? isMasterLead : e.owner === viewerTid;
    const mine = teamEvent ? isLead : ownsPersonal;
    return {
      id: e.id, owner: e.owner, type: e.type, tag: e.tag, title: e.title, descr: e.descr,
      start: e.start_date, end: e.end_date, mine,
      sm: Number(e.start_date.slice(5, 7)), sd: Number(e.start_date.slice(8, 10)),
      em: Number(e.end_date.slice(5, 7)), ed: Number(e.end_date.slice(8, 10)),
    };
  }

  // ────────────────────── 전체 상태 스냅샷 ──────────────────────
  getState(role: Role, tid: string) {
    const today = config.today;
    const isLead = role === 'lead';
    const isOtherTeam = role === 'other';

    // 로스터/리드 계정은 한 번씩만 조회하고 재사용 (기존엔 teachers 3회·lead_account 2회 중복 조회)
    const lead = this.db.get<any>('SELECT id,name FROM lead_account LIMIT 1');
    const leadName = lead?.name || '팀장';
    const teacherRows = this.db.all<any>('SELECT tid,name,classes,ttt_id,ttt_pw,is_lead,is_other_team,sort FROM teachers ORDER BY name');
    const allTeacherNames = teacherRows.filter((t) => !t.is_other_team).map((t) => t.name);

    // 코드 기반 반 선택 이력이 있으면 그것을 화면 상태의 기준으로 사용한다. 이전 버전의
    // 자동 동기화가 teachers.classes에 남긴 값 때문에 관리자 요약과 실제 저장 명단이
    // 다르게 보이지 않도록 최신 선택 월을 한 번에 읽어 이름 기반 호환 뷰를 만든다.
    const latestRosterByTeacher = new Map<string, { sourceMonth: string; classCount: number }>();
    for (const row of this.db.all<any>(
      `SELECT teacher_tid,source_month,class_count,synced_at
       FROM other_team_syncs ORDER BY teacher_tid,synced_at DESC,source_month DESC`,
    )) {
      if (!latestRosterByTeacher.has(row.teacher_tid)) {
        latestRosterByTeacher.set(row.teacher_tid, {
          sourceMonth: String(row.source_month || ''),
          classCount: Number(row.class_count || 0),
        });
      }
    }
    const selectedClassesByTeacher = new Map<string, Record<TeacherClassGroup, string[]>>();
    for (const teacherTid of latestRosterByTeacher.keys()) {
      selectedClassesByTeacher.set(teacherTid, normalizeTeacherClasses({}));
    }
    for (const row of this.db.all<any>(
      `SELECT teacher_tid,source_month,class_name,top_name,day_group
       FROM other_team_classes ORDER BY teacher_tid,class_name,class_code`,
    )) {
      const latest = latestRosterByTeacher.get(row.teacher_tid);
      if (!latest || latest.sourceMonth !== row.source_month) continue;
      const classes = selectedClassesByTeacher.get(row.teacher_tid)!;
      const group = row.day_group === 'M'
        ? (row.top_name === '특강' ? '특강 월수금반' : '월수금반')
        : row.day_group === 'T'
          ? (row.top_name === '특강' ? '특강 화목토반' : '화목토반')
          : null;
      const className = String(row.class_name || '').trim();
      if (group && className && !classes[group].includes(className)) classes[group].push(className);
    }
    const stateClassesFor = (teacher: any) => (
      selectedClassesByTeacher.get(teacher.tid) || normalizeTeacherClasses(teacher.classes)
    );

    // 팀장 모드: 마스터 admin이면 lead_account 이름, 임명된 강사면 본인 이름/식별자(헤더 표시·본인 리포트 타깃)
    const masterLead = isLead && !!lead && tid === lead.id;
    const meLead = teacherRows.find((x) => x.tid === tid);
    const viewerTeacher = teacherRows.find((x) => x.tid === tid);
    const me = isLead
      ? (masterLead
        ? { tid: lead.id, name: leadName, classes: null, isLead: true, isTeacher: false, isOtherTeam: false }
        : (meLead && !!meLead.is_lead
          ? { tid: meLead.tid, name: meLead.name, classes: null, isLead: true, isTeacher: !meLead.is_other_team, isOtherTeam: !!meLead.is_other_team }
          : null))
      : (() => {
        const t = viewerTeacher;
        if (!t || (isOtherTeam ? !t.is_other_team : !!t.is_other_team)) return null;
        return {
          tid: t.tid, name: t.name, classes: stateClassesFor(t),
          tttId: t.ttt_id || '', hasTtt: !!(t.ttt_id && t.ttt_pw),
          isLead: !!t.is_lead, isTeacher: !t.is_other_team, isOtherTeam: !!t.is_other_team,
        };
      })();
    if (!me) throw new HttpError(400,'사용자를 찾을 수 없습니다.');

    // task_status를 한 번에 로드 → task_id로 그룹핑 (기존엔 업무마다 별도 SELECT = N+1)
    const stByTask: Record<string, any[]> = {};
    for (const st of this.db.all<any>('SELECT * FROM task_status')) (stByTask[st.task_id] || (stByTask[st.task_id] = [])).push(st);
    // 학생 개인정보는 상태에 싣지 않고 업무×강사 단위 전송·부재 숫자만 집계한다.
    const counselAgg = this.counselAggregateOn(this.d());
    const allTasks = this.db.all<any>('SELECT * FROM tasks ORDER BY sort').map((t) => this.buildTask(t, stByTask, allTeacherNames, counselAgg));
    let tasks = isLead
      ? allTasks.filter((t) => !t.selfManaged)
      : isOtherTeam
        ? allTasks.filter((t) => t.selfManaged && t.createdByTid === tid)
        : allTasks.filter((t) => !t.selfManaged && t.assignees.includes(me.name));
    // 강사에게는 본인 처리상태만 노출 (타 강사 보고 텍스트/첨부 유출 방지)
    if (!isLead) {
      tasks = tasks.map((t) => ({
        ...t,
        statuses: { [me.name]: t.statuses[me.name] || { status: 'none', at: '', reportText: '', reportFiles: [] } },
        counselProg: t.counselProg ? { [me.name]: t.counselProg[me.name] || { synced: 0, total: 0, absenceCount: 0, absencePendingCount: 0 } } : undefined,
      }));
    }

    const allEvents = this.db.all<any>('SELECT * FROM events').map((e) => this.buildEvent(e, tid, isLead, masterLead));
    // 모든 모드: 팀 일정 + 정확히 본인이 소유한 개인일정만. 단, 팀 일정의 mine은 팀장 모드에서만 true다.
    const events = isOtherTeam
      ? []
      : allEvents.filter((event) => event.owner === 'team' || event.type === 'team_event' || event.mine);

    const tags = this.db.all<any>('SELECT name,color,emoji FROM tags ORDER BY sort').map((t) => ({ ...t, fixed: FIXED_TAGS.includes(t.name) }));
    const notices = this.db.all<any>('SELECT id,text,active,posted_date,author FROM notices ORDER BY sort').map((n) => ({
      id: n.id, text: n.text, active: !!n.active, postedDate: n.posted_date,
      meta: `${koDate(n.posted_date).replace(/\s\([^)]*\)/, '')} 게시`, author: n.author,
    }));

    // journals + journal_items를 각각 한 번에 로드 후 date로 그룹핑 (기존엔 날짜마다 별도 SELECT = N+1)
    const itemsByDate: Record<string, any[]> = {};
    for (const i of this.db.all<any>('SELECT id,date,text,required FROM journal_items ORDER BY sort')) {
      (itemsByDate[i.date] || (itemsByDate[i.date] = [])).push({ id: i.id, text: i.text, required: !!i.required });
    }
    // 모든 일일보고 제출/확인 현황을 날짜별로 로드 → journals에 실제 현황 부착(지난 날짜 하드코딩 버그 방지)
    // 확인(confirmed)은 제출된 보고에만 유효 — 과거 버그로 미제출+confirmed=1 된 행도 표시상 교정.
    const reportsByDate: Record<string, Record<string, { submitted: boolean; confirmed: boolean }>> = {};
    for (const r of this.db.all<any>('SELECT teacher,date,status,confirmed FROM daily_reports')) {
      const submitted = r.status === 'submitted';
      (reportsByDate[r.date] || (reportsByDate[r.date] = {}))[r.teacher] = { submitted, confirmed: submitted && !!r.confirmed };
    }
    // 날짜별 전원 제출·확인 현황은 팀장 화면이 쓰고, 강사 화면에는 본인 것만 내려 보낸다.
    const visibleReports = (all: Record<string, { submitted: boolean; confirmed: boolean }> = {}) => {
      if (isLead) return all;
      return me && all[me.name] ? { [me.name]: all[me.name] } : {};
    };
    const journals = this.db.all<any>('SELECT date,special_period FROM journals ORDER BY date DESC').map((j) => ({
      date: j.date, label: koDate(j.date), items: itemsByDate[j.date] || [],
      specialPeriod: !!j.special_period,
      kind: j.date === today ? 'today' : j.date < today ? 'past' : 'future',
      reports: visibleReports(reportsByDate[j.date]), // { 강사명: {submitted, confirmed} }
    }));

    // 오늘 제출/확인 현황
    const drMap: Record<string, any> = {};
    for (const r of this.db.all<any>('SELECT teacher,status,confirmed,submitted_at FROM daily_reports WHERE date=?', today)) drMap[r.teacher] = { status: r.status, confirmed: !!r.confirmed, at: r.submitted_at };

    const teachers = teacherRows.map((t) => ({
      tid: t.tid, name: t.name, classes: stateClassesFor(t),
      selectedClassCount: latestRosterByTeacher.get(t.tid)?.classCount,
      tttId: t.ttt_id || '', hasTtt: !!(t.ttt_id && t.ttt_pw), // 통통통 계정 연결 여부(비번은 미노출)
      isLead: !!t.is_lead, // 팀장 권한 부여 여부
      isOtherTeam: !!t.is_other_team, // 다른 팀 편의 기능 권한(일일보고 제외)
      todaySubmitted: drMap[t.name]?.status === 'submitted',
      // 확인은 제출된 보고에만 유효 — 과거 버그로 미제출+confirmed=1 된 행이 확인 완료로 보이지 않도록.
      todayConfirmed: drMap[t.name]?.status === 'submitted' && !!drMap[t.name]?.confirmed,
    }));


    // 강사 본인 리포트/지난 로그
    let myReport: any = null;
    let myPastLogs: any[] = [];
    if (role === 'teacher') {
      const r = this.db.get<any>('SELECT * FROM daily_reports WHERE teacher=? AND date=?', me.name, today);
      myReport = r ? { status: r.status, confirmed: !!r.confirmed, payload: P(r.payload, {}), at: r.submitted_at } : null;
      myPastLogs = this.db.all<any>(
        `SELECT j.date,r.status,r.confirmed,r.payload,r.submitted_at
         FROM journals j
         LEFT JOIN daily_reports r ON r.date=j.date AND r.teacher=?
         WHERE j.date<?
         ORDER BY j.date DESC`,
        me.name, today,
      ).map((x) => {
        const status = x.status === 'submitted' ? 'submitted' : x.status === 'draft' ? 'draft' : 'none';
        const submitted = status === 'submitted';
        const payload = P(x.payload, {}) || {};
        return {
          date: x.date,
          label: koDate(x.date),
          status,
          submitted,
          confirmed: submitted && !!x.confirmed,
          nb: payload.nb ?? 0,
          at: x.submitted_at,
        };
      });
    }

    return {
      today, todayLabel: koDateFull(today), todayGroup: groupOf(today),
      role, me, leadName,
      teachers: isLead ? teachers : teachers.filter((t) => t.tid === tid),
      teacherNames: isOtherTeam ? [] : allTeacherNames,
      tasks, events,
      tags: isOtherTeam ? tags.filter((tag) => tag.name === SYSTEM_COUNSEL_TAGS.regular) : tags,
      notices: isOtherTeam ? [] : notices,
      journals: isOtherTeam ? [] : journals,
      // 전원 제출현황/리마인드 대상은 팀장에게만 노출
      todayReports: isLead ? drMap : {},
      myReport, myPastLogs,
      settings: {
        wtestM: this.getSetting('wtest_m'), wtestT: this.getSetting('wtest_t'),
        specialPeriodEnabled: this.getSetting(SPECIAL_SETTING_KEYS.enabled) === '1',
        specialSyncDate: this.getSetting(SPECIAL_SETTING_KEYS.targetDate),
        specialSyncMonth: this.getSetting(SPECIAL_SETTING_KEYS.sourceMonth),
        specialSyncAt: this.getSetting(SPECIAL_SETTING_KEYS.syncedAt),
        specialSyncSummary: isLead ? P(this.getSetting(SPECIAL_SETTING_KEYS.summary), null) : null,
        regularSyncDate: this.getSetting(REGULAR_SETTING_KEYS.targetDate),
        regularSyncMonth: this.getSetting(REGULAR_SETTING_KEYS.sourceMonth),
        regularSyncAt: this.getSetting(REGULAR_SETTING_KEYS.syncedAt),
        regularSyncSummary: isLead ? P(this.getSetting(REGULAR_SETTING_KEYS.summary), null) : null,
      },
    };
  }

  // ────────────────────── 강사 공통 · 직접 선택 반 ──────────────────────
  private requireTeacherOn(connection: any, tid: string) {
    const normalizedTid = String(tid || '').trim();
    if (!normalizedTid) throw new HttpError(403, '로그인 정보를 확인할 수 없습니다.');
    const teacher = this.primaryGet<any>(
      connection,
      'SELECT tid,name,ttt_id,ttt_pw,is_other_team,classes FROM teachers WHERE tid=?',
      normalizedTid,
    );
    if (!teacher) throw new HttpError(404, '강사를 찾을 수 없습니다.');
    return teacher;
  }

  private requireOtherTeamTeacherOn(connection: any, tid: string) {
    const teacher = this.requireTeacherOn(connection, tid);
    if (!teacher.is_other_team) {
      throw new HttpError(403, '다른 팀 권한이 있는 계정만 사용할 수 있습니다.');
    }
    return teacher;
  }

  /** 아직 코드 기반 선택 이력이 없는 강사의 기존 JSON 배정을 최초 선택값으로 보존한다. */
  getTeacherLegacyClassNames(tid: string): string[] {
    const teacher = this.requireTeacherOn(this.d(), tid);
    const classes = normalizeTeacherClasses(teacher.classes);
    return uniqueStrings(Object.values(classes).flat());
  }

  private teacherRosterRevisionOn(connection: any, tid: string): string {
    const sync = this.primaryGet<any>(
      connection,
      `SELECT source_month,synced_at FROM other_team_syncs
       WHERE teacher_tid=? ORDER BY synced_at DESC,source_month DESC LIMIT 1`,
      tid,
    );
    if (!sync) return createHash('sha256').update(`teacher-roster-empty\u0000${tid}`).digest('hex');
    const classes = this.connectionAll<any>(
      connection,
      `SELECT class_code,class_name,top_name,middle_name,day_group,schedule_code
       FROM other_team_classes WHERE teacher_tid=? AND source_month=? ORDER BY class_code`,
      tid, sync.source_month,
    );
    return createHash('sha256').update(JSON.stringify({
      teacherTid: tid,
      sourceMonth: sync.source_month,
      syncedAt: sync.synced_at || '',
      classes,
    })).digest('hex');
  }

  getTeacherRoster(tid: string) {
    this.requireTeacherOn(this.d(), tid);
    const sync = this.db.get<any>(
      `SELECT teacher_tid,source_month,synced_at,class_count,student_count,warnings
       FROM other_team_syncs WHERE teacher_tid=? ORDER BY synced_at DESC,source_month DESC LIMIT 1`,
      tid,
    );
    if (!sync) {
      return {
        sourceMonth: '', syncedAt: '', classCount: 0, studentCount: 0, warnings: [], classes: [],
        selectionRevision: this.teacherRosterRevisionOn(this.d(), tid),
      };
    }
    const classes = this.db.all<any>(
      `SELECT class_code,class_name,top_name,middle_name,day_group,schedule_code,student_count
       FROM other_team_classes WHERE teacher_tid=? AND source_month=? ORDER BY class_name,class_code`,
      tid, sync.source_month,
    );
    const students = this.db.all<any>(
      `SELECT class_code,scode,student,grade,status
       FROM other_team_students WHERE teacher_tid=? AND source_month=? ORDER BY class_code,student,scode`,
      tid, sync.source_month,
    );
    const studentsByClass = new Map<string, any[]>();
    for (const row of students) {
      const group = studentsByClass.get(row.class_code) || [];
      group.push({ scode: row.scode, student: row.student, grade: row.grade || '', status: row.status || '' });
      studentsByClass.set(row.class_code, group);
    }
    return {
      sourceMonth: sync.source_month,
      syncedAt: sync.synced_at || '',
      classCount: Number(sync.class_count || 0),
      studentCount: Number(sync.student_count || 0),
      warnings: P(sync.warnings, []),
      selectionRevision: this.teacherRosterRevisionOn(this.d(), tid),
      classes: classes.map((row) => ({
        classCode: row.class_code,
        className: row.class_name,
        topName: row.top_name || '',
        middleName: row.middle_name || '',
        dayGroup: row.day_group || '',
        scheduleCode: row.schedule_code || '',
        studentCount: Number(row.student_count || 0),
        students: studentsByClass.get(row.class_code) || [],
      })),
    };
  }

  /** 다른 팀 상담 등 기존 호출부 호환용. */
  getOtherTeamRoster(tid: string) {
    this.requireOtherTeamTeacherOn(this.d(), tid);
    return this.getTeacherRoster(tid);
  }

  /** ERP에서 소유권을 확인하고 사용자가 선택한 반/학생만 원격 원본에 원자 교체한다. */
  applyTeacherRosterSnapshotOnPrimary(input: TeacherRosterApplyInput) {
    const teacherTid = String(input?.teacherTid || '').trim();
    const sourceMonth = String(input?.sourceMonth || '').trim();
    const syncedAt = String(input?.syncedAt || new Date().toISOString()).trim();
    const expectedRevision = String(input?.expectedRevision || '').trim();
    if (!isSourceMonth(sourceMonth)) throw new HttpError(400, '수강년월 형식이 올바르지 않습니다.');
    if (!syncedAt || syncedAt.length > 100) throw new HttpError(400, '동기화 시각을 확인해 주세요.');
    if (!Array.isArray(input?.classes) || input.classes.length > MAX_COUNSEL_ROSTER_CLASSES) {
      throw new HttpError(400, `본인 반은 최대 ${MAX_COUNSEL_ROSTER_CLASSES}개까지 동기화할 수 있습니다.`);
    }
    if (expectedRevision && !/^[a-f0-9]{64}$/.test(expectedRevision)) {
      throw new HttpError(400, '반 선택 버전을 확인해 주세요.');
    }

    const classCodes = new Map<string, string>();
    const classNames = new Map<string, string>();
    const classes: Array<{
      classCode: string; className: string; topName: string; middleName: string;
      dayGroup: string; scheduleCode: string;
      students: Array<{ scode: string; student: string; grade: string; status: string }>;
    }> = [];
    let studentCount = 0;
    for (const rawClass of input.classes) {
      const classCode = String(rawClass?.classCode || '').trim();
      const className = String(rawClass?.className || '').trim();
      const topName = String(rawClass?.topName || '').trim();
      const middleName = String(rawClass?.middleName || '').trim();
      const dayGroup = String(rawClass?.dayGroup || '').trim();
      const scheduleCode = String(rawClass?.scheduleCode || '').trim();
      if (!classCode || !className || classCode.length > 200 || className.length > 300) {
        throw new HttpError(400, '통통통 반 코드 또는 반명을 확인해 주세요.');
      }
      if (topName.length > 200 || middleName.length > 200 || dayGroup.length > 30 || scheduleCode.length > 100) {
        throw new HttpError(400, '통통통 반 요일 정보를 확인해 주세요.');
      }
      const knownName = classCodes.get(classCode);
      const knownCode = classNames.get(className);
      if (knownName && knownName !== className) {
        throw new HttpError(409, '같은 반 코드에 서로 다른 반명이 포함되어 있습니다. 다시 동기화해 주세요.');
      }
      if (knownCode && knownCode !== classCode) {
        throw new HttpError(409, `반명 '${className}'이 여러 반 코드에 중복되어 있어 현재 기능에서 함께 선택할 수 없습니다.`);
      }
      if (knownName) throw new HttpError(409, '같은 반이 중복되어 있습니다. 다시 동기화해 주세요.');
      classCodes.set(classCode, className);
      classNames.set(className, classCode);
      if (!Array.isArray(rawClass.students)) throw new HttpError(400, '반별 학생 목록을 확인해 주세요.');
      const seenStudents = new Map<string, string>();
      const normalizedStudents: Array<{ scode: string; student: string; grade: string; status: string }> = [];
      for (const rawStudent of rawClass.students) {
        const scode = String(rawStudent?.scode || '').trim();
        const student = String(rawStudent?.student || '').trim();
        const grade = String(rawStudent?.grade || '').trim();
        const status = String(rawStudent?.status || '').trim();
        if (!scode || !student || scode.length > 200 || student.length > 200 || grade.length > 100 || status.length > 100) {
          throw new HttpError(400, '통통통 학생 정보를 확인해 주세요.');
        }
        const knownStudent = seenStudents.get(scode);
        if (knownStudent && knownStudent !== student) {
          throw new HttpError(409, '같은 학생 코드에 서로 다른 이름이 포함되어 있습니다. 다시 동기화해 주세요.');
        }
        if (knownStudent) continue;
        seenStudents.set(scode, student);
        normalizedStudents.push({ scode, student, grade, status });
        studentCount += 1;
        if (studentCount > MAX_COUNSEL_ROSTER_STUDENTS) {
          throw new HttpError(400, `본인 반 학생은 최대 ${MAX_COUNSEL_ROSTER_STUDENTS}명까지 동기화할 수 있습니다.`);
        }
      }
      classes.push({ classCode, className, topName, middleName, dayGroup, scheduleCode, students: normalizedStudents });
    }
    const warnings = uniqueStrings(input.warnings).slice(0, 100);

    let selectionRevision = '';
    this.db.withRegularClassSyncPrimary((primary) => {
      const tx = primary.transaction(() => {
        const teacher = this.requireTeacherOn(primary, teacherTid);
        if (expectedRevision && this.teacherRosterRevisionOn(primary, teacherTid) !== expectedRevision) {
          throw new HttpError(409, '다른 화면에서 반 선택이 먼저 변경되었습니다. 최신 목록을 다시 불러와 주세요.');
        }
        primary.prepare('DELETE FROM other_team_students WHERE teacher_tid=? AND source_month=?').run(teacherTid, sourceMonth);
        primary.prepare('DELETE FROM other_team_classes WHERE teacher_tid=? AND source_month=?').run(teacherTid, sourceMonth);
        // 원격 primary에는 반/학생마다 왕복하지 않고 검증한 전체 입력을 두 번에 삽입한다.
        // JSON 매개변수이므로 이름/반명은 SQL로 해석되지 않으며 같은 CAS 트랜잭션을 유지한다.
        const classJson = J(classes);
        primary.prepare(
          `INSERT INTO other_team_classes(
             teacher_tid,source_month,class_code,class_name,top_name,middle_name,day_group,schedule_code,student_count,synced_at
           ) SELECT ?,?,json_extract(value,'$.classCode'),json_extract(value,'$.className'),
             json_extract(value,'$.topName'),json_extract(value,'$.middleName'),
             json_extract(value,'$.dayGroup'),json_extract(value,'$.scheduleCode'),
             json_array_length(value,'$.students'),? FROM json_each(?)`,
        ).run(teacherTid, sourceMonth, syncedAt, classJson);
        primary.prepare(
          `INSERT INTO other_team_students(
             teacher_tid,source_month,class_code,scode,student,grade,status,synced_at
           ) SELECT ?,?,json_extract(c.value,'$.classCode'),json_extract(s.value,'$.scode'),
             json_extract(s.value,'$.student'),json_extract(s.value,'$.grade'),
             json_extract(s.value,'$.status'),?
             FROM json_each(?) c, json_each(c.value,'$.students') s`,
        ).run(teacherTid, sourceMonth, syncedAt, classJson);
        primary.prepare(
          `INSERT OR REPLACE INTO other_team_syncs(
             teacher_tid,source_month,synced_at,class_count,student_count,warnings
           ) VALUES(?,?,?,?,?,?)`,
        ).run(teacherTid, sourceMonth, syncedAt, classes.length, studentCount, J(warnings));

        // 일일보고·알림장·상담의 기존 소비자는 teachers.classes를 읽는다. 직접 선택한
        // 코드 기반 스냅샷을 이름 기반 호환 뷰로 함께 갱신하고 예전 자동 특강 그룹은 비운다.
        const selectedClasses = normalizeTeacherClasses(teacher.classes);
        selectedClasses['월수금반'] = uniqueStrings(
          classes.filter((cls) => cls.topName !== '특강' && cls.dayGroup === 'M').map((cls) => cls.className),
        );
        selectedClasses['화목토반'] = uniqueStrings(
          classes.filter((cls) => cls.topName !== '특강' && cls.dayGroup === 'T').map((cls) => cls.className),
        );
        selectedClasses['특강 월수금반'] = uniqueStrings(
          classes.filter((cls) => cls.topName === '특강' && cls.dayGroup === 'M').map((cls) => cls.className),
        );
        selectedClasses['특강 화목토반'] = uniqueStrings(
          classes.filter((cls) => cls.topName === '특강' && cls.dayGroup === 'T').map((cls) => cls.className),
        );
        primary.prepare('UPDATE teachers SET classes=? WHERE tid=?').run(J(selectedClasses), teacherTid);
        selectionRevision = this.teacherRosterRevisionOn(primary, teacherTid);
      });
      tx();
    });
    this.db.refreshRegularClassSyncReplica();
    // 원격 primary 커밋 직후 replica pull이 일시 실패해도 성공 응답이 이전 월 명단으로
    // 되돌아가지 않도록, 방금 검증·커밋한 입력으로 정확한 응답 스냅샷을 만든다.
    return {
      sourceMonth,
      syncedAt,
      classCount: classes.length,
      studentCount,
      warnings,
      selectionRevision,
      classes: classes.map((cls) => ({
        classCode: cls.classCode,
        className: cls.className,
        topName: cls.topName,
        middleName: cls.middleName,
        dayGroup: cls.dayGroup,
        scheduleCode: cls.scheduleCode,
        studentCount: cls.students.length,
        students: cls.students.map((student) => ({ ...student })),
      })),
    };
  }

  /** 배포 전 버전의 다른 팀 자동 동기화 호출부 호환용. */
  applyOtherTeamRosterSnapshotOnPrimary(input: OtherTeamRosterApplyInput) {
    this.requireOtherTeamTeacherOn(this.d(), input?.teacherTid);
    return this.applyTeacherRosterSnapshotOnPrimary(input);
  }

  /** 본인이 만든 상담일정의 로스터를 최신 본인 반 캐시로 이력 보존 갱신한다. */
  syncSelfManagedCounselRosterFromCacheOnPrimary(taskId: string, teacherTid: string) {
    const task = this.db.get<any>('SELECT self_managed,created_by_tid FROM tasks WHERE id=?', taskId);
    if (!task || !task.self_managed || task.created_by_tid !== teacherTid) {
      throw new HttpError(403, '본인이 만든 상담일정만 학생 명단을 동기화할 수 있습니다.');
    }
    const teacher = this.requireOtherTeamTeacherOn(this.d(), teacherTid);
    const roster = this.getOtherTeamRoster(teacherTid);
    if (!roster.sourceMonth) throw new HttpError(400, '본인 반 동기화를 먼저 완료해 주세요.');
    const classes = roster.classes.map((cls: any) => ({
      classCode: cls.classCode,
      className: cls.className,
      students: (cls.students || []).map((student: any) => ({ scode: student.scode, student: student.student })),
    }));
    const result = this.reconcileCounselRosterSnapshotOnPrimary({
      taskId,
      teacher: teacher.name,
      teacherTid,
      kind: 'regular',
      sourceMonth: roster.sourceMonth,
      syncedAt: new Date().toISOString(),
      classes,
      // 본인 반 캐시는 저장 전에 현재 ERP 응답의 전체 멤버십으로 검증된다. 상담 이력은
      // 삭제하지 않고 active만 바꾸며, 이 서명으로 정확히 그 캐시만 적용하게 고정한다.
      confirmedRemovalSignature: this.counselRosterMembershipSignature(
        classes.flatMap((cls: any) => cls.students.map((student: any) => ({
          classCode: cls.classCode,
          className: cls.className,
          scode: student.scode,
        }))),
      ),
    });
    this.db.withTaskDefinitionPrimary((primary) => {
      primary.prepare('UPDATE tasks SET self_source_month=? WHERE id=? AND self_managed=1 AND created_by_tid=?')
        .run(roster.sourceMonth, taskId, teacherTid);
    });
    this.db.refreshCounselRosterReplica();
    return { ...result, sourceMonth: roster.sourceMonth, classes: roster.classes.map((cls: any) => cls.className) };
  }

  /** 일반 강사의 상담 업무도 직접 선택·검증된 현재 반 캐시를 단일 진실로 사용한다. */
  syncTeacherCounselRosterFromSelectionOnPrimary(taskId: string, teacherTid: string) {
    const teacher = this.requireTeacherOn(this.d(), teacherTid);
    if (teacher.is_other_team) throw new HttpError(403, '일반 강사 상담 업무에서만 사용할 수 있습니다.');
    const context = this.getCounselContext(taskId, teacher.name);
    if (context.kind !== 'regular' || context.selfManaged) {
      throw new HttpError(400, '일반 상담 업무가 아닙니다.');
    }
    const roster = this.getTeacherRoster(teacherTid);
    if (!roster.sourceMonth) throw new HttpError(400, '반 관리에서 사용할 반을 먼저 선택해 주세요.');
    const selected = roster.classes.filter((cls: any) => cls.topName !== '특강');
    const classes = selected.map((cls: any) => ({
      classCode: cls.classCode,
      className: cls.className,
      students: (cls.students || []).map((student: any) => ({ scode: student.scode, student: student.student })),
    }));
    const result = this.reconcileCounselRosterSnapshotOnPrimary({
      taskId,
      teacher: teacher.name,
      teacherTid,
      kind: 'regular',
      sourceMonth: roster.sourceMonth,
      syncedAt: new Date().toISOString(),
      classes,
      confirmedRemovalSignature: this.counselRosterMembershipSignature(
        classes.flatMap((cls: any) => cls.students.map((student: any) => ({
          classCode: cls.classCode,
          className: cls.className,
          scode: student.scode,
        }))),
      ),
    });
    return {
      ...result,
      sourceMonth: roster.sourceMonth,
      classes: selected.map((cls: any) => cls.className),
      snapshotCounts: {
        classes: selected.length,
        enrollments: classes.reduce((sum: number, cls: any) => sum + cls.students.length, 0),
      },
    };
  }

  // ────────────────────────── 업무 ──────────────────────────
  private counselMode(counsel: boolean, specialCounsel: boolean): 'none' | 'regular' | 'special' {
    if (counsel && specialCounsel) throw new HttpError(400, '상담 업무와 특강상담 업무는 동시에 선택할 수 없습니다.');
    return specialCounsel ? 'special' : counsel ? 'regular' : 'none';
  }

  /** 신규 업무의 상담 종류는 클라이언트 토글이 아니라 변경 불가 시스템 태그가 결정한다. */
  private counselModeForTag(tag: string): 'none' | 'regular' | 'special' {
    if (tag === SYSTEM_COUNSEL_TAGS.regular) return 'regular';
    if (tag === SYSTEM_COUNSEL_TAGS.special) return 'special';
    return 'none';
  }

  private normalizedTaskTag(value: unknown): string {
    return String(value || '').trim() || '행정';
  }

  private assertSpecialCounselCreationEnabled() {
    if (this.getSetting(SPECIAL_SETTING_KEYS.enabled) !== '1') {
      throw new HttpError(400, '특강 상담 업무는 특강기간에만 만들 수 있습니다.');
    }
  }

  /** 수동 반 선택이 있으면 그 월을 우선하고, 아직 전환 전이면 기존 특강 캐시 월을 쓴다. */
  private currentSpecialSourceMonthForAssigneesOn(connection: any, assignees: string[]): string {
    const months = new Set<string>();
    for (const teacherName of assignees) {
      const row = this.primaryGet<any>(
        connection,
        `SELECT sync.source_month
         FROM teachers teacher
         JOIN other_team_syncs sync ON sync.teacher_tid=teacher.tid
         WHERE teacher.name=?
         ORDER BY sync.synced_at DESC,sync.source_month DESC LIMIT 1`,
        teacherName,
      );
      if (isSourceMonth(row?.source_month)) months.add(row.source_month);
    }
    if (months.size > 1) {
      throw new HttpError(409, '담당 강사들의 반 선택 수강년월이 서로 다릅니다. 강사 현황에서 같은 달로 반을 다시 적용해 주세요.');
    }
    if (months.size === 1) return [...months][0];
    const legacyMonth = String(this.primaryGet<any>(connection, 'SELECT v FROM settings WHERE k=?', SPECIAL_SETTING_KEYS.sourceMonth)?.v || '');
    if (!isSourceMonth(legacyMonth)) {
      throw new HttpError(400, '강사 현황의 반 관리에서 특강 반을 먼저 선택해 주세요.');
    }
    return legacyMonth;
  }

  private sameTaskScope(a: any, b: any): boolean {
    if (a === 'all' || b === 'all') return a === b;
    const left = uniqueNames(a).sort((x, y) => x.localeCompare(y, 'ko'));
    const right = uniqueNames(b).sort((x, y) => x.localeCompare(y, 'ko'));
    return J(left) === J(right);
  }

  /**
   * 특강상담 생성 시점의 월간 캐시를 한 SQL로 고정한다.
   * 원격 primary에서도 학생 수만큼 네트워크 왕복하지 않으며 task INSERT와 같은 트랜잭션에 속한다.
   */
  private freezeSpecialCounselRosterOn(connection: any, taskId: string, sourceMonth: string, assignees: string[]): number {
    if (!assignees.length) return 0;
    const allowedValues = assignees.map(() => '(?)').join(',');
    // 수동 반 선택을 완료한 강사는 그 선택 중 통통통 분류가 정확히 '특강'인 반만 고정한다.
    const selectedResult = connection.prepare(
      `WITH allowed(teacher_name) AS (VALUES ${allowedValues})
       INSERT OR IGNORE INTO counsel_entries(
         id,task_id,teacher,teacher_tid,cls,class_code,scode,student,phone,subject,content,synced,synced_at,done,
         roster_active,roster_source_month,roster_seen_at,roster_removed_at
       )
       SELECT 'ce' || lower(hex(randomblob(16))), ?, teacher.name, classes.teacher_tid,
              classes.class_name, classes.class_code, students.scode, students.student,
              '', '', '', 0, '', 0, 1, classes.source_month, classes.synced_at, ''
       FROM other_team_classes classes
       JOIN other_team_students students
         ON students.teacher_tid=classes.teacher_tid
        AND students.source_month=classes.source_month
        AND students.class_code=classes.class_code
       JOIN teachers teacher ON teacher.tid=classes.teacher_tid
       JOIN allowed ON allowed.teacher_name=teacher.name
       WHERE classes.source_month=? AND classes.top_name='특강'
       ORDER BY teacher.name,classes.class_name,students.student,students.scode`,
    ).run(...assignees, taskId, sourceMonth);

    // 아직 수동 반 관리를 한 번도 적용하지 않은 강사만 기존 중앙 특강 캐시로 보완한다.
    // 전환 완료 강사가 특강 반을 선택하지 않은 경우에는 의도한 0명 스냅샷을 존중한다.
    const legacyResult = connection.prepare(
      `WITH allowed(teacher_name) AS (VALUES ${allowedValues})
       INSERT OR IGNORE INTO counsel_entries(
         id,task_id,teacher,teacher_tid,cls,class_code,scode,student,phone,subject,content,synced,synced_at,done,
         roster_active,roster_source_month,roster_seen_at,roster_removed_at
       )
       SELECT 'ce' || lower(hex(randomblob(16))), ?, roster.teacher_name, roster.teacher_tid,
              roster.class_name, roster.class_code, roster.scode, roster.student,
              coalesce(roster.mother_phone,''), '', '', 0, '', 0, 1, roster.source_month, roster.synced_at, ''
       FROM special_class_roster roster
       JOIN allowed ON allowed.teacher_name=roster.teacher_name
       WHERE roster.source_month=?
         AND NOT EXISTS(
           SELECT 1 FROM other_team_syncs selected
           WHERE selected.teacher_tid=roster.teacher_tid AND selected.source_month=?
         )
       ORDER BY roster.teacher_name,roster.class_name,roster.student,roster.scode`,
    ).run(...assignees, taskId, sourceMonth, sourceMonth);
    return Number(selectedResult?.changes || 0) + Number(legacyResult?.changes || 0);
  }

  private createTaskOn(connection: any, b: any, requestActor = ''): { id: string; created: boolean; rosterCount: number } {
    const requestId = String(b.requestId || '').trim();
    if (requestId && !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) {
      throw new HttpError(400, '업무 생성 요청 ID를 확인해 주세요.');
    }
    if (requestId && !requestActor) {
      throw new HttpError(400, '업무 생성 요청자를 확인해 주세요.');
    }
    // 브라우저가 응답을 받기 전 연결을 끊어도 같은 요청 ID는 항상 같은 task PK로 수렴한다.
    const id = requestId
      ? `t${createHash('sha256').update('npr-task-create-v1\n').update(requestActor).update('\n').update(requestId).digest('hex').slice(0, 16)}`
      : uid('t');
    const tag = this.normalizedTaskTag(b.tag);
    const mode = this.counselModeForTag(tag);
    const counsel = mode === 'regular';
    const specialCounsel = mode === 'special';
    const counselLike = mode !== 'none';
    const scope = b.all
      ? 'all'
      : (mode === 'special'
        ? this.normalizedSpecialAssigneePicks(b.pick)
        : this.validatedTaskAssigneesOn(connection, b.pick));
    const desired = {
      title: b.title,
      descr: b.descr || '',
      tag,
      startDate: b.start,
      dueDate: b.due,
      scope: J(scope),
      // 상담은 전송 현황 자체가 완료 조건이며 일반 업무 보고/첨부/MT 조건을 겹치지 않는다.
      reportReq: counselLike ? 0 : (b.reportReq ? 1 : 0),
      attachReq: counselLike ? 0 : (b.attachReq ? 1 : 0),
      mt: 0,
      counsel: counsel ? 1 : 0,
      specialCounsel: specialCounsel ? 1 : 0,
      links: J(b.links || []),
      atts: J(b.atts || []),
    };
    let created = false;
    let rosterCount = 0;
    const tx = connection.transaction(() => {
      const existing = this.primaryGet<any>(connection, 'SELECT * FROM tasks WHERE id=?', id);
      if (existing) {
        const sameDefinition = existing.title === desired.title
          && existing.descr === desired.descr
          && existing.tag === desired.tag
          && existing.start_date === desired.startDate
          && existing.due_date === desired.dueDate
          && existing.scope === desired.scope
          && Number(existing.report_req) === desired.reportReq
          && Number(existing.attach_req) === desired.attachReq
          && Number(existing.mt) === desired.mt
          && Number(existing.counsel) === desired.counsel
          && Number(existing.special_counsel) === desired.specialCounsel
          && existing.links === desired.links
          && existing.atts === desired.atts;
        // 배포 직전에 구 UI가 보낸 요청은 토글로 상담 종류를 정했다. 응답만 유실된
        // 그 기존 행에 한해 당시 원문 계약까지 비교해 같은 requestId 재시도를 살린다.
        // 신규 INSERT에는 절대 이 경로를 쓰지 않으므로 태그 단일 진실은 유지된다.
        const sameLegacyDefinition = existing.title === desired.title
          && existing.descr === desired.descr
          && existing.tag === desired.tag
          && existing.start_date === desired.startDate
          && existing.due_date === desired.dueDate
          && existing.scope === desired.scope
          && Number(existing.report_req) === (b.reportReq ? 1 : 0)
          && Number(existing.attach_req) === (b.attachReq ? 1 : 0)
          && Number(existing.mt) === (b.mt ? 1 : 0)
          && Number(existing.counsel) === (b.counsel ? 1 : 0)
          && Number(existing.special_counsel) === (b.specialCounsel ? 1 : 0)
          && existing.links === desired.links
          && existing.atts === desired.atts;
        if (!sameDefinition && !sameLegacyDefinition) {
          throw new HttpError(409, '같은 업무 생성 요청 ID에 다른 내용을 사용할 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.');
        }
        rosterCount = Number(this.primaryGet<any>(connection, 'SELECT COUNT(*) count FROM counsel_entries WHERE task_id=?', id)?.count || 0);
        return;
      }
      if (b.mt) throw new HttpError(400, '새 MT 업무는 더 이상 만들 수 없습니다.');
      // 이미 같은 requestId로 생성된 업무는 토글이 그 사이 꺼져도 위에서 멱등 반환한다.
      // 새 스냅샷을 만드는 최초 INSERT만 현재 특강기간을 요구한다.
      if (mode === 'special') {
        const enabled = this.primaryGet<any>(connection, 'SELECT v FROM settings WHERE k=?', SPECIAL_SETTING_KEYS.enabled)?.v || '';
        if (enabled !== '1') throw new HttpError(400, '특강 상담 업무는 특강기간에만 만들 수 있습니다.');
      }
      const specialAssignees = mode === 'special' ? this.validatedSpecialAssigneesOn(connection, scope) : [];
      const specialSourceMonth = mode === 'special'
        ? this.currentSpecialSourceMonthForAssigneesOn(connection, specialAssignees)
        : '';
      connection.prepare(
        `INSERT INTO tasks(id,title,descr,tag,start_date,due_date,scope,report_req,attach_req,mt,counsel,special_counsel,special_source_month,special_assignees,archived,links,atts,created_at,sort)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?)`,
      ).run(id, desired.title, desired.descr, desired.tag, desired.startDate, desired.dueDate,
        desired.scope, desired.reportReq, desired.attachReq, desired.mt,
        counsel ? 1 : 0, specialCounsel ? 1 : 0, specialSourceMonth, J(specialAssignees),
        desired.links, desired.atts, config.today,
        (this.primaryGet<any>(connection, 'SELECT MAX(sort) m FROM tasks')?.m || 0) + 1,
      );
      if (mode === 'special') rosterCount = this.freezeSpecialCounselRosterOn(connection, id, specialSourceMonth, specialAssignees);
      created = true;
    });
    tx();
    return { id, created, rosterCount };
  }

  private taskSnapshotOn(connection: any, id: string) {
    const row = this.primaryGet<any>(connection, 'SELECT * FROM tasks WHERE id=?', id);
    if (!row) throw new HttpError(500, '생성한 업무를 확인하지 못했습니다. 같은 내용으로 다시 시도해 주세요.');
    const statuses = this.connectionAll<any>(connection, 'SELECT * FROM task_status WHERE task_id=?', id);
    const teacherNames = this.connectionAll<any>(connection, 'SELECT name FROM teachers WHERE is_other_team=0 ORDER BY name').map((teacher) => teacher.name);
    return this.buildTask(row, { [id]: statuses }, teacherNames, this.counselAggregateOn(connection, id));
  }

  createTask(b: any, requestActor = ''): string {
    return this.createTaskOn(this.d(), b, requestActor).id;
  }

  /** 다른 팀 사용자가 본인 반 스냅샷으로 만드는 개인 상담일정. 공용 업무/일일보고에는 포함되지 않는다. */
  createOtherTeamCounselTaskOnPrimary(b: any, teacherTid: string) {
    const title = String(b?.title || '').trim();
    const descr = String(b?.descr || b?.desc || '').trim();
    const start = String(b?.start || '').trim();
    const due = String(b?.due || '').trim();
    const requestId = String(b?.requestId || '').trim();
    if (!title || title.length > 200) throw new HttpError(400, '상담일정 이름을 200자 이내로 입력해 주세요.');
    if (descr.length > 5000) throw new HttpError(400, '상담일정 메모는 5000자 이내로 입력해 주세요.');
    if (!isIsoDate(start) || !isIsoDate(due) || due < start) {
      throw new HttpError(400, '상담일정의 시작일과 마감일을 확인해 주세요.');
    }
    if (requestId && !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) {
      throw new HttpError(400, '상담일정 생성 요청 ID를 확인해 주세요.');
    }
    const id = requestId
      ? `ot${createHash('sha256').update('npr-other-team-counsel-v1\n').update(teacherTid).update('\n').update(requestId).digest('hex').slice(0, 16)}`
      : uid('ot');
    let created = false;
    let rosterCount = 0;
    let sourceMonth = '';
    const result = this.db.withTaskDefinitionPrimary((primary) => {
      const tx = primary.transaction(() => {
        const teacher = this.requireOtherTeamTeacherOn(primary, teacherTid);
        const sync = this.primaryGet<any>(primary,
          `SELECT source_month FROM other_team_syncs
           WHERE teacher_tid=? ORDER BY synced_at DESC,source_month DESC LIMIT 1`,
          teacherTid,
        );
        sourceMonth = String(sync?.source_month || '');
        if (!isSourceMonth(sourceMonth)) throw new HttpError(400, '본인 반 동기화를 먼저 완료해 주세요.');
        const scope = J([teacher.name]);
        const existing = this.primaryGet<any>(primary, 'SELECT * FROM tasks WHERE id=?', id);
        if (existing) {
          const same = !!existing.self_managed
            && existing.created_by_tid === teacherTid
            && existing.title === title
            && existing.descr === descr
            && existing.start_date === start
            && existing.due_date === due
            && existing.scope === scope
            && existing.tag === SYSTEM_COUNSEL_TAGS.regular;
          if (!same) throw new HttpError(409, '같은 상담일정 생성 요청에 다른 내용을 사용할 수 없습니다.');
          sourceMonth = existing.self_source_month || sourceMonth;
          rosterCount = Number(this.primaryGet<any>(primary,
            'SELECT COUNT(*) count FROM counsel_entries WHERE task_id=? AND roster_active=1', id,
          )?.count || 0);
          return;
        }

        primary.prepare(
          `INSERT INTO tasks(
             id,title,descr,tag,start_date,due_date,scope,report_req,attach_req,mt,counsel,special_counsel,
             special_source_month,special_assignees,self_managed,created_by_tid,self_source_month,
             archived,links,atts,created_at,sort
           ) VALUES(?,?,?,?,?,?,?,0,0,0,1,0,'','[]',1,?,?,0,'[]','[]',?,?)`,
        ).run(
          id, title, descr, SYSTEM_COUNSEL_TAGS.regular, start, due, scope,
          teacherTid, sourceMonth, config.today,
          Number(this.primaryGet<any>(primary, 'SELECT MAX(sort) m FROM tasks')?.m || 0) + 1,
        );
        const classes = this.connectionAll<any>(primary,
          `SELECT class_code,class_name FROM other_team_classes
           WHERE teacher_tid=? AND source_month=? ORDER BY class_name,class_code`,
          teacherTid, sourceMonth,
        );
        const students = this.connectionAll<any>(primary,
          `SELECT class_code,scode,student FROM other_team_students
           WHERE teacher_tid=? AND source_month=? ORDER BY class_code,student,scode`,
          teacherTid, sourceMonth,
        );
        const classNames = new Map(classes.map((cls) => [String(cls.class_code), String(cls.class_name)]));
        const insert = primary.prepare(
          `INSERT INTO counsel_entries(
             id,task_id,teacher,teacher_tid,cls,class_code,scode,student,phone,subject,content,synced,synced_at,done,
             roster_active,roster_source_month,roster_seen_at,roster_removed_at
           ) VALUES(?,?,?,?,?,?,?,?,?,'','',0,'',0,1,?,?, '')`,
        );
        const syncedAt = new Date().toISOString();
        for (const student of students) {
          const classCode = String(student.class_code || '');
          const className = classNames.get(classCode);
          if (!className) continue;
          insert.run(
            uid('ce'), id, teacher.name, teacherTid, className, classCode,
            student.scode, student.student, '', sourceMonth, syncedAt,
          );
          rosterCount += 1;
        }
        created = true;
      });
      tx();
      return { id, created, rosterCount, sourceMonth, task: this.taskSnapshotOn(primary, id) };
    });
    this.db.refreshCounselRosterReplica();
    return result;
  }

  /**
   * 특강상담 최초 생성은 원격 원본에서 task+고정 로스터를 한 번에 커밋하고,
   * 현재 요청의 stale embedded replica를 다시 왕복하지 않도록 PII 없는 업무 델타를 반환한다.
   */
  createSpecialCounselTaskOnPrimary(b: any, requestActor = '') {
    if (this.counselModeForTag(this.normalizedTaskTag(b.tag)) !== 'special') {
      throw new HttpError(400, '특강 상담 업무가 아닙니다.');
    }
    return this.db.withTaskDefinitionPrimary((primary) => {
      const result = this.createTaskOn(primary, b, requestActor);
      return { ...result, task: this.taskSnapshotOn(primary, result.id) };
    });
  }

  setTaskStatus(taskId: string, teacher: string, status: 'done' | 'undone', at?: string) {
    const t = this.db.get<any>('SELECT * FROM tasks WHERE id=?', taskId);
    if (!t) throw new HttpError(400,'업무를 찾을 수 없습니다.');
    if (status === 'done') {
      // 완료조건 검증
      const st = this.db.get<any>('SELECT * FROM task_status WHERE task_id=? AND teacher=?', taskId, teacher);
      const rtext = st?.report_text || '';
      const rfiles = P(st?.report_files, []);
      if (t.report_req && !rtext.trim()) throw new HttpError(400,'텍스트 보고가 필요합니다.');
      if (t.attach_req && rfiles.length === 0) throw new HttpError(400,'첨부파일이 필요합니다.');
    }
    const existing = this.db.get<any>('SELECT * FROM task_status WHERE task_id=? AND teacher=?', taskId, teacher);
    if (existing) {
      this.db.run('UPDATE task_status SET status=?, at=? WHERE task_id=? AND teacher=?', status, at || '방금', taskId, teacher);
    } else {
      this.db.run('INSERT INTO task_status(task_id,teacher,status,report_text,report_files,at) VALUES(?,?,?,?,?,?)',
        taskId, teacher, status, '', '[]', at || '방금');
    }
  }

  /** MT 업무: 강사가 M(월수금)/T(화목토) 완료를 따로 토글. 둘 다 done이면 status='done'. */
  setTaskMt(taskId: string, teacher: string, part: 'm' | 't', value: boolean, at?: string) {
    const t = this.db.get<any>('SELECT * FROM tasks WHERE id=?', taskId);
    if (!t) throw new HttpError(400, '업무를 찾을 수 없습니다.');
    const existing = this.db.get<any>('SELECT * FROM task_status WHERE task_id=? AND teacher=?', taskId, teacher);
    let mDone = existing ? !!existing.m_done : false;
    let tDone = existing ? !!existing.t_done : false;
    if (part === 'm') mDone = value; else tDone = value;
    const status = mDone && tDone ? 'done' : (mDone || tDone ? 'undone' : 'none');
    if (existing) {
      this.db.run('UPDATE task_status SET m_done=?, t_done=?, status=?, at=? WHERE task_id=? AND teacher=?',
        mDone ? 1 : 0, tDone ? 1 : 0, status, at || '방금', taskId, teacher);
    } else {
      this.db.run('INSERT INTO task_status(task_id,teacher,status,report_text,report_files,m_done,t_done,at) VALUES(?,?,?,?,?,?,?,?)',
        taskId, teacher, status, '', '[]', mDone ? 1 : 0, tDone ? 1 : 0, at || '방금');
    }
  }

  // ── 전체 상담 업무: 반별 학생 로스터 엔트리 ──
  private mapCounsel(r: any) {
    const rawState = String(r.delivery_state || 'idle');
    const deliveryState: CounselDeliveryState = rawState === 'pending' || rawState === 'confirmed'
      ? rawState
      : (r.synced ? 'confirmed' : 'idle');
    const rawStage = String(r.delivery_stage || '');
    const deliveryStage: CounselDeliveryStage = rawStage === 'claimed' || rawStage === 'posting' || rawStage === 'confirmed'
      ? rawStage
      : (deliveryState === 'confirmed' ? 'confirmed' : (deliveryState === 'pending' ? 'posting' : ''));
    const rawBeforeCount = Number(r.delivery_before_count);
    const deliveryBeforeCount = Number.isInteger(rawBeforeCount) && rawBeforeCount >= 0 ? rawBeforeCount : null;
    const deliveryFingerprint = String(r.delivery_fingerprint || '');
    const deliveryDate = String(r.delivery_date || '');
    const deliveryAttemptedAt = String(r.delivery_attempted_at || '');
    const deliveryMessage = String(r.delivery_message || '');
    return {
      id: r.id, taskId: r.task_id, teacher: r.teacher, cls: r.cls, scode: r.scode,
      teacherTid: r.teacher_tid || '', classCode: r.class_code || '',
      student: r.student, phone: r.phone || '', subject: r.subject || '', content: r.content || '',
      synced: !!r.synced, syncedAt: r.synced_at || '', done: !!r.done,
      rosterActive: r.roster_active === undefined ? true : !!r.roster_active,
      rosterSourceMonth: r.roster_source_month || '', rosterSeenAt: r.roster_seen_at || '',
      rosterRemovedAt: r.roster_removed_at || '',
      deliveryState, deliveryStage, deliveryFingerprint, deliveryDate, deliveryBeforeCount,
      deliveryAttemptedAt, deliveryMessage,
      // 기존 화면이 사용하던 호환 필드. pending은 ERP POST 여부가 불확실하므로 항상 재전송 금지다.
      deliveryPending: deliveryState === 'pending',
      deliveryConfirmed: deliveryState === 'confirmed',
      delivery: {
        state: deliveryState,
        stage: deliveryStage,
        fingerprint: deliveryFingerprint,
        date: deliveryDate,
        beforeCount: deliveryBeforeCount,
        attemptedAt: deliveryAttemptedAt,
        message: deliveryMessage,
        doNotRetransmit: deliveryState === 'pending',
        // claimed는 primary 선점 이후 ERP POST 직전 증거 기록이 아직 완료되지 않은 유일한 상태다.
        safeToResetBeforePost: deliveryState === 'pending' && deliveryStage === 'claimed',
      },
    };
  }

  private mapCounselAbsence(r: any) {
    const state: CounselDeliveryState = r.delivery_state === 'confirmed' ? 'confirmed' : 'pending';
    const stage: CounselDeliveryStage = r.delivery_stage === 'claimed' || r.delivery_stage === 'posting' || r.delivery_stage === 'confirmed'
      ? r.delivery_stage
      : (state === 'confirmed' ? 'confirmed' : 'posting');
    const beforeCount = Number(r.delivery_before_count);
    return {
      id: r.id,
      entryId: r.entry_id,
      taskId: r.task_id,
      teacher: r.teacher,
      cls: r.cls,
      scode: r.scode,
      student: r.student,
      kind: '부재/문자',
      content: r.content || '',
      date: r.attempted_date,
      synced: !!r.synced,
      syncedAt: r.synced_at || '',
      deliveryState: state,
      deliveryStage: stage,
      deliveryFingerprint: r.delivery_fingerprint || '',
      deliveryBeforeCount: Number.isInteger(beforeCount) && beforeCount >= 0 ? beforeCount : null,
      deliveryAttemptedAt: r.delivery_attempted_at || '',
      deliveryMessage: r.delivery_message || '',
      deliveryPending: state === 'pending',
      deliveryConfirmed: state === 'confirmed',
      createdAt: r.created_at || '',
    };
  }

  private counselRowForReference(
    id: string,
    naturalKey?: Partial<CounselEntryNaturalKey>,
    connection: any = this.d(),
  ): any | null {
    const entryId = String(id || '').trim();
    const key = naturalKey ? {
      taskId: String(naturalKey.taskId || '').trim(),
      teacher: String(naturalKey.teacher || '').trim(),
      cls: String(naturalKey.cls || '').trim(),
      scode: String(naturalKey.scode || '').trim(),
    } : null;
    const keyValues = key ? Object.values(key) : [];
    const hasAnyKey = keyValues.some(Boolean);
    const hasCompleteKey = keyValues.length === 4 && keyValues.every(Boolean);
    if (hasAnyKey && !hasCompleteKey) throw new HttpError(400, '상담 대상 확인 정보가 불완전합니다. 목록을 새로고침해 주세요.');

    const direct = entryId ? this.primaryGet<any>(connection, 'SELECT * FROM counsel_entries WHERE id=? AND roster_active=1', entryId) : null;
    if (direct) {
      if (key && hasCompleteKey && (
        direct.task_id !== key.taskId || direct.teacher !== key.teacher ||
        direct.cls !== key.cls || direct.scode !== key.scode
      )) {
        throw new HttpError(409, '상담 대상 정보가 변경되었습니다. 목록을 새로고침해 주세요.');
      }
      return direct;
    }
    if (!key || !hasCompleteKey) return null;
    return this.primaryGet<any>(connection,
      'SELECT * FROM counsel_entries WHERE task_id=? AND teacher=? AND cls=? AND scode=? AND roster_active=1',
      key.taskId, key.teacher, key.cls, key.scode,
    ) || null;
  }

  /**
   * 오래된 화면의 entry id가 로스터 보존갱신으로 달라졌더라도 자연키가 정확히 일치할 때만 재해결한다.
   * id가 아직 존재하지만 자연키가 다르면 다른 학생으로 오인하지 않고 409를 반환한다.
   */
  resolveCounselEntry(id: string, naturalKey?: Partial<CounselEntryNaturalKey>) {
    const row = this.counselRowForReference(id, naturalKey);
    return row ? this.mapCounsel(row) : null;
  }

  /** 상담 업무 종류와 고정 로스터 월/반 목록. API가 일반·특강 로스터 소스를 분기할 때 사용한다. */
  private counselContextOn(connection: any, taskId: string, teacher: string): {
    kind: 'regular' | 'special';
    sourceMonth: string;
    classes: string[];
    regularClasses?: Array<{ className: string; dayGroup: SpecialDayGroup }>;
    selfManaged?: boolean;
  } {
    const task = this.primaryGet<any>(connection,
      `SELECT scope,counsel,special_counsel,special_source_month,special_assignees,
              self_managed,created_by_tid,self_source_month
       FROM tasks WHERE id=?`,
      taskId,
    );
    if (!task) throw new HttpError(400, '업무를 찾을 수 없습니다.');
    const mode = this.counselMode(!!task.counsel, !!task.special_counsel);
    if (mode === 'none') throw new HttpError(400, '상담 업무가 아닙니다.');
    const assignees = mode === 'special'
      ? uniqueNames(P(task.special_assignees, []))
      : this.taskAssigneesOn(connection, P(task.scope, 'all'));
    if (!assignees.includes(teacher)) throw new HttpError(400, '이 상담 업무에 배정되지 않은 강사입니다.');
    if (mode === 'special') {
      const sourceMonth = task.special_source_month || '';
      if (!isSourceMonth(sourceMonth)) throw new HttpError(400, '특강상담의 수강년월 정보가 없습니다.');
      const classes = this.connectionAll<any>(connection,
        'SELECT DISTINCT cls FROM counsel_entries WHERE task_id=? AND teacher=? AND roster_active=1 ORDER BY cls',
        taskId, teacher,
      ).map((r) => r.cls);
      return { kind: 'special', sourceMonth, classes };
    }
    if (task.self_managed) {
      const owner = this.primaryGet<any>(connection, 'SELECT tid,name,is_other_team FROM teachers WHERE tid=?', task.created_by_tid);
      if (!owner || !owner.is_other_team || owner.name !== teacher) {
        throw new HttpError(403, '다른 팀 상담일정의 소유자를 확인할 수 없습니다.');
      }
      const sourceMonth = String(task.self_source_month || '');
      const classes = this.connectionAll<any>(connection,
        `SELECT class_name FROM other_team_classes
         WHERE teacher_tid=? AND source_month=? ORDER BY class_name,class_code`,
        task.created_by_tid, sourceMonth,
      ).map((row) => String(row.class_name || '')).filter(Boolean);
      return { kind: 'regular', sourceMonth, classes: uniqueStrings(classes), selfManaged: true };
    }
    const row = this.primaryGet<any>(connection, 'SELECT classes FROM teachers WHERE name=?', teacher);
    const classes = row ? normalizeTeacherClasses(row.classes) : normalizeTeacherClasses({});
    const regularClasses = [
      ...classes['월수금반'].map((className) => ({ className, dayGroup: 'M' as const })),
      ...classes['화목토반'].map((className) => ({ className, dayGroup: 'T' as const })),
    ];
    return {
      kind: 'regular',
      sourceMonth: '',
      classes: uniqueStrings(regularClasses.map((entry) => entry.className)),
      regularClasses,
    };
  }

  getCounselContext(taskId: string, teacher: string): {
    kind: 'regular' | 'special';
    sourceMonth: string;
    classes: string[];
    regularClasses?: Array<{ className: string; dayGroup: SpecialDayGroup }>;
    selfManaged?: boolean;
  } {
    return this.counselContextOn(this.d(), taskId, teacher);
  }

  counselRosterMembershipSignature(rows: CounselRosterMembership[]): string {
    return counselRosterMembershipSignature(rows);
  }

  /** 파괴적 정규 상담 reconcile 판정용. 실제 reconcile과 동일한 tid/레거시-name 범위를 원격 primary에서 읽는다. */
  getActiveCounselRosterMembershipOnPrimary(input: {
    taskId: string;
    teacher: string;
    teacherTid: string;
    kind: 'regular';
  }): CounselRosterMembership[] {
    return this.db.withCounselSnapshotPrimary((primary) => {
      const read = primary.transaction(() => {
        this.counselRosterTargetOn(primary, input);
        return this.connectionAll<any>(primary,
          `SELECT cls,class_code,scode FROM counsel_entries
           WHERE task_id=? AND roster_active=1
             AND (teacher_tid=? OR (teacher_tid='' AND teacher=?))
           ORDER BY class_code,scode`,
          input.taskId, input.teacherTid, input.teacher,
        ).map((row) => ({
          classCode: String(row.class_code || '').trim(),
          className: String(row.cls || '').trim(),
          scode: String(row.scode || '').trim(),
        }));
      });
      return read();
    });
  }

  private mapSpecialRoster(r: any) {
    return {
      sourceMonth: r.source_month,
      classCode: r.class_code,
      className: r.class_name,
      teacherTid: r.teacher_tid,
      teacherName: r.teacher_name,
      dayGroup: r.day_group as SpecialDayGroup,
      scode: r.scode,
      student: r.student,
      motherPhone: r.mother_phone || '',
      syncedAt: r.synced_at || '',
    };
  }

  /** 월별 특강 스냅샷 조회. teacher/cls를 생략하면 운영 진단용 전체 월 로스터를 반환한다. */
  getSpecialRoster(sourceMonth: string, teacher?: string, cls?: string) {
    if (!isSourceMonth(sourceMonth)) throw new HttpError(400, '수강년월 형식이 올바르지 않습니다.');
    let sql = 'SELECT * FROM special_class_roster WHERE source_month=?';
    const params: any[] = [sourceMonth];
    if (teacher) { sql += ' AND teacher_name=?'; params.push(teacher); }
    if (cls) { sql += ' AND class_name=?'; params.push(cls); }
    sql += ' ORDER BY day_group,class_name,student,scode';
    return this.db.all<any>(sql, ...params).map((r) => this.mapSpecialRoster(r));
  }

  /** 특강상담 생성 시 counsel_entries에 고정한 해당 강사/반 로스터만 조회한다. */
  getSpecialRosterForTask(taskId: string, teacher: string, cls?: string) {
    const context = this.getCounselContext(taskId, teacher);
    if (context.kind !== 'special') throw new HttpError(400, '특강상담 업무가 아닙니다.');
    if (cls && !context.classes.includes(cls)) throw new HttpError(400, '이 특강상담 업무에 배정되지 않은 반입니다.');
    return this.getCounselEntries(taskId, teacher, cls).map((entry) => ({
      sourceMonth: context.sourceMonth,
      className: entry.cls,
      teacherName: teacher,
      scode: entry.scode,
      student: entry.student,
      motherPhone: entry.phone,
      syncedAt: entry.syncedAt,
    }));
  }

  /** 상세 원생 API 연락처를 업무의 고정 엔트리에 보강한다. 빈 연락처는 기존 값을 지우지 않는다. */
  updateSpecialRosterContactsForTask(
    taskId: string,
    teacher: string,
    cls: string,
    contacts: Array<{ scode: string; motherPhone?: string; phone?: string; student?: string; name?: string }>,
  ) {
    const context = this.getCounselContext(taskId, teacher);
    if (context.kind !== 'special') throw new HttpError(400, '특강상담 업무가 아닙니다.');
    if (!context.classes.includes(cls)) throw new HttpError(400, '이 특강상담 업무에 배정되지 않은 반입니다.');
    const tx = this.d().transaction(() => {
      for (const contact of contacts || []) {
        const scode = String(contact.scode || '').trim();
        if (!scode) continue;
        const phone = String(contact.motherPhone ?? contact.phone ?? '').trim();
        if (!phone) continue;
        this.db.run(
          'UPDATE counsel_entries SET phone=? WHERE task_id=? AND teacher=? AND cls=? AND scode=?',
          phone, taskId, teacher, cls, scode,
        );
        // 월간 캐시에도 보강해 이후 생성되는 특강상담 업무가 같은 연락처를 재사용하게 한다.
        this.db.run(
          'UPDATE special_class_roster SET mother_phone=? WHERE source_month=? AND teacher_name=? AND class_name=? AND scode=?',
          phone, context.sourceMonth, teacher, cls, scode,
        );
      }
    });
    tx();
    return this.getSpecialRosterForTask(taskId, teacher, cls);
  }

  /** API 호환용: 생성 시 이미 고정한 특강 엔트리를 그대로 반환한다. */
  upsertSpecialCounselRoster(taskId: string, teacher: string, cls: string) {
    const rows = this.getSpecialRosterForTask(taskId, teacher, cls);
    return {
      entries: this.getCounselEntries(taskId, teacher, cls),
      rosterCount: rows.length,
      missingPhoneCount: rows.filter((r) => !r.motherPhone).length,
      sourceMonth: rows[0]?.sourceMonth || this.getCounselContext(taskId, teacher).sourceMonth,
    };
  }

  private counselEntriesOn(connection: any, taskId: string, teacher: string, cls?: string) {
    const rows = cls
      ? this.connectionAll<any>(connection, 'SELECT * FROM counsel_entries WHERE task_id=? AND teacher=? AND cls=? AND roster_active=1 ORDER BY student', taskId, teacher, cls)
      : this.connectionAll<any>(connection, 'SELECT * FROM counsel_entries WHERE task_id=? AND teacher=? AND roster_active=1 ORDER BY cls, student', taskId, teacher);
    const attempts = this.counselAbsenceAttemptsOn(connection, taskId, teacher, cls);
    const byStudent = new Map<string, any[]>();
    for (const attempt of attempts) {
      const key = `${attempt.cls}\n${attempt.scode}`;
      const group = byStudent.get(key) || [];
      group.push(attempt);
      byStudent.set(key, group);
    }
    return rows.map((r) => {
      const entry = this.mapCounsel(r);
      const absenceAttempts = byStudent.get(`${r.cls}\n${r.scode}`) || [];
      return {
        ...entry,
        absenceCount: absenceAttempts.filter((attempt) => attempt.deliveryStage === 'posting' || attempt.deliveryConfirmed).length,
        absencePendingCount: absenceAttempts.filter((attempt) => attempt.deliveryPending).length,
        absenceAttempts,
      };
    });
  }

  getCounselEntries(taskId: string, teacher: string, cls?: string) {
    return this.counselEntriesOn(this.d(), taskId, teacher, cls);
  }

  private counselAbsenceAttemptsOn(connection: any, taskId: string, teacher: string, cls?: string) {
    const rows = cls
      ? this.connectionAll<any>(connection,
        'SELECT * FROM counsel_absence_attempts WHERE task_id=? AND teacher=? AND cls=? ORDER BY attempted_date DESC,created_at DESC,id DESC',
        taskId, teacher, cls,
      )
      : this.connectionAll<any>(connection,
        'SELECT * FROM counsel_absence_attempts WHERE task_id=? AND teacher=? ORDER BY attempted_date DESC,created_at DESC,id DESC',
        taskId, teacher,
      );
    return rows.map((row) => this.mapCounselAbsence(row));
  }

  getCounselAbsenceAttempts(taskId: string, teacher: string, cls?: string) {
    return this.counselAbsenceAttemptsOn(this.d(), taskId, teacher, cls);
  }

  /**
   * 특강상담 생성 직후에도 stale replica를 거치지 않고 원격 원본의 한 업무/강사만 읽는다.
   * 반환 필드는 기존 상담 GET과 동일하며 다른 강사나 월간 전체 로스터는 포함하지 않는다.
   */
  getCounselSnapshotOnPrimary(taskId: string, teacher: string, cls?: string) {
    return this.db.withCounselSnapshotPrimary((primary) => {
      const read = primary.transaction(() => {
        const context = this.counselContextOn(primary, taskId, teacher);
        const entries = this.counselEntriesOn(primary, taskId, teacher, cls);
        if (context.kind === 'regular') {
          // prepare가 확인한 현재 ERP 로스터가 정규 상담 반 목록의 진실이다. teachers.classes는
          // 별도 반 배정 화면의 이전 스냅샷일 수 있어 새 반의 연락처 동기화를 막는 권한 근거로 쓰지 않는다.
          const activeClasses = this.connectionAll<any>(primary,
            `SELECT DISTINCT cls FROM counsel_entries
             WHERE task_id=? AND teacher=? AND roster_active=1 ORDER BY cls`,
            taskId, teacher,
          ).map((row) => String(row.cls || '')).filter(Boolean);
          // cls 필터로 한 반만 열었더라도 강사의 다른 활성 반과 월이 섞인 상태를 숨기지 않는다.
          const months = Array.from(new Set(this.connectionAll<any>(primary,
            `SELECT roster_source_month FROM counsel_entries
             WHERE task_id=? AND teacher=? AND roster_active=1`,
            taskId, teacher,
          ).map((row) => String(row.roster_source_month || '').trim())));
          if (months.length > 1) {
            throw new HttpError(409, '일반 상담 학생 목록의 수강년월이 서로 다릅니다. 학생 목록을 다시 동기화해 주세요.');
          }
          return { ...context, sourceMonth: months[0] || '', classes: activeClasses, entries };
        }
        return { ...context, entries };
      });
      return read();
    });
  }

  private counselRosterTargetOn(
    connection: any,
    input: { taskId: string; teacher: string; teacherTid: string; kind: 'special' | 'regular' },
  ) {
    const task = this.primaryGet<any>(connection,
      'SELECT id,scope,counsel,special_counsel,special_source_month,special_assignees FROM tasks WHERE id=?',
      input.taskId,
    );
    if (!task) throw new HttpError(400, '업무를 찾을 수 없습니다.');
    const actualKind = this.counselMode(!!task.counsel, !!task.special_counsel);
    if (actualKind === 'none') throw new HttpError(400, '상담 업무가 아닙니다.');
    if (actualKind !== input.kind) {
      throw new HttpError(409, '상담 업무 종류가 변경되었습니다. 목록을 새로고침해 주세요.');
    }
    const exactNameCount = Number(this.primaryGet<any>(connection,
      'SELECT COUNT(*) count FROM teachers WHERE name=?',
      input.teacher,
    )?.count || 0);
    if (exactNameCount !== 1) {
      throw new HttpError(409, '같은 이름의 강사 계정을 유일하게 확인할 수 없어 학생 명단을 변경하지 않았습니다.');
    }
    const teacherRow = this.primaryGet<any>(connection, 'SELECT tid,name FROM teachers WHERE tid=?', input.teacherTid);
    if (!teacherRow || String(teacherRow.name || '') !== input.teacher) {
      throw new HttpError(409, '강사 정보가 변경되었습니다. 강사 목록을 새로고침해 주세요.');
    }
    const assignees = actualKind === 'special'
      ? uniqueNames(P(task.special_assignees, []))
      : this.taskAssigneesOn(connection, P(task.scope, 'all'));
    if (!assignees.includes(input.teacher)) {
      throw new HttpError(400, '이 상담 업무에 배정되지 않은 강사입니다.');
    }
    return task;
  }

  private normalizedCounselRosterSnapshot(input: CounselRosterReconcileInput) {
    const taskId = String(input.taskId || '').trim();
    const teacher = String(input.teacher || '').trim();
    const teacherTid = String(input.teacherTid || '').trim();
    const sourceMonth = String(input.sourceMonth || '').trim();
    const syncedAt = String(input.syncedAt || '').trim();
    const confirmedRemovalSignature = String(input.confirmedRemovalSignature || '').trim();
    if (!taskId || !teacher || !teacherTid) throw new HttpError(400, '상담 로스터 대상 정보가 불완전합니다.');
    if (input.kind !== 'special' && input.kind !== 'regular') throw new HttpError(400, '상담 업무 종류를 확인해 주세요.');
    if (!isSourceMonth(sourceMonth)) throw new HttpError(400, '수강년월 형식이 올바르지 않습니다.');
    if (!syncedAt || syncedAt.length > 100) throw new HttpError(400, '로스터 동기화 시각을 확인해 주세요.');
    if (!Array.isArray(input.classes) || input.classes.length > MAX_COUNSEL_ROSTER_CLASSES) {
      throw new HttpError(400, `상담 로스터 반은 최대 ${MAX_COUNSEL_ROSTER_CLASSES}개까지 동기화할 수 있습니다.`);
    }

    const classes: CounselRosterSnapshotClassInput[] = [];
    const classNames = new Map<string, string>();
    const classCodes = new Map<string, string>();
    let studentCount = 0;
    for (const rawClass of input.classes) {
      const classCode = String(rawClass?.classCode || '').trim();
      const className = String(rawClass?.className || '').trim();
      if (!classCode || !className || classCode.length > 200 || className.length > 300) {
        throw new HttpError(400, '통통통 반 코드 또는 반명을 확인해 주세요.');
      }
      const knownName = classNames.get(classCode);
      if (knownName && knownName !== className) {
        throw new HttpError(409, '같은 통통통 반 코드에 서로 다른 반명이 포함되어 있습니다. 다시 동기화해 주세요.');
      }
      classNames.set(classCode, className);
      const knownCode = classCodes.get(className);
      if (knownCode && knownCode !== classCode) {
        throw new HttpError(409, '같은 통통통 반명에 서로 다른 반 코드가 포함되어 있습니다. 다시 동기화해 주세요.');
      }
      classCodes.set(className, classCode);
      if (!Array.isArray(rawClass.students)) throw new HttpError(400, '반별 학생 목록을 확인해 주세요.');
      const students: CounselRosterSnapshotStudentInput[] = [];
      const seenStudents = new Map<string, string>();
      for (const rawStudent of rawClass.students) {
        const scode = String(rawStudent?.scode || '').trim();
        const student = String(rawStudent?.student || '').trim();
        if (!scode || !student || scode.length > 200 || student.length > 200) {
          throw new HttpError(400, '통통통 학생 코드 또는 학생명을 확인해 주세요.');
        }
        const knownStudent = seenStudents.get(scode);
        if (knownStudent && knownStudent !== student) {
          throw new HttpError(409, '같은 통통통 학생 코드에 서로 다른 이름이 포함되어 있습니다. 다시 동기화해 주세요.');
        }
        if (!knownStudent) {
          seenStudents.set(scode, student);
          students.push({ scode, student });
          studentCount += 1;
          if (studentCount > MAX_COUNSEL_ROSTER_STUDENTS) {
            throw new HttpError(400, `상담 로스터 학생은 최대 ${MAX_COUNSEL_ROSTER_STUDENTS}명까지 동기화할 수 있습니다.`);
          }
        }
      }
      // 같은 반 코드가 페이지 조각으로 중복 전달되면 학생을 합치되 상충 데이터는 위에서 거부한다.
      const existingClass = classes.find((item) => item.classCode === classCode);
      if (existingClass) {
        const existingScodes = new Set(existingClass.students.map((student) => student.scode));
        for (const student of students) if (!existingScodes.has(student.scode)) existingClass.students.push(student);
      } else {
        classes.push({ classCode, className, students });
      }
    }
    return {
      taskId, teacher, teacherTid, kind: input.kind, sourceMonth, syncedAt, classes,
      confirmedRemovalSignature,
    };
  }

  /**
   * 현재 ERP 반별 원생목록을 상담 업무에 이력 보존 방식으로 반영한다.
   * class_code+scode를 먼저 재사용하고, 코드가 월별로 교체됐을 때는 유일한 cls+scode 이력을 승계한다.
   */
  reconcileCounselRosterSnapshotOnPrimary(input: CounselRosterReconcileInput) {
    const normalized = this.normalizedCounselRosterSnapshot(input);
    let result: any;
    try {
      result = this.db.withCounselRosterPrimary((primary) => {
        const tx = primary.transaction(() => {
          const task = this.counselRosterTargetOn(primary, normalized);
          const existing = this.connectionAll<any>(primary,
            `SELECT * FROM counsel_entries
             WHERE task_id=? AND (teacher_tid=? OR (teacher_tid='' AND teacher=?))
             ORDER BY roster_active DESC,id`,
            normalized.taskId, normalized.teacherTid, normalized.teacher,
          );
          const pendingAbsenceEntryIds = new Set(this.connectionAll<any>(primary,
            `SELECT DISTINCT entry_id FROM counsel_absence_attempts
             WHERE task_id=? AND delivery_state='pending'`,
            normalized.taskId,
          ).map((row) => String(row.entry_id || '')));
          const byStableKey = new Map<string, any[]>();
          const byNaturalKey = new Map<string, any[]>();
          for (const row of existing) {
            if (row.class_code) {
              const key = `${row.class_code}\n${row.scode}`;
              const stableRows = byStableKey.get(key) || [];
              stableRows.push(row);
              byStableKey.set(key, stableRows);
            }
            const naturalKey = `${row.cls}\n${row.scode}`;
            const naturalRows = byNaturalKey.get(naturalKey) || [];
            naturalRows.push(row);
            byNaturalKey.set(naturalKey, naturalRows);
          }

          const matchedIds: string[] = [];
          const matchedIdSet = new Set<string>();
          let added = 0;
          let updated = 0;
          let reactivated = 0;
          const insert = primary.prepare(
            `INSERT INTO counsel_entries(
               id,task_id,teacher,teacher_tid,cls,class_code,scode,student,phone,subject,content,
               synced,synced_at,done,roster_active,roster_source_month,roster_seen_at,roster_removed_at
             ) VALUES(?,?,?,?,?,?,?,?,?,'','',0,'',0,1,?,?,'')`,
          );
          const update = primary.prepare(
            `UPDATE counsel_entries
             SET teacher=?,teacher_tid=?,cls=?,class_code=?,student=?,roster_active=1,
                 roster_source_month=?,roster_seen_at=?,roster_removed_at=''
             WHERE id=?`,
          );
          const updateLockedLifecycle = primary.prepare(
            `UPDATE counsel_entries
             SET roster_active=1,roster_source_month=?,roster_seen_at=?,roster_removed_at=''
             WHERE id=?`,
          );
          const restoreLockedSpecialClassCode = primary.prepare(
            `UPDATE counsel_entries SET class_code=?
             WHERE id=? AND COALESCE(TRIM(class_code),'')=''`,
          );
          const updateAttemptIdentity = primary.prepare(
            `UPDATE counsel_absence_attempts SET teacher=?,cls=?,student=? WHERE entry_id=?`,
          );

          for (const cls of normalized.classes) {
            for (const student of cls.students) {
              const stableKey = `${cls.classCode}\n${student.scode}`;
              const naturalKey = `${cls.className}\n${student.scode}`;
              const stableCandidates = byStableKey.get(stableKey) || [];
              if (stableCandidates.length > 1) {
                throw new HttpError(409, '기존 상담 이력에서 같은 반 코드·학생을 유일하게 확인할 수 없어 명단을 변경하지 않았습니다.');
              }
              let row = stableCandidates[0];
              if (!row) {
                const candidates = (byNaturalKey.get(naturalKey) || [])
                  .filter((candidate) => !matchedIdSet.has(String(candidate.id)));
                if (candidates.length > 1) {
                  throw new HttpError(409, '기존 상담 이력에서 같은 반·학생을 유일하게 확인할 수 없어 명단을 변경하지 않았습니다.');
                }
                row = candidates[0];
              }
              if (!row) {
                const id = uid('ce');
                insert.run(
                  id, normalized.taskId, normalized.teacher, normalized.teacherTid,
                  cls.className, cls.classCode, student.scode, student.student, '',
                  normalized.sourceMonth, normalized.syncedAt,
                );
                matchedIds.push(id);
                matchedIdSet.add(id);
                added += 1;
                continue;
              }
              if (matchedIdSet.has(String(row.id))) {
                throw new HttpError(409, '같은 상담 이력이 최신 명단의 여러 학생 항목과 겹쳐 명단을 변경하지 않았습니다.');
              }
              matchedIds.push(row.id);
              matchedIdSet.add(String(row.id));
              const identityChanged = row.teacher !== normalized.teacher
                || row.teacher_tid !== normalized.teacherTid
                || row.cls !== cls.className
                || row.class_code !== cls.classCode
                || row.student !== student.student;
              if (!row.roster_active) reactivated += 1;
              const identityLocked = row.delivery_state === 'pending' || pendingAbsenceEntryIds.has(String(row.id));
              if (identityLocked) {
                // ERP reconciliation must keep using the exact identity captured before its non-idempotent POST.
                // class_code is not sent to ERP and is used only for the later contact join. Old special-counsel
                // rows can legitimately lack it, so restore only that empty internal key when the current ERP
                // snapshot proves the same assigned teacher, class name and student code. All outbound identity
                // and delivery evidence remains frozen until the pending attempt resolves.
                if (normalized.kind === 'special'
                  && !String(row.class_code || '').trim()
                  && row.teacher === normalized.teacher
                  && row.teacher_tid === normalized.teacherTid
                  && row.cls === cls.className) {
                  const restored = Number(restoreLockedSpecialClassCode.run(cls.classCode, row.id).changes || 0);
                  updated += restored;
                }
                updateLockedLifecycle.run(normalized.sourceMonth, normalized.syncedAt, row.id);
                continue;
              }
              if (identityChanged) updated += 1;
              update.run(
                normalized.teacher, normalized.teacherTid, cls.className, cls.classCode, student.student,
                normalized.sourceMonth, normalized.syncedAt, row.id,
              );
              if (row.teacher !== normalized.teacher || row.cls !== cls.className || row.student !== student.student) {
                updateAttemptIdentity.run(normalized.teacher, cls.className, student.student, row.id);
              }
            }
          }

          // 이름만 있는 레거시 행은 유일 강사에게 채택하되, ERP 확인 중인
          // identity는 원본 증거를 유지하도록 해소 전에는 tid도 바꾸지 않는다.
          primary.prepare(
            `UPDATE counsel_entries SET teacher_tid=?
             WHERE task_id=? AND teacher_tid='' AND teacher=?
               AND COALESCE(delivery_state,'idle')<>'pending'
               AND NOT EXISTS (
                 SELECT 1 FROM counsel_absence_attempts a
                 WHERE a.entry_id=counsel_entries.id AND a.delivery_state='pending'
               )`,
          ).run(normalized.teacherTid, normalized.taskId, normalized.teacher);

          const rowsToInactivate = existing.filter((row) =>
            !!row.roster_active
            && !matchedIdSet.has(String(row.id))
            && row.delivery_state !== 'pending'
            && !pendingAbsenceEntryIds.has(String(row.id)));
          if (normalized.kind === 'regular' && rowsToInactivate.length) {
            const incomingMembership = normalized.classes.flatMap((cls) =>
              cls.students.map((student) => ({ classCode: cls.classCode, scode: student.scode })));
            const expectedSignature = counselRosterMembershipSignature(incomingMembership);
            if (!normalized.confirmedRemovalSignature
              || normalized.confirmedRemovalSignature !== expectedSignature) {
              throw new HttpError(
                409,
                '기존 활성 학생을 제외하는 명단의 2회 확인 정보를 검증할 수 없어 기존 명단을 변경하지 않았습니다.',
              );
            }
          }

          let inactivateSql =
            `UPDATE counsel_entries
             SET roster_active=0,roster_removed_at=?
             WHERE task_id=? AND teacher_tid=? AND roster_active=1
               AND COALESCE(delivery_state,'idle')<>'pending'
               AND NOT EXISTS (
                 SELECT 1 FROM counsel_absence_attempts a
                 WHERE a.entry_id=counsel_entries.id AND a.delivery_state='pending'
               )`;
          const inactivateParams: any[] = [normalized.syncedAt, normalized.taskId, normalized.teacherTid];
          if (matchedIds.length) {
            inactivateSql += ` AND id NOT IN (${matchedIds.map(() => '?').join(',')})`;
            inactivateParams.push(...matchedIds);
          }
          const inactivated = Number(primary.prepare(inactivateSql).run(...inactivateParams).changes || 0);

          if (normalized.kind === 'special' && task.special_source_month !== normalized.sourceMonth) {
            primary.prepare('UPDATE tasks SET special_source_month=? WHERE id=?')
              .run(normalized.sourceMonth, normalized.taskId);
          }

          const entries = this.counselEntriesOn(primary, normalized.taskId, normalized.teacher);
          const countsRow = this.primaryGet<any>(primary,
            `SELECT COUNT(*) total,
                    SUM(CASE WHEN roster_active=1 THEN 1 ELSE 0 END) active,
                    SUM(CASE WHEN roster_active=0 THEN 1 ELSE 0 END) inactive
             FROM counsel_entries
             WHERE task_id=? AND (teacher_tid=? OR (teacher_tid='' AND teacher=?))`,
            normalized.taskId, normalized.teacherTid, normalized.teacher,
          ) || {};
          return {
            taskId: normalized.taskId,
            teacher: normalized.teacher,
            teacherTid: normalized.teacherTid,
            kind: normalized.kind,
            sourceMonth: normalized.sourceMonth,
            syncedAt: normalized.syncedAt,
            entries,
            classes: uniqueStrings(normalized.classes.map((item) => item.className)),
            added,
            updated,
            inactivated,
            reactivated,
            counts: {
              active: Number(countsRow.active || 0),
              inactive: Number(countsRow.inactive || 0),
              total: Number(countsRow.total || 0),
              classes: normalized.classes.length,
            },
          };
        });
        return tx();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE constraint failed:\s*counsel_entries/i.test(message)) {
        throw new HttpError(409, '기존 상담 이력과 최신 반 정보가 충돌했습니다. 데이터는 변경하지 않았습니다.');
      }
      throw error;
    }
    this.db.refreshCounselRosterReplica();
    return result;
  }

  /** 상세 ERP 조회에 성공한 학생만 전화번호를 갱신한다. 성공한 빈 값은 명시적 삭제이고 실패는 보존이다. */
  updateCounselRosterContactsOnPrimary(input: CounselRosterContactsUpdateInput) {
    const taskId = String(input.taskId || '').trim();
    const teacher = String(input.teacher || '').trim();
    const teacherTid = String(input.teacherTid || '').trim();
    const sourceMonth = String(input.sourceMonth || '').trim();
    if (!taskId || !teacher || !teacherTid) throw new HttpError(400, '상담 연락처 대상 정보가 불완전합니다.');
    if (input.kind !== 'special' && input.kind !== 'regular') throw new HttpError(400, '상담 업무 종류를 확인해 주세요.');
    if (!isSourceMonth(sourceMonth)) throw new HttpError(400, '수강년월 형식이 올바르지 않습니다.');
    if (!Array.isArray(input.contacts) || input.contacts.length > MAX_COUNSEL_ROSTER_STUDENTS) {
      throw new HttpError(400, '상담 연락처 목록을 확인해 주세요.');
    }
    const contacts: CounselRosterContactInput[] = [];
    const seen = new Map<string, string>();
    for (const raw of input.contacts) {
      const classCode = String(raw?.classCode || '').trim();
      const scode = String(raw?.scode || '').trim();
      const motherPhone = String(raw?.motherPhone ?? '').trim();
      if (!classCode || !scode || typeof raw?.success !== 'boolean') {
        throw new HttpError(400, '학생 연락처 조회 결과를 확인해 주세요.');
      }
      const key = `${classCode}\n${scode}`;
      const signature = J([raw.success, motherPhone]);
      if (seen.has(key) && seen.get(key) !== signature) {
        throw new HttpError(409, '같은 학생의 연락처 조회 결과가 서로 다릅니다. 다시 동기화해 주세요.');
      }
      if (!seen.has(key)) {
        seen.set(key, signature);
        contacts.push({ classCode, scode, motherPhone, success: raw.success });
      }
    }

    const result = this.db.withCounselRosterPrimary((primary) => {
      const tx = primary.transaction(() => {
        const task = this.counselRosterTargetOn(primary, { taskId, teacher, teacherTid, kind: input.kind });
        if (input.kind === 'special' && String(task.special_source_month || '') !== sourceMonth) {
          throw new HttpError(409, '특강 수강년월이 변경되었습니다. 학생 목록을 다시 동기화해 주세요.');
        }
        const mismatchedMonth = Number(this.primaryGet<any>(primary,
          `SELECT COUNT(*) count FROM counsel_entries
           WHERE task_id=? AND teacher_tid=? AND roster_active=1 AND roster_source_month<>?`,
          taskId, teacherTid, sourceMonth,
        )?.count || 0);
        if (mismatchedMonth) {
          throw new HttpError(409, '학생 로스터의 수강년월이 변경되었습니다. 학생 목록을 다시 동기화해 주세요.');
        }

        let updated = 0;
        let cleared = 0;
        let preserved = 0;
        let missing = 0;
        for (const contact of contacts) {
          const row = this.primaryGet<any>(primary,
            `SELECT id,phone FROM counsel_entries
             WHERE task_id=? AND teacher_tid=? AND class_code=? AND scode=? AND roster_active=1`,
            taskId, teacherTid, contact.classCode, contact.scode,
          );
          if (!row) {
            missing += 1;
            continue;
          }
          if (!contact.success) {
            preserved += 1;
            continue;
          }
          if (String(row.phone || '') !== contact.motherPhone) {
            primary.prepare('UPDATE counsel_entries SET phone=? WHERE id=?').run(contact.motherPhone, row.id);
            updated += 1;
            if (!contact.motherPhone) cleared += 1;
          }
          if (input.kind === 'special') {
            primary.prepare(
              `UPDATE special_class_roster SET mother_phone=?
               WHERE source_month=? AND teacher_tid=? AND class_code=? AND scode=?`,
            ).run(contact.motherPhone, sourceMonth, teacherTid, contact.classCode, contact.scode);
          }
        }
        const entries = this.counselEntriesOn(primary, taskId, teacher);
        const counts = entries.reduce((summary, entry) => {
          summary.active += 1;
          if (entry.phone) summary.withPhone += 1;
          else summary.withoutPhone += 1;
          return summary;
        }, { active: 0, total: 0, withPhone: 0, withoutPhone: 0 });
        counts.total = Number(this.primaryGet<any>(primary,
          'SELECT COUNT(*) count FROM counsel_entries WHERE task_id=? AND teacher_tid=?',
          taskId, teacherTid,
        )?.count || 0);
        return { entries, updated, cleared, preserved, missing, counts };
      });
      return tx();
    });
    this.db.refreshCounselRosterReplica();
    return result;
  }

  getCounselAbsenceAttempt(id: string) {
    const row = this.db.get<any>('SELECT * FROM counsel_absence_attempts WHERE id=?', id);
    return row ? this.mapCounselAbsence(row) : null;
  }

  /**
   * 부재/문자 한 건을 deterministic requestId로 생성하고 ERP POST 권한을 선점한다.
   * 같은 요청 재시도는 같은 attempt를 반환하며 학생·내용·날짜가 달라지면 409로 거부한다.
   */
  beginCounselAbsenceDelivery(
    entryId: string,
    naturalKey: Partial<CounselEntryNaturalKey> | undefined,
    draft: CounselAbsenceDraft,
    requestActor: string,
  ): { action: CounselDeliveryBeginAction; fingerprint: string; claimToken: string; entry: any; attempt: any } {
    const requestId = String(draft.requestId || '').trim();
    const actor = String(requestActor || '').trim();
    const content = String(draft.content || '').trim();
    const date = String(draft.date || '').trim();
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) throw new HttpError(400, '부재 상담 요청 ID를 확인해 주세요.');
    if (!actor) throw new HttpError(400, '부재 상담 요청자를 확인해 주세요.');
    if (!content) throw new HttpError(400, '부재/문자 내용을 입력해 주세요.');
    if (!isIsoDate(date)) throw new HttpError(400, '부재 상담 날짜 형식이 올바르지 않습니다.');
    const id = `ca${createHash('sha256')
      .update('npr-counsel-absence-v1\n').update(actor).update('\n').update(requestId)
      .digest('hex').slice(0, 16)}`;
    const fingerprint = counselDeliveryFingerprint({ subject: '부재/문자', content, date });
    const attemptedAt = String(draft.attemptedAt || new Date().toISOString());
    const claimToken = randomUUID();
    const result = this.withCounselDeliveryPrimary((primary) => {
      const entry = this.counselRowForReference(entryId, naturalKey, primary);
      if (!entry) throw new HttpError(400, '상담 항목을 찾을 수 없습니다. 목록을 새로고침해 주세요.');
      primary.prepare(
        `INSERT OR IGNORE INTO counsel_absence_attempts(
           id,entry_id,task_id,teacher,cls,scode,student,kind,content,attempted_date,
           synced,synced_at,delivery_state,delivery_stage,delivery_claim_token,
           delivery_fingerprint,delivery_before_count,delivery_attempted_at,delivery_message,created_at
         )
         SELECT ?,?,?,?,?,?,?,?,?,?,0,'','pending','claimed',?,?,-1,?,?,?
         WHERE NOT EXISTS (
           SELECT 1 FROM counsel_absence_attempts
           WHERE entry_id=? AND delivery_state='pending'
         )`,
      ).run(
        id, entry.id, entry.task_id, entry.teacher, entry.cls, entry.scode, entry.student,
        '부재/문자', content, date, claimToken, fingerprint, attemptedAt,
        '통통통 부재/문자 전송을 준비했습니다. 같은 기록을 다시 전송하지 마세요.', attemptedAt,
        entry.id,
      );
      const attempt = this.primaryGet<any>(primary, 'SELECT * FROM counsel_absence_attempts WHERE id=?', id);
      if (!attempt) {
        const pending = this.primaryGet<any>(primary,
          `SELECT id FROM counsel_absence_attempts
           WHERE entry_id=? AND delivery_state='pending'
           ORDER BY created_at,id LIMIT 1`,
          entry.id,
        );
        if (pending) {
          throw new HttpError(409, '이 학생의 부재/문자 전송 결과를 확인 중입니다. 결과가 확정될 때까지 다시 전송할 수 없습니다.');
        }
        throw new HttpError(500, '부재 상담 기록을 준비하지 못했습니다.');
      }
      const sameDefinition = attempt.entry_id === entry.id
        && attempt.task_id === entry.task_id
        && attempt.teacher === entry.teacher
        && attempt.cls === entry.cls
        && attempt.scode === entry.scode
        && attempt.content === content
        && attempt.attempted_date === date
        && attempt.delivery_fingerprint === fingerprint;
      if (!sameDefinition) {
        throw new HttpError(409, '같은 부재 상담 요청 ID에 다른 내용을 사용할 수 없습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.');
      }
      const action: CounselDeliveryBeginAction = attempt.delivery_state === 'confirmed'
        ? 'confirmed'
        : attempt.delivery_claim_token === claimToken && attempt.delivery_stage === 'claimed'
          ? 'send'
          : 'pending';
      return { action, claimToken: action === 'send' ? claimToken : '', entry, attempt };
    }, true);
    return {
      action: result.action,
      fingerprint,
      claimToken: result.claimToken,
      entry: this.mapCounsel(result.entry),
      attempt: this.mapCounselAbsence(result.attempt),
    };
  }

  recordCounselAbsenceBeforePost(
    id: string,
    fingerprint: string,
    claimToken: string,
    evidence: { beforeCount?: number | null; message?: string } = {},
  ) {
    const ownerToken = String(claimToken || '').trim();
    if (!ownerToken) throw new HttpError(409, '부재 상담 전송 선점 정보가 없습니다.');
    const row = this.withCounselDeliveryPrimary((primary) => {
      const current = this.primaryGet<any>(primary, 'SELECT * FROM counsel_absence_attempts WHERE id=?', id);
      if (!current) throw new HttpError(400, '부재 상담 기록을 찾을 수 없습니다.');
      if (current.delivery_state === 'confirmed' && current.delivery_fingerprint === fingerprint) return current;
      if (current.delivery_state !== 'pending' || current.delivery_stage !== 'claimed'
        || current.delivery_fingerprint !== fingerprint || current.delivery_claim_token !== ownerToken) {
        throw new HttpError(409, '부재 상담 전송 상태가 변경되었습니다. 다시 전송하지 마세요.');
      }
      const beforeCount = Number.isInteger(evidence.beforeCount) && Number(evidence.beforeCount) >= 0
        ? Number(evidence.beforeCount) : -1;
      const updated = primary.prepare(
        `UPDATE counsel_absence_attempts
         SET delivery_stage='posting',delivery_before_count=?,delivery_message=?
         WHERE id=? AND delivery_state='pending' AND delivery_stage='claimed'
           AND delivery_fingerprint=? AND delivery_claim_token=?`,
      ).run(
        beforeCount,
        String(evidence.message || '통통통 부재/문자 전송을 시작했습니다. 같은 기록을 다시 전송하지 마세요.'),
        id, fingerprint, ownerToken,
      );
      if (updated.changes !== 1) throw new HttpError(409, '부재 상담 전송 단계가 동시에 변경되었습니다.');
      return this.primaryGet<any>(primary, 'SELECT * FROM counsel_absence_attempts WHERE id=?', id);
    }, true);
    return this.mapCounselAbsence(row);
  }

  markCounselAbsenceIndeterminate(
    id: string,
    fingerprint: string,
    evidence: { beforeCount?: number | null; message?: string; claimToken?: string } = {},
  ) {
    const row = this.withCounselDeliveryPrimary((primary) => {
      const current = this.primaryGet<any>(primary, 'SELECT * FROM counsel_absence_attempts WHERE id=?', id);
      if (!current) throw new HttpError(400, '부재 상담 기록을 찾을 수 없습니다.');
      if (current.delivery_state === 'confirmed' && current.delivery_fingerprint === fingerprint) return current;
      if (current.delivery_state !== 'pending' || current.delivery_fingerprint !== fingerprint) {
        throw new HttpError(409, '부재 상담 전송 상태가 변경되었습니다.');
      }
      const ownerToken = String(evidence.claimToken || '').trim();
      if (current.delivery_stage === 'claimed' && (!ownerToken || current.delivery_claim_token !== ownerToken)) {
        throw new HttpError(409, '다른 요청이 이 부재 상담을 처리 중입니다.');
      }
      if (current.delivery_stage === 'posting' && ownerToken && current.delivery_claim_token !== ownerToken) {
        throw new HttpError(409, '부재 상담 전송 선점 정보가 변경되었습니다.');
      }
      const beforeCount = Number.isInteger(evidence.beforeCount) && Number(evidence.beforeCount) >= 0
        ? Number(evidence.beforeCount) : current.delivery_before_count;
      const updated = primary.prepare(
        `UPDATE counsel_absence_attempts
         SET delivery_stage='posting',delivery_before_count=?,delivery_message=?
         WHERE id=? AND delivery_state='pending' AND delivery_fingerprint=?
           AND (?='' OR delivery_claim_token=?)`,
      ).run(
        beforeCount,
        String(evidence.message || '통통통 부재/문자 전송 결과를 확인 중입니다. 같은 기록을 다시 전송하지 마세요.'),
        id, fingerprint, ownerToken, ownerToken,
      );
      const latest = this.primaryGet<any>(primary, 'SELECT * FROM counsel_absence_attempts WHERE id=?', id);
      if (updated.changes !== 1 && latest?.delivery_state !== 'confirmed') {
        throw new HttpError(409, '부재 상담 전송 상태가 동시에 변경되었습니다.');
      }
      return latest;
    }, true);
    return this.mapCounselAbsence(row);
  }

  confirmCounselAbsenceDelivery(
    id: string,
    fingerprint: string,
    at: string,
    evidence: { beforeCount?: number | null; message?: string } = {},
  ) {
    const row = this.withCounselDeliveryPrimary((primary) => {
      const current = this.primaryGet<any>(primary, 'SELECT * FROM counsel_absence_attempts WHERE id=?', id);
      if (!current) throw new HttpError(400, '부재 상담 기록을 찾을 수 없습니다.');
      if (current.delivery_state === 'confirmed' && current.delivery_fingerprint === fingerprint) return current;
      if (current.delivery_state !== 'pending' || current.delivery_stage !== 'posting'
        || current.delivery_fingerprint !== fingerprint) {
        throw new HttpError(409, '통통통 전송 시작 증거가 없어 부재 상담을 완료 처리하지 않았습니다.');
      }
      const beforeCount = Number.isInteger(evidence.beforeCount) && Number(evidence.beforeCount) >= 0
        ? Number(evidence.beforeCount) : current.delivery_before_count;
      const updated = primary.prepare(
        `UPDATE counsel_absence_attempts
         SET synced=1,synced_at=?,delivery_state='confirmed',delivery_stage='confirmed',
             delivery_claim_token='',delivery_before_count=?,delivery_message=?
         WHERE id=? AND delivery_state='pending' AND delivery_stage='posting' AND delivery_fingerprint=?`,
      ).run(
        at || '', beforeCount,
        String(evidence.message || '통통통 부재/문자 전송과 앱 저장을 확인했습니다.'),
        id, fingerprint,
      );
      const latest = this.primaryGet<any>(primary, 'SELECT * FROM counsel_absence_attempts WHERE id=?', id);
      if (updated.changes !== 1 && latest?.delivery_state !== 'confirmed') {
        throw new HttpError(409, '부재 상담 전송 상태가 동시에 변경되어 완료 처리하지 않았습니다.');
      }
      return latest;
    }, true);
    return this.mapCounselAbsence(row);
  }

  resetCounselAbsenceBeforePost(id: string, fingerprint: string, claimToken: string) {
    const ownerToken = String(claimToken || '').trim();
    if (!ownerToken) throw new HttpError(409, '부재 상담 전송 선점 정보가 없습니다.');
    this.withCounselDeliveryPrimary((primary) => {
      const removed = primary.prepare(
        `DELETE FROM counsel_absence_attempts
         WHERE id=? AND delivery_state='pending' AND delivery_stage='claimed'
           AND delivery_fingerprint=? AND delivery_claim_token=?`,
      ).run(id, fingerprint, ownerToken);
      if (removed.changes !== 1) {
        throw new HttpError(409, '통통통 전송이 시작되었을 수 있어 부재 상담 기록을 초기화하지 않았습니다.');
      }
    }, true);
  }

  recoverStaleCounselAbsenceClaim(id: string, now: Date | string | number = new Date()) {
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (!Number.isFinite(nowMs)) throw new HttpError(400, '부재 상담 복구 기준 시간이 올바르지 않습니다.');
    return this.withCounselDeliveryPrimary((primary) => {
      const row = this.primaryGet<any>(primary, 'SELECT * FROM counsel_absence_attempts WHERE id=?', id);
      if (!row) throw new HttpError(400, '부재 상담 기록을 찾을 수 없습니다.');
      if (row.delivery_state !== 'pending' || row.delivery_stage !== 'claimed') {
        return { action: 'waiting' as const, attempt: this.mapCounselAbsence(row) };
      }
      const attemptedMs = Date.parse(String(row.delivery_attempted_at || ''));
      if (!Number.isFinite(attemptedMs) || nowMs - attemptedMs < COUNSEL_DELIVERY_CLAIM_LEASE_MS) {
        return { action: 'waiting' as const, attempt: this.mapCounselAbsence(row) };
      }
      const removed = primary.prepare(
        `DELETE FROM counsel_absence_attempts
         WHERE id=? AND delivery_state='pending' AND delivery_stage='claimed'
           AND delivery_claim_token=? AND delivery_attempted_at=?`,
      ).run(id, row.delivery_claim_token, row.delivery_attempted_at);
      return {
        action: removed.changes === 1 ? 'reset' as const : 'waiting' as const,
        attempt: removed.changes === 1 ? null : this.mapCounselAbsence(
          this.primaryGet<any>(primary, 'SELECT * FROM counsel_absence_attempts WHERE id=?', id) || row,
        ),
      };
    }, true);
  }
  /** 로스터 동기화(보존갱신): 통통통 학생목록으로 phone/student 갱신, 기존 content/synced는 보존.
   *  현재 로스터에 없는 학생(퇴원 등)은 제거 — 단, 로스터가 비었을 땐(수업일 아님/조회실패) 보존해서 드래프트 손실 방지. */
  upsertCounselRoster(taskId: string, teacher: string, cls: string, roster: Array<{ scode: string; name: string; phone: string }>) {
    const valid = roster.filter((r) => r.scode);
    const tx = this.d().transaction(() => {
      if (valid.length) {
        const keep = new Set(valid.map((r) => r.scode));
        for (const e of this.db.all<any>(
          `SELECT e.id,e.scode,e.delivery_state,
             EXISTS(
               SELECT 1 FROM counsel_absence_attempts a
               WHERE a.entry_id=e.id AND a.delivery_state='pending'
             ) AS absence_pending
           FROM counsel_entries e WHERE e.task_id=? AND e.teacher=? AND e.cls=?`,
          taskId, teacher, cls,
        )) {
          // POST 결과가 아직 확정되지 않은 행을 지우면 다음 요청이 새 id로 재생성되어 중복 전송될 수 있다.
          // 부재/문자 시도도 별도 표에 있으므로, 그 결과가 확인 중인 학생 행 역시 고아로 만들지 않는다.
          if (!keep.has(e.scode) && e.delivery_state !== 'pending' && !e.absence_pending) {
            this.db.run('DELETE FROM counsel_entries WHERE id=?', e.id); // 퇴원생 등 현재 로스터에 없는 학생 제거
          }
        }
      }
      for (const r of valid) {
        const ex = this.db.get<any>('SELECT id FROM counsel_entries WHERE task_id=? AND teacher=? AND cls=? AND scode=?', taskId, teacher, cls, r.scode);
        if (ex) this.db.run('UPDATE counsel_entries SET student=?, phone=? WHERE id=?', r.name, r.phone || '', ex.id);
        else this.db.run('INSERT INTO counsel_entries(id,task_id,teacher,cls,scode,student,phone,subject,content,synced,synced_at,done) VALUES(?,?,?,?,?,?,?,?,?,0,?,0)', uid('ce'), taskId, teacher, cls, r.scode, r.name, r.phone || '', '', '', '');
      }
    });
    tx();
    return this.getCounselEntries(taskId, teacher, cls);
  }
  /** 상담 주제·내용 저장 (레거시 호출 호환). pending 중인 원문은 변경할 수 없다. */
  saveCounselDraft(id: string, subject: string, content: string) {
    const row = this.db.get<any>('SELECT * FROM counsel_entries WHERE id=?', id);
    if (!row) return;
    const nextSubject = String(subject || '');
    const nextContent = String(content || '');
    if (row.delivery_state === 'pending' && (row.subject !== nextSubject || row.content !== nextContent)) {
      throw new HttpError(409, '이 상담은 통통통 전송 결과를 확인 중입니다. 같은 상담을 다시 전송하거나 내용을 바꾸지 마세요.');
    }
    if (row.delivery_state === 'pending') return;
    this.db.run(
      `UPDATE counsel_entries
       SET subject=?, content=?, synced=0, synced_at='', delivery_state='idle',
           delivery_stage='', delivery_claim_token='', delivery_fingerprint='', delivery_date='', delivery_before_count=-1,
           delivery_attempted_at='', delivery_message=''
       WHERE id=?`,
      nextSubject, nextContent, id,
    );
  }
  setCounselDone(id: string, done: boolean) {
    const changed = this.db.run(
      'UPDATE counsel_entries SET done=? WHERE id=? AND roster_active=1',
      done ? 1 : 0, id,
    );
    if (Number(changed?.changes || 0) !== 1) {
      throw new HttpError(409, '최신 학생 명단에 없는 상담 대상입니다. 학생 목록을 새로고침해 주세요.');
    }
  }
  getCounselEntry(id: string) { const r = this.db.get<any>('SELECT * FROM counsel_entries WHERE id=?', id); return r ? this.mapCounsel(r) : null; }
  /** 레거시/관리용 완료 표시. 새 전송 경로는 confirmCounselDelivery를 사용한다. */
  markCounselSynced(id: string, at: string) {
    this.db.run(
      `UPDATE counsel_entries
       SET synced=1, synced_at=?, delivery_state='confirmed',
           delivery_stage='confirmed', delivery_claim_token='',
           delivery_message='통통통 전송과 앱 상태 저장을 확인했습니다.'
       WHERE id=?`,
      at || '', id,
    );
  }

  /**
   * 전송 시도를 원자적으로 선점하고 드래프트를 함께 저장한다.
   * 동일 지문의 pending/confirmed 요청은 ERP를 다시 호출하지 않도록 action으로 반환한다.
   */
  beginCounselDelivery(
    id: string,
    naturalKey: Partial<CounselEntryNaturalKey> | undefined,
    draft: CounselDeliveryDraft,
  ): { action: CounselDeliveryBeginAction; fingerprint: string; claimToken: string; entry: any } {
    const subject = String(draft.subject || '').trim() || '상담';
    const content = String(draft.content || '').trim();
    const date = String(draft.date || '').trim();
    if (!content) throw new HttpError(400, '상담 내용을 입력해 주세요.');
    if (!isIsoDate(date)) throw new HttpError(400, '상담 날짜 형식이 올바르지 않습니다.');
    const fingerprint = counselDeliveryFingerprint({ subject, content, date });
    const attemptedAt = String(draft.attemptedAt || new Date().toISOString());
    const claimToken = randomUUID();
    const result = this.withCounselDeliveryPrimary((primary) => {
      const row = this.counselRowForReference(id, naturalKey, primary);
      if (!row) throw new HttpError(400, '상담 항목을 찾을 수 없습니다. 목록을 새로고침해 주세요.');
      const state: CounselDeliveryState = row.delivery_state === 'pending' || row.delivery_state === 'confirmed'
        ? row.delivery_state
        : (row.synced ? 'confirmed' : 'idle');
      const sameAttempt = row.delivery_fingerprint === fingerprint && row.delivery_date === date;
      if (state === 'pending') {
        if (!sameAttempt) {
          throw new HttpError(409, '이 상담은 통통통 전송 결과를 확인 중입니다. 결과가 확정될 때까지 내용 변경과 재전송을 할 수 없습니다.');
        }
        return { action: 'pending' as const, claimToken: '', row };
      }
      if (state === 'confirmed' && sameAttempt) return { action: 'confirmed' as const, claimToken: '', row };

      // 읽은 상태까지 WHERE에 포함한 원격 primary의 단일 guarded UPDATE가 실제 선점점이다.
      // 두 Vercel 리플리카가 동시에 같은 idle 행을 읽어도 changes=1은 오직 하나만 얻는다.
      const claimed = primary.prepare(
        `UPDATE counsel_entries
         SET subject=?, content=?, synced=0, synced_at='', delivery_state='pending',
             delivery_stage='claimed', delivery_claim_token=?,
             delivery_fingerprint=?, delivery_date=?, delivery_before_count=-1,
             delivery_attempted_at=?, delivery_message=?
         WHERE id=?
           AND COALESCE(delivery_state,'idle')=?
           AND COALESCE(delivery_stage,'')=?
           AND COALESCE(delivery_claim_token,'')=?
           AND COALESCE(delivery_fingerprint,'')=?
           AND COALESCE(delivery_date,'')=?
           AND synced=?`,
      ).run(
        subject, content, claimToken, fingerprint, date, attemptedAt,
        '통통통 전송을 준비했습니다. 같은 상담을 다시 전송하지 마세요.', row.id,
        String(row.delivery_state || 'idle'), String(row.delivery_stage || ''),
        String(row.delivery_claim_token || ''),
        String(row.delivery_fingerprint || ''), String(row.delivery_date || ''), row.synced ? 1 : 0,
      );
      if (claimed.changes === 1) {
        return { action: 'send' as const, claimToken, row: this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', row.id) };
      }

      const current = this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', row.id);
      if (!current) throw new HttpError(400, '상담 항목을 찾을 수 없습니다. 목록을 새로고침해 주세요.');
      const currentState: CounselDeliveryState = current.delivery_state === 'pending' || current.delivery_state === 'confirmed'
        ? current.delivery_state
        : (current.synced ? 'confirmed' : 'idle');
      const currentSameAttempt = current.delivery_fingerprint === fingerprint && current.delivery_date === date;
      if (currentState === 'pending') {
        if (!currentSameAttempt) {
          throw new HttpError(409, '이 상담은 통통통 전송 결과를 확인 중입니다. 결과가 확정될 때까지 내용 변경과 재전송을 할 수 없습니다.');
        }
        return { action: 'pending' as const, claimToken: '', row: current };
      }
      if (currentState === 'confirmed' && currentSameAttempt) return { action: 'confirmed' as const, claimToken: '', row: current };
      throw new HttpError(409, '상담 전송 상태가 동시에 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.');
    }, true);
    return { action: result.action, fingerprint, claimToken: result.claimToken, entry: this.mapCounsel(result.row) };
  }

  /**
   * ERP POST 직전에 primary에 증거를 먼저 기록한다. 이 메서드가 성공한 뒤에만 POST해야 한다.
   * claimed 상태는 이 경계를 통과하지 않았으므로 외부 전송이 없었다고 증명해 안전하게 reset할 수 있다.
   */
  recordCounselDeliveryBeforePost(
    id: string,
    fingerprint: string,
    claimToken: string,
    evidence: { beforeCount?: number | null; message?: string } = {},
  ) {
    const ownerToken = String(claimToken || '').trim();
    if (!ownerToken) throw new HttpError(409, '상담 전송 선점 정보가 없습니다. 목록을 새로고침해 주세요.');
    const mapped = this.withCounselDeliveryPrimary((primary) => {
      const row = this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', id);
      if (!row) throw new HttpError(400, '상담 항목을 찾을 수 없습니다.');
      if (row.delivery_state !== 'pending' || row.delivery_fingerprint !== fingerprint) {
        throw new HttpError(409, '상담 전송 상태가 변경되었습니다. 목록을 새로고침해 주세요.');
      }
      if (row.delivery_claim_token !== ownerToken) {
        throw new HttpError(409, '다른 요청이 이 상담 전송을 처리 중입니다. 같은 상담을 다시 전송하지 마세요.');
      }
      if (row.delivery_stage === 'posting') return row;
      if (row.delivery_stage !== 'claimed') {
        throw new HttpError(409, '상담 전송 단계가 올바르지 않습니다. 목록을 새로고침해 주세요.');
      }
      const beforeCount = Number.isInteger(evidence.beforeCount) && Number(evidence.beforeCount) >= 0
        ? Number(evidence.beforeCount)
        : row.delivery_before_count;
      const message = String(evidence.message || '통통통 전송 요청을 시작했습니다. 같은 상담을 다시 전송하지 마세요.');
      const posting = primary.prepare(
        `UPDATE counsel_entries
         SET delivery_stage='posting', delivery_before_count=?, delivery_message=?
         WHERE id=? AND delivery_state='pending' AND delivery_stage='claimed'
           AND delivery_fingerprint=? AND delivery_claim_token=?`,
      ).run(beforeCount, message, id, fingerprint, ownerToken);
      if (posting.changes !== 1) {
        const current = this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', id);
        if (current?.delivery_state === 'pending' && current.delivery_stage === 'posting'
          && current.delivery_fingerprint === fingerprint && current.delivery_claim_token === ownerToken) return current;
        throw new HttpError(409, '상담 전송 단계가 동시에 변경되었습니다. 목록을 새로고침해 주세요.');
      }
      return this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', id);
    }, true);
    return this.mapCounsel(mapped);
  }

  /** POST가 실행됐거나 실행 여부가 불확실할 때 증거를 기록하고 pending을 유지한다. */
  markCounselDeliveryIndeterminate(
    id: string,
    fingerprint: string,
    evidence: { beforeCount?: number | null; message?: string; claimToken?: string } = {},
  ) {
    const row = this.withCounselDeliveryPrimary((primary) => {
      const row = this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', id);
      if (!row) throw new HttpError(400, '상담 항목을 찾을 수 없습니다.');
      if (row.delivery_state === 'confirmed' && row.delivery_fingerprint === fingerprint) return row;
      if (row.delivery_state !== 'pending' || row.delivery_fingerprint !== fingerprint) {
        throw new HttpError(409, '상담 전송 상태가 변경되었습니다. 목록을 새로고침해 주세요.');
      }
      const ownerToken = String(evidence.claimToken || '').trim();
      if (row.delivery_stage === 'claimed') {
        if (!ownerToken || row.delivery_claim_token !== ownerToken) {
          throw new HttpError(409, '다른 요청이 이 상담 전송을 처리 중입니다. 같은 상담을 다시 전송하지 마세요.');
        }
      } else if (row.delivery_stage === 'posting') {
        // reconcile은 owner token 없이 posting 증거만 갱신할 수 있다. 토큰을 제시한
        // 원래 전송 요청이라면 반드시 현재 소유자와 일치해야 한다.
        if (ownerToken && row.delivery_claim_token !== ownerToken) {
          throw new HttpError(409, '상담 전송 선점 정보가 변경되었습니다. 목록을 새로고침해 주세요.');
        }
      } else {
        throw new HttpError(409, '상담 전송 단계가 올바르지 않습니다. 목록을 새로고침해 주세요.');
      }
      const beforeCount = Number.isInteger(evidence.beforeCount) && Number(evidence.beforeCount) >= 0
        ? Number(evidence.beforeCount)
        : row.delivery_before_count;
      const message = String(evidence.message || '통통통 전송 요청 후 결과를 확인 중입니다. 같은 상담을 다시 전송하지 마세요.');
      const updated = row.delivery_stage === 'claimed'
        ? primary.prepare(
          `UPDATE counsel_entries
           SET delivery_stage='posting', delivery_before_count=?, delivery_message=?
           WHERE id=? AND delivery_state='pending' AND delivery_stage='claimed'
             AND delivery_fingerprint=? AND delivery_claim_token=?`,
        ).run(beforeCount, message, id, fingerprint, ownerToken)
        : primary.prepare(
          `UPDATE counsel_entries
           SET delivery_before_count=?, delivery_message=?
           WHERE id=? AND delivery_state='pending' AND delivery_stage='posting'
             AND delivery_fingerprint=?
             AND (?='' OR delivery_claim_token=?)`,
        ).run(beforeCount, message, id, fingerprint, ownerToken, ownerToken);
      const current = this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', id);
      if (updated.changes === 1) return current;
      if (current?.delivery_state === 'confirmed' && current.delivery_fingerprint === fingerprint) return current;
      if (current?.delivery_state === 'pending' && current.delivery_stage === 'posting'
        && current.delivery_fingerprint === fingerprint
        && (!ownerToken || current.delivery_claim_token === ownerToken)) return current;
      throw new HttpError(409, '상담 전송 상태가 동시에 변경되었습니다. 목록을 새로고침해 주세요.');
    }, true);
    return this.mapCounsel(row);
  }

  /** ERP read-after-write 증거가 확인된 시도를 완료 상태로 전환한다. */
  confirmCounselDelivery(
    id: string,
    fingerprint: string,
    at: string,
    evidence: { beforeCount?: number | null; message?: string } = {},
  ) {
    const row = this.withCounselDeliveryPrimary((primary) => {
      const row = this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', id);
      if (!row) throw new HttpError(400, '상담 항목을 찾을 수 없습니다.');
      if (row.delivery_state === 'confirmed' && row.delivery_fingerprint === fingerprint) return row;
      if (row.delivery_state !== 'pending' || row.delivery_fingerprint !== fingerprint) {
        throw new HttpError(409, '상담 전송 상태가 변경되어 완료 처리하지 않았습니다.');
      }
      if (row.delivery_stage !== 'posting') {
        throw new HttpError(409, '통통통 전송 시작 증거가 없어 완료 처리하지 않았습니다.');
      }
      const beforeCount = Number.isInteger(evidence.beforeCount) && Number(evidence.beforeCount) >= 0
        ? Number(evidence.beforeCount)
        : row.delivery_before_count;
      const message = String(evidence.message || '통통통 전송과 앱 상태 저장을 확인했습니다.');
      const updated = primary.prepare(
        `UPDATE counsel_entries
         SET synced=1, synced_at=?, delivery_state='confirmed',
             delivery_stage='confirmed', delivery_claim_token='',
             delivery_before_count=?, delivery_message=?
         WHERE id=? AND delivery_state='pending' AND delivery_stage='posting' AND delivery_fingerprint=?`,
      ).run(
        at || '', beforeCount, message, id,
        fingerprint,
      );
      const current = this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', id);
      if (updated.changes === 1) return current;
      if (current?.delivery_state === 'confirmed' && current.delivery_fingerprint === fingerprint) return current;
      throw new HttpError(409, '상담 전송 상태가 동시에 변경되어 완료 처리하지 않았습니다.');
    }, true);
    return this.mapCounsel(row);
  }

  /**
   * 사람이 통통통을 직접 확인한 뒤에만 쓰는 posting 단계의 수동 종결.
   * 자동 조회로는 저장 실패와 조회 실패를 구분할 수 없어 pending이 영구히 남는데,
   * 이 경로는 확인 주체(actor)를 메시지에 남기고 딱 한 방향으로만 상태를 옮긴다.
   *  - 'not-sent': 통통통에 없음을 확인 → idle로 되돌려 재전송 허용(자동 재전송은 여전히 없음)
   *  - 'sent'    : 통통통에 있음을 확인 → 전송 완료로 확정(ERP 재호출 없음)
   */
  resolveStuckCounselDelivery(
    id: string,
    fingerprint: string,
    resolution: 'not-sent' | 'sent',
    actor: string,
    at = '',
  ) {
    if (resolution !== 'not-sent' && resolution !== 'sent') {
      throw new HttpError(400, '전송 상태 처리 방식을 확인할 수 없습니다.');
    }
    const who = String(actor || '').trim() || '강사';
    const row = this.withCounselDeliveryPrimary((primary) => {
      const row = this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', id);
      if (!row) throw new HttpError(400, '상담 항목을 찾을 수 없습니다.');
      if (row.delivery_state !== 'pending' || row.delivery_fingerprint !== fingerprint) {
        throw new HttpError(409, '상담 전송 상태가 변경되었습니다. 목록을 새로고침해 주세요.');
      }
      // claimed는 lease 회수(recoverStaleCounselDeliveryClaim)가 담당한다. 아직 ERP POST 경계를
      // 넘지 않았을 수 있는 시도를 사람이 종결하게 두면 중복 전송으로 이어질 수 있다.
      if (row.delivery_stage !== 'posting') {
        throw new HttpError(409, '아직 통통통 전송 결과를 기다리는 중입니다. 잠시 후 「전송 결과 확인」을 먼저 눌러 주세요.');
      }
      const message = resolution === 'sent'
        ? `${who}가 통통통에서 저장을 직접 확인해 전송 완료로 표시했습니다.`
        : `${who}가 통통통에 저장되지 않은 것을 직접 확인해 재전송을 허용했습니다.`;
      const updated = resolution === 'sent'
        ? primary.prepare(
          `UPDATE counsel_entries
           SET synced=1, synced_at=?, delivery_state='confirmed',
               delivery_stage='confirmed', delivery_claim_token='', delivery_message=?
           WHERE id=? AND delivery_state='pending' AND delivery_stage='posting' AND delivery_fingerprint=?`,
        ).run(at || '', message, id, fingerprint)
        : primary.prepare(
          `UPDATE counsel_entries
           SET synced=0, synced_at='', delivery_state='idle', delivery_stage='',
               delivery_claim_token='', delivery_fingerprint='', delivery_date='',
               delivery_before_count=-1, delivery_attempted_at='', delivery_message=?
           WHERE id=? AND delivery_state='pending' AND delivery_stage='posting' AND delivery_fingerprint=?`,
        ).run(message, id, fingerprint);
      const current = this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', id);
      if (updated.changes === 1) return current;
      throw new HttpError(409, '상담 전송 상태가 동시에 변경되었습니다. 목록을 새로고침해 주세요.');
    }, true);
    return this.mapCounsel(row);
  }

  /**
   * 선점 직후 프로세스가 종료된 요청을 회수한다. fresh claim은 원 소유자가 아직
   * onBeforePost에 진입할 수 있으므로 3분 lease가 끝나기 전에는 절대 초기화하지 않는다.
   */
  recoverStaleCounselDeliveryClaim(
    id: string,
    fingerprint: string,
    now: Date | string | number = new Date(),
  ): { action: 'waiting' | 'reset'; entry: any } {
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (!Number.isFinite(nowMs)) throw new HttpError(400, '상담 전송 복구 기준 시간이 올바르지 않습니다.');
    const result = this.withCounselDeliveryPrimary((primary) => {
      const row = this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', id);
      if (!row) throw new HttpError(400, '상담 항목을 찾을 수 없습니다.');
      if (row.delivery_state !== 'pending') return { action: 'waiting' as const, row };
      if (row.delivery_fingerprint !== fingerprint) {
        throw new HttpError(409, '상담 전송 상태가 변경되었습니다. 목록을 새로고침해 주세요.');
      }
      if (row.delivery_stage !== 'claimed') return { action: 'waiting' as const, row };

      const ownerToken = String(row.delivery_claim_token || '');
      const attemptedAt = String(row.delivery_attempted_at || '');
      const attemptedMs = Date.parse(attemptedAt);
      if (!ownerToken || !Number.isFinite(attemptedMs)
        || nowMs - attemptedMs < COUNSEL_DELIVERY_CLAIM_LEASE_MS) {
        return { action: 'waiting' as const, row };
      }

      const reset = primary.prepare(
        `UPDATE counsel_entries
         SET delivery_state='idle', delivery_stage='', delivery_claim_token='',
             delivery_fingerprint='', delivery_date='', delivery_before_count=-1,
             delivery_attempted_at='', delivery_message=?
         WHERE id=? AND delivery_state='pending' AND delivery_stage='claimed'
           AND delivery_fingerprint=? AND delivery_claim_token=? AND delivery_attempted_at=?`,
      ).run(
        '중단된 전송 준비를 안전하게 초기화했습니다. 다시 전송할 수 있습니다.',
        id, fingerprint, ownerToken, attemptedAt,
      );
      const current = this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', id);
      return reset.changes === 1
        ? { action: 'reset' as const, row: current }
        : { action: 'waiting' as const, row: current || row };
    }, true);
    return { action: result.action, entry: this.mapCounsel(result.row) };
  }

  /** ERP POST가 시작되지 않았음이 명시적으로 확인된 경우에만 재시도 가능 상태로 되돌린다. */
  resetCounselDeliveryBeforePost(id: string, fingerprint: string, claimToken: string, message = '') {
    const ownerToken = String(claimToken || '').trim();
    if (!ownerToken) throw new HttpError(409, '상담 전송 선점 정보가 없습니다. 목록을 새로고침해 주세요.');
    const row = this.withCounselDeliveryPrimary((primary) => {
      const row = this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', id);
      if (!row) throw new HttpError(400, '상담 항목을 찾을 수 없습니다.');
      if (row.delivery_state !== 'pending' || row.delivery_fingerprint !== fingerprint) {
        throw new HttpError(409, '상담 전송 상태가 변경되어 초기화하지 않았습니다.');
      }
      if (row.delivery_stage !== 'claimed' || row.delivery_claim_token !== ownerToken) {
        throw new HttpError(409, '통통통 전송이 시작되었을 수 있어 초기화하지 않았습니다. 같은 상담을 다시 전송하지 마세요.');
      }
      const reset = primary.prepare(
        `UPDATE counsel_entries
         SET delivery_state='idle', delivery_fingerprint='', delivery_date='',
             delivery_stage='', delivery_claim_token='', delivery_before_count=-1,
             delivery_attempted_at='', delivery_message=?
         WHERE id=? AND delivery_state='pending' AND delivery_stage='claimed'
           AND delivery_fingerprint=? AND delivery_claim_token=?`,
      ).run(
        String(message || ''), id,
        fingerprint, ownerToken,
      );
      if (reset.changes !== 1) throw new HttpError(409, '상담 전송 단계가 동시에 변경되어 초기화하지 않았습니다.');
      return this.primaryGet<any>(primary, 'SELECT * FROM counsel_entries WHERE id=?', id);
    }, true);
    return this.mapCounsel(row);
  }

  saveTaskReport(taskId: string, teacher: string, text: string, files: string[]) {
    const existing = this.db.get<any>('SELECT * FROM task_status WHERE task_id=? AND teacher=?', taskId, teacher);
    if (existing) {
      this.db.run('UPDATE task_status SET report_text=?, report_files=? WHERE task_id=? AND teacher=?', text, J(files || []), taskId, teacher);
    } else {
      this.db.run('INSERT INTO task_status(task_id,teacher,status,report_text,report_files,at) VALUES(?,?,?,?,?,?)',
        taskId, teacher, 'none', text, J(files || []), '');
    }
  }

  updateTask(id: string, b: any) {
    const t = this.db.get<any>('SELECT * FROM tasks WHERE id=?', id);
    if (!t) throw new HttpError(400,'업무를 찾을 수 없습니다.');
    const previousMode = this.counselMode(!!t.counsel, !!t.special_counsel);
    const tag = this.normalizedTaskTag(b.tag);
    const taggedMode = this.counselModeForTag(tag);
    // 시스템 태그 도입 전 만들어진 상담은 기존 커스텀 태그를 그대로 저장한 경우가 있다.
    // 그 태그를 바꾸지 않은 단순 편집은 기존 상담 종류를 보존해 과거 업무를 깨지 않는다.
    const legacyMode = previousMode !== 'none'
      && this.counselModeForTag(String(t.tag || '')) === 'none'
      && tag === t.tag;
    const nextMode = legacyMode ? previousMode : taggedMode;
    if (nextMode === 'special' && previousMode !== 'special') this.assertSpecialCounselCreationEnabled();
    const counsel = nextMode === 'regular';
    const specialCounsel = nextMode === 'special';
    const counselLike = nextMode !== 'none';
    // 기존 MT는 읽기/단순 편집 호환을 위해 보존하되 새 일반 업무를 MT로 전환할 수는 없다.
    if (!t.mt && b.mt) throw new HttpError(400, '새 MT 업무는 더 이상 만들 수 없습니다.');
    const nextMt = counselLike ? 0 : (t.mt ? 1 : 0);
    const previousScope = P(t.scope, 'all');
    const nextScope = b.all
      ? 'all'
      : (nextMode === 'special'
        ? this.normalizedSpecialAssigneePicks(b.pick)
        : this.validatedTaskAssigneesOn(this.d(), b.pick));
    const scopeChanged = !this.sameTaskScope(previousScope, nextScope);
    const hasEntries = !!this.db.get<any>('SELECT 1 FROM counsel_entries WHERE task_id=? LIMIT 1', id);
    // 특강상담은 대상이 0명이더라도 생성 순간의 월/담당 범위가 스냅샷이다.
    // 엔트리 유무만 잠금 기준으로 삼으면 빈 업무를 편집할 때 최신 월 캐시를 흡수하게 된다.
    const counselRosterLocked = previousMode === 'special' || hasEntries;
    if (counselRosterLocked && (previousMode !== nextMode || scopeChanged)) {
      throw new HttpError(400, '상담 대상이 고정된 업무는 상담 종류나 담당 범위를 변경할 수 없습니다.');
    }
    const tx = this.d().transaction(() => {
      const specialAssignees = nextMode === 'special'
        ? (previousMode === 'special' && !scopeChanged
          ? uniqueNames(P(t.special_assignees, []))
          : this.validatedSpecialAssigneesOn(this.d(), nextScope))
        : [];
      const specialSourceMonth = nextMode === 'special'
        ? (previousMode === 'special' && isSourceMonth(t.special_source_month)
          ? t.special_source_month
          : this.currentSpecialSourceMonthForAssigneesOn(this.d(), specialAssignees))
        : '';
      this.db.run(
        `UPDATE tasks SET title=?, descr=?, tag=?, start_date=?, due_date=?, scope=?, report_req=?, attach_req=?, mt=?, counsel=?, special_counsel=?, special_source_month=?, special_assignees=?, links=? WHERE id=?`,
        b.title, b.descr || '', tag, b.start, b.due,
        J(nextScope), counselLike ? 0 : (b.reportReq ? 1 : 0), counselLike ? 0 : (b.attachReq ? 1 : 0), nextMt,
        counsel ? 1 : 0, specialCounsel ? 1 : 0, specialSourceMonth, J(specialAssignees), J(b.links || []), id,
      );
      const needsSnapshot = nextMode === 'special' && (previousMode !== 'special' || scopeChanged);
      if (needsSnapshot) this.freezeSpecialCounselRosterOn(this.d(), id, specialSourceMonth, specialAssignees);
    });
    tx();
  }
  deleteTask(id: string) {
    const tx = this.d().transaction(() => {
      this.db.run('DELETE FROM counsel_absence_attempts WHERE task_id=?', id);
      this.db.run('DELETE FROM counsel_entries WHERE task_id=?', id);
      this.db.run('DELETE FROM task_status WHERE task_id=?', id);
      this.db.run('DELETE FROM tasks WHERE id=?', id);
    });
    tx();
  }

  deleteOtherTeamCounselTaskOnPrimary(id: string, teacherTid: string) {
    this.db.withTaskDefinitionPrimary((primary) => {
      const tx = primary.transaction(() => {
        this.requireOtherTeamTeacherOn(primary, teacherTid);
        const task = this.primaryGet<any>(primary,
          'SELECT self_managed,created_by_tid FROM tasks WHERE id=?', id,
        );
        if (!task || !task.self_managed || task.created_by_tid !== teacherTid) {
          throw new HttpError(403, '본인이 만든 상담일정만 삭제할 수 있습니다.');
        }
        primary.prepare('DELETE FROM counsel_absence_attempts WHERE task_id=?').run(id);
        primary.prepare('DELETE FROM counsel_entries WHERE task_id=?').run(id);
        primary.prepare('DELETE FROM task_status WHERE task_id=?').run(id);
        primary.prepare('DELETE FROM tasks WHERE id=?').run(id);
      });
      tx();
    });
    this.db.refreshCounselRosterReplica();
  }

  // ────────────────────────── 일정 ──────────────────────────
  private eventForMutation(id: string): any {
    const event = this.db.get<any>('SELECT * FROM events WHERE id=?', id);
    if (!event) throw new HttpError(404, '일정을 찾을 수 없습니다.');
    return event;
  }

  private eventActor(viewerTid: string, role: Role) {
    const tid = String(viewerTid || '').trim();
    if (!tid) throw new HttpError(403, '로그인 정보를 확인할 수 없습니다.');
    if (role === 'lead') {
      const master = this.db.get<any>('SELECT id FROM lead_account WHERE id=?', tid);
      if (master) return { tid, role, isMasterLead: true } as const;
      const teacher = this.teacherByTid(tid);
      if (teacher && !!teacher.is_lead) return { tid, role, isMasterLead: false } as const;
      throw new HttpError(403, '팀장 계정을 확인할 수 없습니다.');
    }
    if (role === 'teacher') {
      if (this.teacherByTid(tid)) return { tid, role, isMasterLead: false } as const;
      throw new HttpError(403, '강사 계정을 확인할 수 없습니다.');
    }
    throw new HttpError(403, '로그인 역할을 확인할 수 없습니다.');
  }

  private assertEventMutationAccess(
    event: any,
    actor: { tid: string; role: Role; isMasterLead: boolean },
    allowTeam: boolean,
  ) {
    if (event.owner === 'team' || event.type === 'team_event') {
      if (!allowTeam) throw new HttpError(403, '개인일정의 체크리스트만 수정할 수 있습니다.');
      if (actor.role !== 'lead') throw new HttpError(403, '팀 일정은 팀장만 수정하거나 삭제할 수 있습니다.');
      return;
    }
    if (event.owner === 'lead') {
      if (!actor.isMasterLead) throw new HttpError(403, '다른 사용자의 개인일정은 수정할 수 없습니다.');
      return;
    }
    if (event.owner !== actor.tid) {
      throw new HttpError(403, '본인의 개인일정만 수정할 수 있습니다.');
    }
  }

  private normalizedEventInput(b: any) {
    const title = String(b?.title || '').trim();
    const start = String(b?.start || '').trim();
    const end = String(b?.end || b?.start || '').trim();
    if (!title) throw new HttpError(400, '일정 이름을 입력해 주세요.');
    if (!isIsoDate(start) || !isIsoDate(end)) throw new HttpError(400, '일정 날짜 형식이 올바르지 않습니다.');
    if (end < start) throw new HttpError(400, '종료일은 시작일보다 빠를 수 없습니다.');
    return { title, start, end, descr: typeof b?.descr === 'string' ? b.descr : '' };
  }

  createEvent(b: any, viewerTid: string, role: Role): string {
    const actor = this.eventActor(viewerTid, role);
    const input = this.normalizedEventInput(b);
    const id = uid('e');
    if (b.mode === 'team' && actor.role !== 'lead') {
      throw new HttpError(403, '팀 일정은 팀장만 등록할 수 있습니다.');
    }
    const owner = b.mode === 'team' ? 'team' : (actor.isMasterLead ? 'lead' : actor.tid);
    const type = b.mode === 'team' ? 'team_event' : 'personal';
    const tag = (b.tag && String(b.tag).trim()) || (b.mode === 'team' ? '일정' : '개인일정');
    this.db.run('INSERT INTO events(id,owner,type,tag,title,descr,start_date,end_date) VALUES(?,?,?,?,?,?,?,?)',
      id, owner, type, tag, input.title, input.descr, input.start, input.end);
    return id;
  }
  updateEvent(id: string, b: any, viewerTid: string, role: Role) {
    // 소유(owner/type)는 유지, 제목·메모·기간·태그만 수정
    const actor = this.eventActor(viewerTid, role);
    const event = this.eventForMutation(id);
    this.assertEventMutationAccess(event, actor, true);
    const input = this.normalizedEventInput(b);
    const tag = (b.tag && String(b.tag).trim()) || (event.type === 'team_event' ? '일정' : '개인일정');
    this.db.run('UPDATE events SET title=?,descr=?,start_date=?,end_date=?,tag=? WHERE id=?',
      input.title, input.descr, input.start, input.end, tag, id);
  }
  updateEventTodo(id: string, descr: unknown, viewerTid: string, role: Role) {
    const actor = this.eventActor(viewerTid, role);
    if (typeof descr !== 'string') throw new HttpError(400, '체크리스트 내용을 확인해 주세요.');
    const event = this.eventForMutation(id);
    this.assertEventMutationAccess(event, actor, false);
    // 체크 상태 변경은 메모 한 컬럼만 바꾸어 일정 제목·기간·태그를 덮어쓰지 않는다.
    this.db.run('UPDATE events SET descr=? WHERE id=?', descr, id);
  }
  deleteEvent(id: string, viewerTid: string, role: Role) {
    const actor = this.eventActor(viewerTid, role);
    const event = this.eventForMutation(id);
    this.assertEventMutationAccess(event, actor, true);
    this.db.run('DELETE FROM events WHERE id=?', id);
  }

  // ────────────────────────── 태그 ──────────────────────────
  createTag(name: string, color = '올리브', emoji = '🗂️') {
    if (this.db.get('SELECT name FROM tags WHERE name=?', name)) throw new HttpError(400,'이미 있는 태그입니다.');
    const sort = (this.db.get<any>('SELECT MAX(sort) m FROM tags')?.m || 0) + 1;
    this.db.run('INSERT INTO tags(name,color,emoji,sort) VALUES(?,?,?,?)', name, color, emoji, sort);
  }
  updateTag(name: string, patch: any) {
    const t = this.db.get<any>('SELECT * FROM tags WHERE name=?', name);
    if (!t) throw new HttpError(400,'태그 없음');
    const newName = String(patch.name ?? name).trim() || name;
    if (newName !== name) {
      if (FIXED_TAGS.includes(name)) throw new HttpError(400, `'${name}'은(는) 고정 태그라 이름을 바꿀 수 없습니다.`);
      if (this.db.get('SELECT name FROM tags WHERE name=?', newName)) throw new HttpError(400, '이미 있는 태그 이름입니다.');
      this.db.run('UPDATE tags SET name=?, color=?, emoji=? WHERE name=?', newName, patch.color ?? t.color, patch.emoji ?? t.emoji, name);
      // 이 태그를 쓰는 업무·일정도 새 이름으로 연쇄 갱신
      this.db.run('UPDATE tasks SET tag=? WHERE tag=?', newName, name);
      this.db.run('UPDATE events SET tag=? WHERE tag=?', newName, name);
    } else {
      this.db.run('UPDATE tags SET color=?, emoji=? WHERE name=?', patch.color ?? t.color, patch.emoji ?? t.emoji, name);
    }
  }
  deleteTag(name: string) {
    if (FIXED_TAGS.includes(name)) throw new HttpError(400, `'${name}'은(는) 전체 상담 업무에 쓰이는 고정 태그라 삭제할 수 없습니다.`);
    this.db.run('DELETE FROM tags WHERE name=?', name);
    this.db.run("UPDATE tasks SET tag='행정' WHERE tag=?", name); // 폴백
  }
  /** 시스템 상담 태그가 없으면 생성 — 기존 색상/이모지 사용자 설정은 덮지 않는다. */
  ensureFixedTags(): boolean {
    let changed = false;
    for (const tag of FIXED_TAG_DEFINITIONS) {
      if (!this.db.get('SELECT name FROM tags WHERE name=?', tag.name)) {
        const sort = (this.db.get<any>('SELECT MAX(sort) m FROM tags')?.m || 0) + 1;
        this.db.run('INSERT INTO tags(name,color,emoji,sort) VALUES(?,?,?,?)', tag.name, tag.color, tag.emoji, sort);
        changed = true;
      }
    }
    return changed;
  }

  // ── 설정 kv (주간테스트 날짜 등) ──
  getSetting(k: string): string { return this.db.get<any>('SELECT v FROM settings WHERE k=?', k)?.v || ''; }
  private putSetting(k: string, v: string) { this.db.run('INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)', k, String(v ?? '')); }
  setSetting(k: string, v: string) {
    if ((Object.values(SPECIAL_SETTING_KEYS) as string[]).includes(k)
      || (Object.values(REGULAR_SETTING_KEYS) as string[]).includes(k)
      || k === TEACHER_MUTATION_LEASE_KEY) {
      throw new HttpError(400, '반 동기화 설정은 전용 API를 사용해 주세요.');
    }
    this.putSetting(k, v);
  }

  getRegularClassSyncSettings() {
    return {
      targetDate: this.getSetting(REGULAR_SETTING_KEYS.targetDate),
      sourceMonth: this.getSetting(REGULAR_SETTING_KEYS.sourceMonth),
      syncedAt: this.getSetting(REGULAR_SETTING_KEYS.syncedAt),
      summary: P(this.getSetting(REGULAR_SETTING_KEYS.summary), null),
    };
  }

  getSpecialPeriodSettings() {
    return {
      enabled: this.getSetting(SPECIAL_SETTING_KEYS.enabled) === '1',
      targetDate: this.getSetting(SPECIAL_SETTING_KEYS.targetDate),
      sourceMonth: this.getSetting(SPECIAL_SETTING_KEYS.sourceMonth),
      syncedAt: this.getSetting(SPECIAL_SETTING_KEYS.syncedAt),
      summary: P(this.getSetting(SPECIAL_SETTING_KEYS.summary), null),
    };
  }

  /** 전역 토글과 동기화 기준일은 반드시 한 트랜잭션에서 함께 바꾼다. */
  setSpecialPeriod(enabled: boolean, targetDate: string) {
    const date = String(targetDate || '').trim();
    if (!isIsoDate(date)) throw new HttpError(400, '특강 기준일 형식이 올바르지 않습니다.');
    const tx = this.d().transaction(() => {
      this.putSetting(SPECIAL_SETTING_KEYS.enabled, enabled ? '1' : '0');
      this.putSetting(SPECIAL_SETTING_KEYS.targetDate, date);
      // 기존 일일보고도 ON 시 특강으로 한 방향 승격한다. 신규 형식 보고는 자체
      // snapshot을 우선하므로 그대로 보존되고, 구형 보고에는 기존 일반 플래그를
      // 명시해 재열람 때 새 journal 플래그로 의미가 바뀌지 않게 한다.
      if (enabled) {
        const journal = this.db.get<any>('SELECT special_period FROM journals WHERE date=?', date);
        if (journal && !journal.special_period) {
          for (const report of this.db.all<any>('SELECT id,payload FROM daily_reports WHERE date=?', date)) {
            const payload = P(report.payload, null);
            if (payload && typeof payload === 'object' && !Array.isArray(payload) && typeof payload.specialPeriod !== 'boolean') {
              payload.specialPeriod = false;
              this.db.run('UPDATE daily_reports SET payload=? WHERE id=?', J(payload), report.id);
            }
          }
          this.db.run('UPDATE journals SET special_period=1 WHERE date=? AND special_period=0', date);
        }
      }
    });
    tx();
    return { enabled: !!enabled, targetDate: date };
  }

  /**
   * 통통통 일반 반 조회 결과를 원자적으로 전체 교체한다.
   * - 강사별 계정으로 확정한 tid를 우선하며, 레거시 입력은 강사명 exact match만 반영
   * - `[연장]`이 포함된 반은 파서 결과와 무관하게 언제나 제외
   * - 성공 시 모든 등록 강사의 일반 M/T 그룹만 교체하고 특강 그룹은 보존
   * - 정확 매칭된 강사/반이 하나도 없으면 설정까지 전혀 변경하지 않음
   */
  applyRegularClassSnapshot(input: RegularSyncApplyInput, expectedGuard?: string): RegularSyncResult {
    const targetDate = String(input?.targetDate || '').trim();
    const sourceMonth = String(input?.sourceMonth || '').trim();
    if (!isIsoDate(targetDate)) throw new HttpError(400, '일반 반 기준일 형식이 올바르지 않습니다.');
    if (!isSourceMonth(sourceMonth)) throw new HttpError(400, '일반 반 수강년월 형식이 올바르지 않습니다.');
    if (!Array.isArray(input?.classes)) throw new HttpError(400, '일반 목록이 올바르지 않습니다.');

    const teacherRows = this.db.all<any>('SELECT tid,name,classes FROM teachers WHERE is_other_team=0 ORDER BY sort,name');
    const teacherByTid = new Map<string, any>(teacherRows.map((row) => [String(row.tid || '').trim(), row]));
    const teacherByName = new Map<string, any | null>();
    for (const row of teacherRows) {
      const name = String(row.name || '').trim();
      teacherByName.set(name, teacherByName.has(name) ? null : row); // 동명인은 안전하게 미매칭 처리
    }

    const assignments = new Map<string, { M: Set<string>; T: Set<string> }>();
    const ownerTidByClassCode = new Map<string, string>();
    const ownerTidByClassName = new Map<string, string>();
    const groupByClassCode = new Map<string, SpecialDayGroup>();
    const groupByClassName = new Map<string, SpecialDayGroup>();
    const matchedTids = new Set<string>();
    const matchedClasses = new Set<string>();
    const excludedExtensionClasses = new Set(uniqueStrings(input.excludedExtensionClasses || []));
    const unmatchedTeachers = new Set(uniqueStrings(input.unmatchedTeachers || []));
    const unmatchedClasses = new Set(uniqueStrings(input.unmatchedClasses || []));
    const unsupportedClasses = new Set(uniqueStrings(input.unsupportedClasses || []));
    const ambiguousClasses = new Set(uniqueStrings(input.ambiguousClasses || []));
    const retainedByCurrentOwner = new Set(uniqueStrings(input.retainedByCurrentOwner || []));

    for (const raw of input.classes) {
      const className = String(raw?.className || '').trim();
      if (!className) throw new HttpError(400, '일반 데이터에 반명이 없어 동기화를 중단했습니다.');
      // ERP 분류가 잘못 되어도 연장반은 일반 반 배정에 절대 섞이지 않는다.
      if (className.includes('[연장]')) {
        excludedExtensionClasses.add(className);
        continue;
      }

      const classCode = String(raw?.classCode || '').trim();
      const teacherTid = String(raw?.teacherTid || '').trim();
      const teacherName = String(raw?.teacherName || '').trim();
      if (!classCode) throw new HttpError(400, `${className} 반의 코드가 없어 동기화를 중단했습니다.`);
      if (!teacherName) {
        unmatchedTeachers.add('강사 미지정');
        unmatchedClasses.add(className);
        continue;
      }
      if (raw.dayGroup !== 'M' && raw.dayGroup !== 'T') {
        unsupportedClasses.add(className);
        continue;
      }
      const teacher = teacherTid ? teacherByTid.get(teacherTid) : teacherByName.get(teacherName);
      if (!teacher) {
        unmatchedTeachers.add(teacherName || teacherTid || '강사 미지정');
        unmatchedClasses.add(className);
        continue;
      }
      if (teacherTid && teacherName && String(teacher.name || '').trim() !== teacherName) {
        throw new HttpError(409, `${className} 반의 강사 계정과 이름이 일치하지 않아 동기화를 중단했습니다.`);
      }

      const group = raw.dayGroup as SpecialDayGroup;
      const priorCodeOwner = ownerTidByClassCode.get(classCode);
      const priorNameOwner = ownerTidByClassName.get(className);
      if ((priorCodeOwner && priorCodeOwner !== String(teacher.tid))
        || (priorNameOwner && priorNameOwner !== String(teacher.tid))) {
        throw new HttpError(409, `${className} 반의 담임이 여러 강사로 중복되어 동기화를 중단했습니다.`);
      }
      const priorCodeGroup = groupByClassCode.get(classCode);
      const priorNameGroup = groupByClassName.get(className);
      if ((priorCodeGroup && priorCodeGroup !== group)
        || (priorNameGroup && priorNameGroup !== group)) {
        throw new HttpError(409, `${className} 반의 요일 그룹이 중복되어 동기화를 중단했습니다.`);
      }
      ownerTidByClassCode.set(classCode, String(teacher.tid));
      ownerTidByClassName.set(className, String(teacher.tid));
      groupByClassCode.set(classCode, group);
      groupByClassName.set(className, group);
      const byGroup = assignments.get(teacher.tid) || { M: new Set<string>(), T: new Set<string>() };
      byGroup[group].add(className);
      assignments.set(teacher.tid, byGroup);
      matchedTids.add(teacher.tid);
      // 실제 저장되는 반명 단위로 중복을 제거한다. 같은 반명이 M/T에 각각 존재하면 두 반으로 계산한다.
      matchedClasses.add(`${teacher.tid}\u0000${group}\u0000${className}`);
    }

    // 정규반은 전체 스냅샷이므로 일부만 맞은 결과를 적용하면 기존 담당 반을 지울 수 있다.
    // API 판정뿐 아니라 저장 경계에서도 미귀속/충돌을 다시 거부한다.
    if (unmatchedTeachers.size || unmatchedClasses.size || ambiguousClasses.size || unsupportedClasses.size) {
      throw new HttpError(409, '담당자를 확정하지 못한 정규 반이 있어 기존 일반 반을 변경하지 않았습니다.');
    }
    if (matchedClasses.size === 0) {
      throw new HttpError(400, '정확히 일치하는 강사와 반이 없어 기존 일반 반을 변경하지 않았습니다.');
    }

    const syncedAt = String(input.syncedAt || new Date().toISOString());
    const result: RegularSyncResult = {
      applied: true,
      canApply: true,
      targetDate,
      sourceMonth,
      syncMode: input.syncMode === 'quarter-start' ? 'quarter-start' : 'routine',
      previousSourceMonth: String(input.previousSourceMonth || '').trim(),
      addedClassCount: Math.max(0, Number(input.addedClassCount) || 0),
      removedClassCount: Math.max(0, Number(input.removedClassCount) || 0),
      changedTeacherCount: Math.max(0, Number(input.changedTeacherCount) || 0),
      syncedAt,
      matchedTeacherCount: matchedTids.size,
      classCount: matchedClasses.size,
      excludedExtensionClasses: Array.from(excludedExtensionClasses),
      unmatchedTeachers: Array.from(unmatchedTeachers),
      unmatchedClasses: Array.from(unmatchedClasses),
      unsupportedClasses: Array.from(unsupportedClasses),
      ambiguousClasses: Array.from(ambiguousClasses),
      retainedByCurrentOwner: Array.from(retainedByCurrentOwner),
      uniquelyClaimedClassCount: Math.max(0, Number(input.uniquelyClaimedClassCount) || 0),
      registeredTeacherCount: Math.max(0, Number(input.registeredTeacherCount) || teacherRows.length),
      connectedTeacherCount: Math.max(0, Number(input.connectedTeacherCount) || teacherRows.length),
      listedClassCount: Math.max(0, Number(input.listedClassCount) || matchedClasses.size),
      listedEnrollmentCount: Math.max(0, Number(input.listedEnrollmentCount) || 0),
      searchedMonths: uniqueStrings(input.searchedMonths || []),
      unclaimedClasses: [],
      accountFailures: [],
    };

    const guard = String(expectedGuard || this.getRegularClassSyncGuard());
    this.db.withRegularClassSyncPrimary((primary) => {
      const tx = primary.transaction(() => {
        const primaryRows = this.regularSyncRows(primary);
        if (this.regularSyncGuardForRows(primaryRows) !== guard) {
          throw new HttpError(409, '동기화 중 강사 계정 또는 담당 반이 변경되어 적용을 취소했습니다. 다시 실행해 주세요.');
        }
        for (const teacher of primaryRows) {
          const classes = normalizeTeacherClasses(teacher.classes);
          const next = assignments.get(teacher.tid);
          classes['월수금반'] = next ? Array.from(next.M) : [];
          classes['화목토반'] = next ? Array.from(next.T) : [];
          primary.prepare('UPDATE teachers SET classes=? WHERE tid=?').run(J(classes), teacher.tid);
        }
        const put = primary.prepare('INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)');
        put.run(REGULAR_SETTING_KEYS.targetDate, targetDate);
        put.run(REGULAR_SETTING_KEYS.sourceMonth, sourceMonth);
        put.run(REGULAR_SETTING_KEYS.syncedAt, syncedAt);
        put.run(REGULAR_SETTING_KEYS.summary, J(result));
      });
      tx();
    });
    this.db.refreshRegularClassSyncReplica();
    return result;
  }

  /**
   * 통통통 특강 조회 결과를 전체 스냅샷으로 원자 적용한다.
   * - 로컬 강사명과 trim 후 정확히 한 명만 매칭되는 반만 적용
   * - 성공 시 모든 강사의 특강 M/T 그룹을 새 결과로 교체
   * - 같은 월 재동기화에서는 기존에 보강한 어머니 연락처를 보존
   * - 다른 월 캐시는 유지하며, 이미 생성된 특강상담은 counsel_entries의 불변 복사본을 사용
   */
  applySpecialClassSnapshot(input: SpecialSyncApplyInput): SpecialSyncResult {
    const targetDate = String(input?.targetDate || '').trim();
    const sourceMonth = String(input?.sourceMonth || '').trim();
    if (!isIsoDate(targetDate)) throw new HttpError(400, '특강 기준일 형식이 올바르지 않습니다.');
    if (!isSourceMonth(sourceMonth)) throw new HttpError(400, '특강 수강년월 형식이 올바르지 않습니다.');
    if (!Array.isArray(input?.classes)) throw new HttpError(400, '특강 반 목록이 올바르지 않습니다.');

    const teacherRows = this.db.all<any>('SELECT tid,name,classes FROM teachers WHERE is_other_team=0 ORDER BY sort,name');
    const teacherByName = new Map<string, any | null>();
    for (const row of teacherRows) {
      const name = String(row.name || '').trim();
      teacherByName.set(name, teacherByName.has(name) ? null : row); // 동명이인은 안전하게 미매칭 처리
    }

    const assignments = new Map<string, { M: Set<string>; T: Set<string> }>();
    const rosterRows = new Map<string, {
      sourceMonth: string; classCode: string; className: string; teacherTid: string; teacherName: string;
      dayGroup: SpecialDayGroup; scode: string; student: string; motherPhone: string;
    }>();
    const matchedTids = new Set<string>();
    const matchedClasses = new Set<string>();
    const unmatchedTeachers = new Set(uniqueStrings(input.unmatchedTeachers || []));
    const unmatchedClasses = new Set(uniqueStrings(input.unmatchedClasses || []));
    const unsupportedClasses = new Set(uniqueStrings(input.unsupportedClasses || []));

    for (const raw of input.classes) {
      const classCode = String(raw?.classCode || '').trim();
      const className = String(raw?.className || '').trim();
      const teacherName = String(raw?.teacherName || '').trim();
      if (!classCode || !className || !Array.isArray(raw?.students)) {
        throw new HttpError(400, '특강 반 또는 로스터 데이터가 불완전하여 동기화를 중단했습니다.');
      }
      if (!teacherName) {
        unmatchedTeachers.add('강사 미지정');
        unmatchedClasses.add(className);
        continue;
      }
      if (raw.dayGroup !== 'M' && raw.dayGroup !== 'T') {
        unsupportedClasses.add(className);
        continue;
      }
      const teacher = teacherByName.get(teacherName);
      if (!teacher) {
        unmatchedTeachers.add(teacherName);
        unmatchedClasses.add(className);
        continue;
      }
      const group = raw.dayGroup as SpecialDayGroup;
      const byGroup = assignments.get(teacher.tid) || { M: new Set<string>(), T: new Set<string>() };
      byGroup[group].add(className);
      assignments.set(teacher.tid, byGroup);
      matchedTids.add(teacher.tid);
      matchedClasses.add(`${teacher.tid}\u0000${group}\u0000${classCode}`);

      for (const studentRaw of raw.students) {
        const scode = String(studentRaw?.scode || '').trim();
        const student = String(studentRaw?.student || '').trim();
        if (!scode || !student) throw new HttpError(400, `${className} 반의 원생 데이터가 불완전하여 동기화를 중단했습니다.`);
        rosterRows.set(`${classCode}\u0000${scode}`, {
          sourceMonth, classCode, className, teacherTid: teacher.tid, teacherName: teacher.name,
          dayGroup: group, scode, student, motherPhone: String(studentRaw.motherPhone || '').trim(),
        });
      }
    }

    if (matchedTids.size === 0) throw new HttpError(400, '정확히 일치하는 강사가 없어 기존 특강 반을 변경하지 않았습니다.');
    const syncedAt = String(input.syncedAt || new Date().toISOString());
    const result: SpecialSyncResult = {
      targetDate, sourceMonth, syncedAt,
      matchedTeacherCount: matchedTids.size,
      classCount: matchedClasses.size,
      studentCount: rosterRows.size,
      unmatchedTeachers: Array.from(unmatchedTeachers),
      unmatchedClasses: Array.from(unmatchedClasses),
      unsupportedClasses: Array.from(unsupportedClasses),
    };

    const tx = this.d().transaction(() => {
      // 같은 월에서 상세 API로 이미 채운 연락처는 중앙 목록 재조회로 지우지 않는다.
      const existingPhones = new Map<string, string>();
      for (const row of this.db.all<any>('SELECT class_code,scode,mother_phone FROM special_class_roster WHERE source_month=?', sourceMonth)) {
        if (row.mother_phone) existingPhones.set(`${row.class_code}\u0000${row.scode}`, row.mother_phone);
      }

      for (const teacher of teacherRows) {
        const classes = normalizeTeacherClasses(teacher.classes);
        const next = assignments.get(teacher.tid);
        classes['특강 월수금반'] = next ? Array.from(next.M) : [];
        classes['특강 화목토반'] = next ? Array.from(next.T) : [];
        this.db.run('UPDATE teachers SET classes=? WHERE tid=?', J(classes), teacher.tid);
      }

      this.db.run('DELETE FROM special_class_roster WHERE source_month=?', sourceMonth);
      for (const row of rosterRows.values()) {
        const phone = row.motherPhone || existingPhones.get(`${row.classCode}\u0000${row.scode}`) || '';
        this.db.run(
          `INSERT INTO special_class_roster(source_month,class_code,class_name,teacher_tid,teacher_name,day_group,scode,student,mother_phone,synced_at)
           VALUES(?,?,?,?,?,?,?,?,?,?)`,
          row.sourceMonth, row.classCode, row.className, row.teacherTid, row.teacherName, row.dayGroup,
          row.scode, row.student, phone, syncedAt,
        );
      }

      this.putSetting(SPECIAL_SETTING_KEYS.targetDate, targetDate);
      this.putSetting(SPECIAL_SETTING_KEYS.sourceMonth, sourceMonth);
      this.putSetting(SPECIAL_SETTING_KEYS.syncedAt, syncedAt);
      this.putSetting(SPECIAL_SETTING_KEYS.summary, J(result));
    });
    tx();
    return result;
  }

  // ────────────────────────── 공지 ──────────────────────────
  createNotice(text: string): string {
    const id = uid('n');
    const sort = (this.db.get<any>('SELECT MIN(sort) m FROM notices')?.m || 1) - 1;
    this.db.run('INSERT INTO notices(id,text,active,posted_date,author,sort) VALUES(?,?,1,?,?,?)',
      id, text, config.today, '팀장 ' + (this.db.get<any>('SELECT name FROM lead_account LIMIT 1')?.name || ''), sort);
    return id;
  }
  updateNotice(id: string, patch: any) {
    const n = this.db.get<any>('SELECT * FROM notices WHERE id=?', id);
    if (!n) throw new HttpError(400,'공지 없음');
    this.db.run('UPDATE notices SET text=?, active=? WHERE id=?',
      patch.text ?? n.text, patch.active === undefined ? n.active : (patch.active ? 1 : 0), id);
  }
  deleteNotice(id: string) { this.db.run('DELETE FROM notices WHERE id=?', id); }
  /** 공지 노출 순서 재정렬 — ids 배열 순서대로 sort 부여(맨 앞=0). */
  reorderNotices(ids: string[]) {
    (ids || []).forEach((id, i) => this.db.run('UPDATE notices SET sort=? WHERE id=?', i, id));
  }

  // ────────────────────────── 강사 ──────────────────────────
  createTeacher(name: string, tid: string, pw: string, tttId = '', tttPw = '') {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) throw new HttpError(400, '강사 이름을 입력해 주세요.');
    if (!String(tid || '').trim()) throw new HttpError(400, '아이디를 입력해 주세요.');
    if (!pw || !String(pw).trim()) throw new HttpError(400, '초기 비밀번호를 입력해 주세요.');
    if (this.db.get('SELECT tid FROM teachers WHERE tid=?', tid)) throw new HttpError(400,'이미 있는 아이디입니다.');
    const duplicateName = this.db.all<any>('SELECT name FROM teachers')
      .some((teacher) => String(teacher.name || '').trim() === normalizedName);
    if (duplicateName) {
      throw new HttpError(400, '이미 있는 강사 이름입니다.');
    }
    const sort = (this.db.get<any>('SELECT MAX(sort) m FROM teachers')?.m || 0) + 1;
    this.db.run('INSERT INTO teachers(tid,name,pw,classes,ttt_id,ttt_pw,sort) VALUES(?,?,?,?,?,?,?)',
      tid, normalizedName, hashPassword(pw), J(normalizeTeacherClasses({})), tttId || '', tttPw ? encrypt(tttPw) : '', sort);
  }

  /** 강사 통통통 계정 저장 (비번은 암호화). tttPw 빈문자면 기존 유지 */
  setTeacherTtt(tid: string, tttId: string, tttPw: string) {
    const t = this.teacherByTid(tid);
    if (!t) throw new HttpError(400,'강사 없음');
    const pwEnc = tttPw ? encrypt(tttPw) : t.ttt_pw; // 빈값이면 기존 비번 유지
    this.db.run('UPDATE teachers SET ttt_id=?, ttt_pw=? WHERE tid=?', tttId ?? t.ttt_id, pwEnc, tid);
  }

  /** 강사 통통통 자격증명 조회 (복호화). 없으면 null */
  getTeacherTtt(tid: string): { id: string; pw: string } | null {
    const t = this.teacherByTid(tid);
    if (!t || !t.ttt_id || !t.ttt_pw) return null;
    return { id: t.ttt_id, pw: decrypt(t.ttt_pw) };
  }
  /** 서버 전용 정규반 동기화 입력. 복호화된 비밀번호는 API 응답/상태에 포함하지 않는다. */
  getRegularClassSyncTeachers(): Array<{
    tid: string;
    name: string;
    classes: Record<TeacherClassGroup, string[]>;
    credentials: { id: string; pw: string } | null;
    credentialError: string;
  }> {
    return this.db.all<any>('SELECT tid,name,classes,ttt_id,ttt_pw FROM teachers WHERE is_other_team=0 ORDER BY sort,name').map((teacher) => {
      let credentials: { id: string; pw: string } | null = null;
      let credentialError = '';
      if (!teacher.ttt_id || !teacher.ttt_pw) {
        credentialError = '통통통 계정 미연결';
      } else {
        try {
          credentials = { id: String(teacher.ttt_id), pw: decrypt(String(teacher.ttt_pw)) };
        } catch {
          credentialError = '저장된 통통통 계정 복호화 실패';
        }
      }
      return {
        tid: String(teacher.tid),
        name: String(teacher.name),
        classes: normalizeTeacherClasses(teacher.classes),
        credentials,
        credentialError,
      };
    });
  }
  updateTeacherClasses(_tid: string, group: string, _classes: string[]) {
    if ((REGULAR_CLASS_GROUPS as readonly string[]).includes(group)) {
      throw new HttpError(400, '정규 반은 직접 추가·삭제할 수 없습니다. 정규 반 동기화를 사용해 주세요.');
    }
    if ((SPECIAL_CLASS_GROUPS as readonly string[]).includes(group)) {
      throw new HttpError(400, '특강 반은 강사가 직접 수정할 수 없습니다. 특강 반 동기화를 사용해 주세요.');
    }
    throw new HttpError(400, '지원하지 않는 반 그룹입니다.');
  }
  resetTeacherPw(tid: string): string {
    if (!this.teacherByTid(tid)) throw new HttpError(400,'강사 없음');
    const tmp = 'np' + randomInt(100000, 1000000);
    this.db.run('UPDATE teachers SET pw=? WHERE tid=?', hashPassword(tmp), tid);
    return tmp;
  }
  /** 강사 로그인 비밀번호를 직접 지정 변경 */
  setTeacherPassword(tid: string, pw: string) {
    if (!this.teacherByTid(tid)) throw new HttpError(400,'강사 없음');
    if (!pw || !pw.trim()) throw new HttpError(400,'비밀번호를 입력해 주세요.');
    this.db.run('UPDATE teachers SET pw=? WHERE tid=?', hashPassword(pw), tid);
  }
  /** 강사 삭제 + 연관 데이터 정리 */
  deleteTeacher(tid: string) {
    const t = this.teacherByTid(tid);
    if (!t) throw new HttpError(400,'강사 없음');
    const tx = this.d().transaction(() => {
      // 다른 팀의 개인 상담일정은 공용 업무와 달리 tid가 소유권 기준이다.
      // 강사 삭제 뒤 학생 PII·과거 전송 이력이 고아 데이터로 남지 않도록 업무 단위로 먼저 정리한다.
      this.db.run(
        'DELETE FROM counsel_absence_attempts WHERE task_id IN (SELECT id FROM tasks WHERE self_managed=1 AND created_by_tid=?)',
        tid,
      );
      this.db.run(
        'DELETE FROM counsel_entries WHERE task_id IN (SELECT id FROM tasks WHERE self_managed=1 AND created_by_tid=?)',
        tid,
      );
      this.db.run(
        'DELETE FROM task_status WHERE task_id IN (SELECT id FROM tasks WHERE self_managed=1 AND created_by_tid=?)',
        tid,
      );
      this.db.run('DELETE FROM tasks WHERE self_managed=1 AND created_by_tid=?', tid);
      this.db.run('DELETE FROM other_team_students WHERE teacher_tid=?', tid);
      this.db.run('DELETE FROM other_team_classes WHERE teacher_tid=?', tid);
      this.db.run('DELETE FROM other_team_syncs WHERE teacher_tid=?', tid);
      this.db.run('DELETE FROM counsel_absence_attempts WHERE teacher=?', t.name);
      this.db.run('DELETE FROM counsel_entries WHERE teacher=?', t.name);
      this.db.run('DELETE FROM special_class_roster WHERE teacher_tid=? OR teacher_name=?', tid, t.name);
      this.db.run('DELETE FROM task_status WHERE teacher=?', t.name);
      this.db.run('DELETE FROM daily_reports WHERE teacher=?', t.name);
      this.db.run('DELETE FROM events WHERE owner=?', tid);
      this.db.run('DELETE FROM teachers WHERE tid=?', tid);
    });
    tx();
  }

  // ────────────────────────── 일일보고 정의 ──────────────────────────
  createJournal(date: string) {
    if (this.db.get('SELECT date FROM journals WHERE date=?', date)) return; // 이미 있음
    const specialPeriod = this.getSetting(SPECIAL_SETTING_KEYS.enabled) === '1';
    this.db.run('INSERT INTO journals(date,created_at,special_period) VALUES(?,?,?)', date, config.today, specialPeriod ? 1 : 0);
    // 오늘 체크리스트 복사
    const todayItems = this.db.all<any>('SELECT * FROM journal_items WHERE date=? ORDER BY sort', config.today);
    const src = todayItems.length ? todayItems : this.db.all<any>('SELECT * FROM journal_items WHERE date=(SELECT MAX(date) FROM journals WHERE date<?) ORDER BY sort', date);
    src.forEach((i, idx) => this.db.run('INSERT INTO journal_items(id,date,text,required,sort) VALUES(?,?,?,?,?)', uid('ji'), date, i.text, i.required, idx));
  }
  addJournalItem(date: string, text: string, required: boolean) {
    const sort = (this.db.get<any>('SELECT MAX(sort) m FROM journal_items WHERE date=?', date)?.m ?? -1) + 1;
    this.db.run('INSERT INTO journal_items(id,date,text,required,sort) VALUES(?,?,?,?,?)', uid('ji'), date, text, required ? 1 : 0, sort);
  }
  updateJournalItemText(id: string, text: unknown) {
    if (typeof text !== 'string') throw new HttpError(400, '체크리스트 내용을 입력해 주세요.');
    const normalized = text.trim();
    if (!normalized) throw new HttpError(400, '체크리스트 내용을 입력해 주세요.');
    if (normalized.length > MAX_JOURNAL_ITEM_TEXT_LENGTH) {
      throw new HttpError(400, `체크리스트 내용은 ${MAX_JOURNAL_ITEM_TEXT_LENGTH}자 이내로 입력해 주세요.`);
    }
    const item = this.db.get<any>('SELECT id,date FROM journal_items WHERE id=?', id);
    if (!item) {
      throw new HttpError(400, '체크리스트 항목을 찾을 수 없습니다.');
    }
    // 지난 보고는 제출 payload가 item id를 키로 보존하고 열람 시 현재 item 문구를 함께 쓴다.
    // 과거 문구를 바꾸면 제출 당시 의미까지 소급 변경되므로 서버에서도 불변으로 막는다.
    if (String(item.date || '') < config.today) {
      throw new HttpError(400, '지난 일일보고의 체크리스트 문구는 변경할 수 없습니다.');
    }
    // 항목 ID는 강사 보고 payload의 키다. 문구만 갱신해 기존 체크·보고 데이터를 보존한다.
    this.db.run('UPDATE journal_items SET text=? WHERE id=?', normalized, id);
  }
  removeJournalItem(id: string) { this.db.run('DELETE FROM journal_items WHERE id=?', id); }
  /** 날짜별 일일보고 삭제 (정의 + 항목 + 그 날 제출물) */
  deleteJournal(date: string) {
    this.db.run('DELETE FROM journals WHERE date=?', date);
    this.db.run('DELETE FROM journal_items WHERE date=?', date);
    this.db.run('DELETE FROM daily_reports WHERE date=?', date);
  }
  toggleJournalItemReq(id: string) {
    const i = this.db.get<any>('SELECT * FROM journal_items WHERE id=?', id);
    if (i) this.db.run('UPDATE journal_items SET required=? WHERE id=?', i.required ? 0 : 1, id);
  }

  // ────────────────────────── 일일보고 제출물 ──────────────────────────
  getReport(teacher: string, date: string) {
    const r = this.db.get<any>('SELECT * FROM daily_reports WHERE teacher=? AND date=?', teacher, date);
    return r ? { teacher, date, status: r.status, confirmed: !!r.confirmed, payload: P(r.payload, {}), at: r.submitted_at } : null;
  }
  private upsertReport(teacher: string, date: string, patch: any) {
    const r = this.db.get<any>('SELECT * FROM daily_reports WHERE teacher=? AND date=?', teacher, date);
    if (r) {
      this.db.run('UPDATE daily_reports SET status=?, confirmed=?, payload=?, submitted_at=? WHERE teacher=? AND date=?',
        patch.status ?? r.status, patch.confirmed === undefined ? r.confirmed : (patch.confirmed ? 1 : 0),
        patch.payload !== undefined ? J(patch.payload) : r.payload, patch.at ?? r.submitted_at, teacher, date);
    } else {
      this.db.run('INSERT INTO daily_reports(id,teacher,date,status,confirmed,payload,submitted_at) VALUES(?,?,?,?,?,?,?)',
        uid('dr'), teacher, date, patch.status ?? 'draft', patch.confirmed ? 1 : 0, J(patch.payload ?? {}), patch.at ?? null);
    }
  }
  /** 기존 보고는 생성 당시 스냅샷을 보존하고, 새 보고만 현재 선택과 정확히 맞춘다. */
  private expectedReportClassSnapshot(teacher: string, date: string, includeSpecial: boolean): string[] {
    const regularGroup = groupOf(date);
    if (!regularGroup) return [];
    const row = this.db.get<any>('SELECT classes FROM teachers WHERE name=?', teacher);
    const classes = normalizeTeacherClasses(row?.classes);
    const groups: TeacherClassGroup[] = [regularGroup];
    if (includeSpecial) groups.push(`특강 ${regularGroup}` as TeacherClassGroup);
    return uniqueStrings(groups.flatMap((group) => classes[group]));
  }
  private assertFreshNewReportSnapshot(teacher: string, date: string, payload: any) {
    if (this.db.get('SELECT id FROM daily_reports WHERE teacher=? AND date=?', teacher, date)) return;
    if (this.db.get<any>('SELECT is_other_team FROM teachers WHERE name=?', teacher)?.is_other_team) return;
    const journal = this.db.get<any>('SELECT special_period FROM journals WHERE date=?', date);
    const includeSpecial = !!journal?.special_period;
    const expected = this.expectedReportClassSnapshot(teacher, date, includeSpecial);
    const actual = Array.isArray(payload?.classSnapshot) ? uniqueStrings(payload.classSnapshot) : null;
    if (payload?.specialPeriod !== includeSpecial || !actual || J(actual) !== J(expected)) {
      throw new HttpError(409, '담당 반 구성이 변경되었습니다. 일일보고 화면을 새로고침한 뒤 다시 작성해 주세요.');
    }
  }
  saveDraft(teacher: string, date: string, payload: any) {
    this.assertFreshNewReportSnapshot(teacher, date, payload);
    this.upsertReport(teacher, date, { status: 'draft', payload });
  }
  submitReport(teacher: string, date: string, payload: any) {
    this.assertFreshNewReportSnapshot(teacher, date, payload);
    this.upsertReport(teacher, date, { status: 'submitted', payload, confirmed: false, at: '제출' });
  }
  confirmReport(teacher: string, date: string) {
    const r = this.db.get<any>('SELECT * FROM daily_reports WHERE teacher=? AND date=?', teacher, date);
    if (!r || r.status !== 'submitted') throw new HttpError(400, '제출된 보고만 확인할 수 있습니다.'); // 미제출 확인 시 오늘 draft 생성 버그 방지
    this.upsertReport(teacher, date, { confirmed: true });
  }
  reopenReport(teacher: string, date: string) {
    const r = this.db.get<any>('SELECT * FROM daily_reports WHERE teacher=? AND date=?', teacher, date);
    if (r?.confirmed) throw new HttpError(400,'확인 완료된 보고는 수정할 수 없습니다.');
    this.upsertReport(teacher, date, { status: 'draft', at: null });
  }
}
