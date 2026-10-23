import type {
  AttRow,
  Counsel,
  CounselPostInput,
  CounselPostResponse,
  CounselWriteEvidence,
  Notebook,
  RosterRow,
  ScoreRow,
} from './ttt.records';
import type {
  TttMotherPhoneBatchResult,
  TttRegularCurrentAssignment,
  TttRegularTeacherClassSnapshot,
  TttSpecialSnapshot,
} from './ttt.special';

/**
 * 외부 ERP(통통통) 연동 포트.
 *
 * 앱은 이 인터페이스로만 외부 ERP를 읽고 쓴다. 운영에서는 강사별 ERP 계정으로 로그인하는
 * 구현이 있었고, 공개 저장소에는 결정적인 가상 데이터를 돌려주는 `MockTttGateway`만 있다.
 * 구현은 모든 조회를 "그 계정이 볼 수 있는 자료"로 제한해야 한다.
 */

/** 강사별 외부 ERP 계정. 비밀번호는 DB에 암호화해 저장하고 서버 안에서만 복호화한다. */
export interface TttCreds {
  id: string;
  pw: string;
}

/** 알림장 첨부. 새 첨부는 base64로 받고, 수정할 때 유지할 기존 첨부는 참조 문자열로 받는다. */
export interface NbAttach {
  urls?: string[];
  images?: { filename: string; b64: string }[];
  files?: { filename: string; b64: string }[];
  keepImages?: string;
  keepImageSizes?: string;
  keepFiles?: string;
  keepFileSizes?: string;
}

export interface NotebookPost {
  title: string;
  body: string;
  files: string[];
  cmtId?: string | null;
  attach?: NbAttach;
}

export interface OwnedClassReadOptions {
  includeUnsupportedStudents?: boolean;
  includeSpecialClasses?: boolean;
  /** 지정하면 이 반 코드만 읽는다(적용 직전 재확인용). */
  selectedClassCodes?: string[];
}

export interface TttGateway {
  /** 계정을 확인하고 ERP에 표시되는 회원명을 돌려준다. 실패하면 throw한다. */
  verifyAccount(account: TttCreds): Promise<{ memberName: string }>;

  getNotebook(account: TttCreds | null, className: string, date: string): Promise<Notebook>;
  /** 같은 반·날짜 알림장이 있으면 제자리 수정(cmtId)하고, 없으면 새로 게시한다. */
  postNotebook(account: TttCreds | null, className: string, date: string, post: NotebookPost): Promise<Notebook>;

  getAttendance(account: TttCreds, className: string, date: string): Promise<AttRow[]>;
  getCounsel(account: TttCreds, date: string, classes: string[]): Promise<Counsel[]>;
  getScores(account: TttCreds, className: string, scoreDate: string, hwDate: string): Promise<ScoreRow[]>;
  /** 반의 최근 수업일 기준 재원생 명단과 연락처. */
  getRoster(account: TttCreds, className: string, date: string): Promise<RosterRow[]>;

  /** 강사 본인이 담임인 이번 달 반과 반별 원생(다른 분류·특강 반 포함 가능). */
  getOwnedClassSnapshot(
    account: TttCreds,
    targetDateOrMonth: string,
    teacherName: string,
    options?: OwnedClassReadOptions,
  ): Promise<TttRegularTeacherClassSnapshot>;
  /** 정규 분류로 좁힌 이번 달 담임 반. 상담 업무의 명단 갱신에 쓴다. */
  getRegularClassSnapshot(
    account: TttCreds,
    targetDateOrMonth: string,
    teacherName: string,
    currentAssignments?: TttRegularCurrentAssignment[],
    options?: { includeUnsupportedStudents?: boolean },
  ): Promise<TttRegularTeacherClassSnapshot>;
  /** 특강 분류 반. `nearest`면 비어 있지 않은 가장 가까운 수강년월을 찾는다. */
  getSpecialClassSnapshot(targetDateOrMonth: string, options?: { nearest?: boolean }): Promise<TttSpecialSnapshot>;

  /** 원생별 보호자 연락처. 원생마다 성공/실패를 따로 돌려준다. */
  getStudentContacts(account: TttCreds | null, studentCodes: string[]): Promise<TttMotherPhoneBatchResult>;
  /** 원생 코드 → 마지막으로 완료된 상담일(YYYY-MM-DD). 기록이 없으면 키가 없다. */
  getLastCounselDates(account: TttCreds, studentCodes: string[], today: string): Promise<Record<string, string>>;

  /** 반 이름을 ERP 반 코드로 바꾼다. 찾지 못하면 null. */
  resolveClassCode(account: TttCreds, className: string): Promise<string | null>;
  /** 반별 상담 목록을 원생·일자로 좁혀 읽는다. 상담 쓰기 전후 대조에 쓰는 읽기 전용 조회다. */
  listCounselEvidence(account: TttCreds, classCode: string, filter: { scode: string; date: string }): Promise<CounselWriteEvidence[]>;
  /**
   * 상담 저장 요청을 한 번 보낸다. 비멱등이고 성공을 알려 주지 않으므로, 성공 판정은 `counsel-write.ts`가
   * 저장 전후 목록을 대조해 한다. 요청이 서버에 도달했는지 모르는 실패는 throw한다.
   */
  postCounsel(account: TttCreds, input: CounselPostInput): Promise<CounselPostResponse>;
}
