import { diagnoseCounselWrite, reconcileCounselWrite, writeCounselVerified } from './counsel-write';
import type { NbAttach, TttCreds, TttGateway } from './ttt.gateway';
import type {
  AttRow,
  Counsel,
  CounselWriteArgs,
  CounselWriteDiagnosis,
  CounselWriteOptions,
  CounselWriteReconcileResult,
  CounselWriteResult,
  Notebook,
  RosterRow,
  ScoreRow,
} from './ttt.records';
import type {
  TttMotherPhoneBatchResult,
  TttOwnedClassProofRead,
  TttRegularClassProofRead,
  TttRegularCurrentAssignment,
  TttRegularTeacherClassSnapshot,
  TttSpecialSnapshot,
} from './ttt.special';

export type { TttCreds, NbAttach } from './ttt.gateway';

/**
 * 라우트가 쓰는 외부 ERP 서비스.
 *
 * 연동 규칙을 한곳에 모은다.
 * - 출결·상담·성적·명단은 강사 본인 계정으로만 읽는다. 계정이 없으면 다른 강사 자료를 대신 보여 주지 않고 빈 값을 돌려준다.
 * - 일부 반이 조용히 빠지면 안 되는 작업(PPT 생성, 반 적용, 학생 상세)은 엄격 조회를 써서 실패를 호출자에게 그대로 알린다.
 * - 상담 쓰기·재확인·진단은 `counsel-write.ts`의 대조 규칙으로 처리한다. 전송 시도 상태(중복 방지)는 라우트와 Store가 관리한다.
 */
export class TttService {
  private readonly log = { warn: (m: string) => console.warn('[Ttt]', m) };

  constructor(private readonly gateway: TttGateway) {}

  /** 계정을 실제로 확인하고 ERP 회원명을 돌려준다. 실패하면 throw한다. */
  async validateCreds(creds: TttCreds): Promise<string> {
    return (await this.gateway.verifyAccount(creds)).memberName;
  }

  /** 연동 상태(프론트 배지/안내용). */
  async status(creds?: TttCreds | null) {
    if (!creds) {
      return { notebook: 'mock', ok: true, message: '모의 ERP · 강사 계정 미연결', memberName: null as string | null };
    }
    try {
      const { memberName } = await this.gateway.verifyAccount(creds);
      return { notebook: 'mock', ok: true, message: `모의 ERP 연결됨 (${memberName}).`, memberName };
    } catch (e: any) {
      return { notebook: 'mock', ok: false, message: e?.message ?? String(e), memberName: null };
    }
  }

  // ── 알림장 ──────────────────────────────────────────────
  async getNotebook(cls: string, date: string, creds?: TttCreds | null): Promise<Notebook & { _live?: boolean }> {
    return { ...(await this.gateway.getNotebook(creds || null, cls, date)), _live: false };
  }

  async postNotebook(
    cls: string, date: string, title: string, body: string, files: string[],
    cmtId?: string | null, attach?: NbAttach, creds?: TttCreds | null,
  ): Promise<Notebook & { _live?: boolean; message?: string }> {
    const notebook = await this.gateway.postNotebook(creds || null, cls, date, { title, body, files, cmtId, attach });
    return { ...notebook, _live: false };
  }

  // ── 출결 / 상담 / 성적 / 명단 (강사 본인 계정, 읽기 전용) ──
  private async softRead<T>(label: string, creds: TttCreds | null | undefined, read: (account: TttCreds) => Promise<T>, empty: T): Promise<T> {
    if (!creds) return empty;
    try {
      return await read(creds);
    } catch (e: any) {
      this.log.warn(`${label} 조회 실패: ${e?.message ?? e}`);
      return empty;
    }
  }

  async getAttendance(cls: string, date: string, creds?: TttCreds | null): Promise<AttRow[]> {
    return this.softRead('출결', creds, (account) => this.gateway.getAttendance(account, cls, date), []);
  }

