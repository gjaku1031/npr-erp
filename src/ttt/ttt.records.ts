/**
 * 외부 ERP의 성적·명단·상담 기록 계약 타입.
 *
 * 상담 쓰기는 응답이 유실될 수 있는 비멱등 작업이다. 그래서 결과를 "성공/실패" 둘로 나누지 않고
 * "쓰기 전후 같은 상담 건수가 늘었는지"로 확인하며, 확인하지 못한 경우는 별도 오류로 구분한다.
 */

export interface Notebook {
  written: boolean;
  title: string;
  body: string;
  files: string[];
  postedAt: string | null;
  source: string | null;
  /** ERP 글 id. 수정할 때 제자리 업데이트에 쓴다. */
  cmtId?: string | null;
}

export interface AttRow {
  id: number;
  name: string;
  in: string;
  out: string;
  st: string;
  tone: 'success' | 'warning' | 'destructive';
  /** 학교명(호버 표시). */
  school?: string;
  /** 보호자 연락처(호버 표시). */
  motherPhone?: string;
}

export interface Counsel {
  student: string;
  topic: string;
  body: string;
  cls?: string;
  date?: string;
}

export interface ScoreRow {
  student: string;
  total: string;
  avg: string;
  rank: string;
  examinees: string;
  opinion: string;
  hwAhead: string;
  hwDeepen: string;
}

export interface RosterRow {
  /** 원생 코드(상담 쓰기 대상 식별자). */
  scode: string;
  name: string;
  motherPhone: string;
  fatherPhone: string;
  /** 최근 수업일 출결 상태. */
  status: string;
  /** 오늘까지 이 반에서 이 학생 상담이 있는지. */
  hasCounsel: boolean;
  /** 최근 상담 주제/내용 미리보기. */
  lastCounsel: string;
}

export type CounselWriteKind = 'counsel' | 'absence-text';

export interface CounselWriteArgs {
  scode: string;
  sname: string;
  className: string;
  content: string;
  subject?: string;
  openLevel?: 0 | 1 | 2 | 3;
  date?: string;
  /** 생략하면 담임 상담. `absence-text`는 부재/문자 기록으로 저장한다. */
  kind?: CounselWriteKind;
}

/** 상담 목록에서 읽은 한 행. 대조에 쓰는 안정 필드와 본문 미리보기만 담는다. */
export interface CounselWriteEvidence {
  scode: string;
  student: string;
  topic: string;
  /** ERP가 돌려주는 본문. 긴 본문은 앞부분 9~10자 미리보기만 올 수 있다. */
  body: string;
  date: string;
}

/** 포트에 넘기는 상담 저장 요청. 반 코드와 상담일자는 쓰기 흐름이 확정해서 넘긴다. */
export interface CounselPostInput {
  classCode: string;
  scode: string;
  sname: string;
  subject: string;
  content: string;
  date: string;
  kind: CounselWriteKind;
  openLevel: 0 | 1 | 2 | 3;
}

/** 상담 저장 요청의 응답. 성공 여부가 아니라 "확인할 수 없는 응답인지"와 ERP 안내문만 담는다. */
export interface CounselPostResponse {
  /** 응답이 로그인 화면 등으로 돌아와 저장 처리에 도달했는지 알 수 없음. */
  sessionExpired: boolean;
  /** ERP가 응답에 남긴 안내문. 저장이 거부된 이유가 여기에만 있을 수 있다. */
  notice: string;
}

export interface CounselWriteResult {
  ok: true;
  verified: true;
  verification: 'read-after-write-count-increased';
  beforeCount: number;
  afterCount: number;
  /** 실제 ERP 상담일자. 확인 대기 건을 나중에 읽기 전용으로 재검증할 때 사용한다. */
  writeDate: string;
}

export interface CounselWriteReconcileResult {
  confirmed: boolean;
  verification: 'read-after-write-count-increased' | 'not-observed';
  beforeCount: number;
  afterCount: number;
  writeDate: string;
}

export interface CounselWriteReconcileOptions {
  /** 쓰기 직전에 이미 확정한 반코드. */
  classCode?: string;
  /** 쓰기 뒤 다시 읽기까지의 대기 간격(ms). 테스트와 호출자 제어용. */
  delaysMs?: readonly number[];
}

export interface CounselWriteBeforePostEvidence {
  beforeCount: number;
  writeDate: string;
}

export interface CounselWriteOptions extends CounselWriteReconcileOptions {
  /**
   * 사전 조회가 끝난 뒤 실제 저장 요청 직전에 실행한다.
   * 호출자가 전송 시도를 DB에 먼저 고정하지 못하면 throw해서 저장 요청을 막을 수 있다.
   */
  onBeforePost?: (evidence: CounselWriteBeforePostEvidence) => void | Promise<void>;
}

/**
 * "ERP 반영 여부 미확인"을 뜻하는 오류. 실패가 아니므로 상위 계층은 자동 재전송하거나
 * 전송 완료로 표시하면 안 된다.
 */
export class TttCounselWriteIndeterminateError extends Error {
  constructor(
    message = '외부 ERP 상담 저장 결과를 확인하지 못했습니다.',
    public readonly beforeCount = 0,
    public readonly writeDate = '',
    public readonly afterCount = beforeCount,
    /** 저장 응답에 담긴 ERP 안내문. 저장이 거부된 이유를 그대로 보존한다. */
    public readonly erpNotice = '',
  ) {
    super(message);
    this.name = 'TttCounselWriteIndeterminateError';
  }
}

export interface CounselWriteDiagnosis {
  /** 쓰기·검증에 쓴 반코드(해석 실패 시 빈 문자열). */
  classCode: string;
  /** 반 명단에서 이 원생을 확인했는가. null = 명단 자체를 읽지 못함(판단 보류). */
  rosterHasStudent: boolean | null;
  /** 강사별 상담 목록(반 무관)에 같은 상담이 있는가. null = 조회 실패. */
  teacherScopeMatch: boolean | null;
}