  async getCounsel(date: string, classes: string[], creds?: TttCreds | null): Promise<Counsel[]> {
    return this.softRead('상담', creds, (account) => this.gateway.getCounsel(account, date, classes), []);
  }

  async getScores(cls: string, scoreDate: string, hwDate: string, creds?: TttCreds | null): Promise<ScoreRow[]> {
    return this.softRead('성적', creds, (account) => this.gateway.getScores(account, cls, scoreDate, hwDate), []);
  }

  async getRoster(cls: string, date: string, creds?: TttCreds | null): Promise<RosterRow[]> {
    return this.softRead('명단', creds, (account) => this.gateway.getRoster(account, cls, date), []);
  }

  /** 실패를 빈 값으로 바꾸지 않는 엄격 조회. 계정이 없거나 조회가 실패하면 원인을 담아 throw한다. */
  private async strictRead<T>(label: string, creds: TttCreds | null | undefined, read: (account: TttCreds) => Promise<T>): Promise<T> {
    if (!creds) throw new Error(`${label}: 강사 통통통 계정이 필요합니다.`);
    try {
      return await read(creds);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error || '알 수 없는 오류');
      throw new Error(`${label} 조회 실패: ${detail}`);
    }
  }

  async getScoresStrict(cls: string, scoreDate: string, hwDate: string, creds?: TttCreds | null): Promise<ScoreRow[]> {
    return this.strictRead(`${cls} 성적`, creds, (account) => this.gateway.getScores(account, cls, scoreDate, hwDate));
  }

  async getAttendanceStrict(cls: string, date: string, creds?: TttCreds | null): Promise<AttRow[]> {
    return this.strictRead(`${cls} 출결`, creds, (account) => this.gateway.getAttendance(account, cls, date));
  }

  /**
   * 학생 목록 보강 전용. 연락처와 상담 이력을 따로 읽고, 실패한 쪽을 "기록 없음"이 아니라 "확인 필요"로 표시한다.
   * `forceRefresh`는 캐시를 두는 구현을 위한 인자로, 모의 구현은 항상 새로 계산한다.
   */
  async getClassStudentDetails(studentCodes: string[], today: string, creds: TttCreds | null, _forceRefresh = false) {
    const codes = [...new Set(studentCodes)];
    if (!codes.length) return { students: [], warnings: [] as string[] };
    const [phones, counsel] = await Promise.allSettled([
      this.strictRead('학생 연락처', creds, (account) => this.gateway.getStudentContacts(account, codes)),
      this.strictRead('마지막 상담 이력', creds, (account) => this.gateway.getLastCounselDates(account, codes, today)),
    ]);
    const byPhone = new Map(phones.status === 'fulfilled' ? phones.value.phones.map((item) => [item.studentCode, item.motherPhone]) : []);
    const warnings: string[] = [];
    if (phones.status === 'rejected' || (phones.status === 'fulfilled' && phones.value.failures.length)) warnings.push('일부 연락처를 확인하지 못했습니다. 확인 필요로 표시된 학생은 다시 조회해 주세요.');
    if (counsel.status === 'rejected') warnings.push('상담 이력을 확인하지 못했습니다. 확인 필요는 상담 기록 없음이나 미상담 판정이 아닙니다.');
    return {
      students: codes.map((scode) => ({
        scode, motherPhone: byPhone.get(scode) || '', phoneState: byPhone.has(scode) ? 'ok' : 'error',
        lastCounselDate: counsel.status === 'fulfilled' ? counsel.value[scode] || null : null,
        counselState: counsel.status === 'fulfilled' ? 'ok' : 'error',
      })),
      warnings,
    };
  }

  /**
   * 정규 분류로 좁힌 이번 달 담임 반과 반별 원생.
   * `proofRead`는 한 요청 안에서 최초 조회와 재확인을 구분하는 자리로, 모의 구현은 결정적이라 쓰지 않는다.
   */
  async getCurrentMonthRegularClassSnapshotForTeacher(
    targetDateOrMonth: string,
    expectedTeacherName: string,
    creds?: TttCreds | null,
    currentAssignments: TttRegularCurrentAssignment[] = [],
    _proofRead?: TttRegularClassProofRead,
    options: { includeUnsupportedStudents?: boolean } = {},
  ): Promise<TttRegularTeacherClassSnapshot> {
    return this.strictRead(`${expectedTeacherName} 정규 반별 원생목록`, creds, (account) =>
      this.gateway.getRegularClassSnapshot(account, targetDateOrMonth, expectedTeacherName, currentAssignments, options));
  }

  /** 다른 분류·특강 반까지 포함한 이번 달 본인 반과 학생 명단. */
  async getCurrentMonthOwnedClassSnapshotForTeacher(
    targetDateOrMonth: string,
    expectedTeacherName: string,
    creds?: TttCreds | null,
    _proofRead?: TttOwnedClassProofRead,
    options: {
      includeUnsupportedStudents?: boolean;
      includeSpecialClasses?: boolean;
      selectedClassCodes?: string[];
      cacheCatalog?: boolean;
      forceRefresh?: boolean;
    } = {},
  ): Promise<TttRegularTeacherClassSnapshot> {
    return this.strictRead(`${expectedTeacherName} 본인 반별 원생목록`, creds, (account) =>
      this.gateway.getOwnedClassSnapshot(account, targetDateOrMonth, expectedTeacherName, {
        includeUnsupportedStudents: options.includeUnsupportedStudents,
        includeSpecialClasses: options.includeSpecialClasses,
        selectedClassCodes: options.selectedClassCodes,
      }));
  }

  // ── 상담 쓰기 ─────────────────────────────────────────────
  async writeCounsel(args: CounselWriteArgs, creds?: TttCreds | null, options: CounselWriteOptions = {}): Promise<CounselWriteResult> {
    if (!creds) throw new Error('강사 통통통 계정이 필요합니다.');
    return writeCounselVerified(this.gateway, creds, args, options);
  }

  /** 이미 저장 요청이 끝난 미확인 상담을 읽기만으로 다시 확인한다. */
  async reconcileCounselWrite(
    args: CounselWriteArgs,
    beforeCount: number,
    writeDate: string,
    creds?: TttCreds | null,
  ): Promise<CounselWriteReconcileResult> {
    if (!creds) throw new Error('강사 통통통 계정이 필요합니다.');
    return reconcileCounselWrite(this.gateway, creds, args, beforeCount, writeDate);
  }

  /** 확인되지 않은 상담의 원인 진단. 진단 실패가 전송 상태에 영향을 주지 않도록 오류는 null로 바꾼다. */
  async diagnoseCounselWrite(args: CounselWriteArgs, writeDate: string, creds?: TttCreds | null): Promise<CounselWriteDiagnosis | null> {
    if (!creds) return null;
    try {
      return await diagnoseCounselWrite(this.gateway, creds, args, writeDate);
    } catch (e: any) {
      this.log.warn(`상담 전송 진단 실패: ${e?.message ?? e}`);
      return null;
    }
  }
}

/**
 * 특강 반과 특강 원생 연락처를 읽는 서버 전용 서비스.
 * 특강 반은 강사 개인 계정이 아니라 학원 단위로 조회하므로 강사 계정을 받지 않는다.
 */
export class TttSpecialService {
  constructor(private readonly gateway: TttGateway) {}

  getCurrentMonthClassSnapshot(targetDateOrMonth: string): Promise<TttSpecialSnapshot> {
    return this.gateway.getSpecialClassSnapshot(targetDateOrMonth);
  }

  getNearestClassSnapshot(targetDateOrMonth: string): Promise<TttSpecialSnapshot> {
    return this.gateway.getSpecialClassSnapshot(targetDateOrMonth, { nearest: true });
  }

  getStudentMotherPhones(studentCodes: string[]): Promise<TttMotherPhoneBatchResult> {
    return this.gateway.getStudentContacts(null, studentCodes);
  }
}
