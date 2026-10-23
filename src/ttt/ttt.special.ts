/**
 * 외부 ERP의 반·원생 명단 계약 타입.
 *
 * 앱은 이 타입으로만 반 목록, 반별 원생, 특강 반, 연락처 조회 결과를 다룬다.
 * 실제 조회는 `TttGateway` 구현이 맡고, 공개 저장소에는 모의 구현(`ttt.mock.ts`)만 있다.
 */

export const SPECIAL_MWF_SCHEDULE = '1010100' as const;
export const SPECIAL_TTS_SCHEDULE = '0101010' as const;

export type TttSpecialClassCode = string;
export type TttSpecialStudentCode = string;
export type TttSpecialTeacherName = string;
export type TttSpecialSupportedSchedule =
  | typeof SPECIAL_MWF_SCHEDULE
  | typeof SPECIAL_TTS_SCHEDULE;
export type TttSpecialGroup = '특강 월수금반' | '특강 화목토반';

export interface TttSpecialCategory {
  topCode: string;
  topName: string;
  middleCode: string;
  middleName: string;
  /** 분류에 속한 반 코드/반명. */
  classCatalog?: Array<{ classCode: TttSpecialClassCode; className: string }>;
}

export interface TttSpecialStudent {
  studentCode: TttSpecialStudentCode;
  studentName: string;
  /** Store 동기화 계약용 별칭. studentCode와 항상 같다. */
  scode: TttSpecialStudentCode;
  /** Store 동기화 계약용 별칭. studentName과 항상 같다. */
  student: string;
  classCode: TttSpecialClassCode;
  division: string;
  grade: string;
  registrationStart: string;
  registrationEnd: string;
  status: string;
  nickname: string;
}

export interface TttSpecialClass {
  classCode: TttSpecialClassCode;
  className: string;
  teacherName: TttSpecialTeacherName;
  scheduleCode: TttSpecialSupportedSchedule;
  group: TttSpecialGroup;
  /** Store 동기화 계약용 요일 키. */
  dayGroup: 'M' | 'T';
  startTime: string;
  endTime: string;
  room: string;
  students: TttSpecialStudent[];
}

export interface TttSpecialUnsupportedSchedule {
  classCode: TttSpecialClassCode;
  className: string;
  teacherName: TttSpecialTeacherName;
  /** ERP 요일표 원문. 빈 값도 별도의 미지원 일정으로 보고한다. */
  scheduleCode: string;
  startTime: string;
  endTime: string;
  room: string;
  studentCount: number;
}

export interface TttSpecialMonthData {
  month: string;
  classes: TttSpecialClass[];
  unsupportedSchedules: TttSpecialUnsupportedSchedule[];
  /** 지원/미지원 일정을 모두 포함한 반 수. */
  listedClassCount: number;
  /** 같은 원생이 여러 반에 있으면 각각 세는 반-원생 등록 건수. */
  listedEnrollmentCount: number;
  /** 지원 일정 반에 속한 고유 원생 수. */
  uniqueSupportedStudentCount: number;
}

export interface TttSpecialSnapshot extends TttSpecialMonthData {
  targetMonth: string;
  sourceMonth: string;
  /** 실제 조회한 순서. 기준 월, 이전 월, 다음 월 순으로 최대 ±12개월이다. */
  searchedMonths: string[];
}

export type TttRegularDayGroup = 'M' | 'T';

export interface TttRegularCatalogClass {
  topCode: string;
  middleCode: string;
  classCode: string;
  className: string;
  /**
   * 팀장 정규반 동기화에서는 초등부/초등3~6으로 좁혀지지만, 다른 팀의 본인 반
   * 동기화는 예비반 등 별도 분류도 같은 안전한 반/담임 검증 파이프라인으로 읽는다.
   */
  topName: string;
  middleName: string;
}

export interface TttRegularExtensionClass {
  classCode: string;
  className: string;
  topName: string;
  middleName: string;
}

export interface TttRegularCategoryCatalog {
  classes: TttRegularCatalogClass[];
  /** 분류와 무관하게 반명에 [연장]이 포함된 모든 반. */
  extensionClasses: TttRegularExtensionClass[];
}

export interface TttRegularTeacherFilter {
  teacherCode: string;
  teacherName: string;
}

export interface TttRegularClassDetail {
  primaryTeacherCode: string;
  /** 반 상세의 selected timetable에서 엄격히 확인한 7자리 요일표. 증거가 없으면 null이다. */
  scheduleCode: string | null;
}

export type TttRegularClassProofLane = 'initial' | 'confirmation';

interface TttRegularClassProof {
  acamCode: string;
  catalog: TttRegularCategoryCatalog;
  details: Map<string, TttRegularClassDetail>;
  fingerprint: string;
}

/** 한 API 요청 안에서만 공유한다. 전역/TTL 캐시로 승격하지 않는다. */
export interface TttRegularClassProofScope {
  fingerprint: string;
  slots: Partial<Record<TttRegularClassProofLane, Promise<TttRegularClassProof>>>;
}

export interface TttRegularClassProofRead {
  scope: TttRegularClassProofScope;
  lane: TttRegularClassProofLane;
}

export function createRegularClassProofScope(): TttRegularClassProofScope {
  return { fingerprint: '', slots: {} };
}

interface TttOwnedClassCatalogProof {
  acamCode: string;
  catalog: TttRegularCategoryCatalog;
  includeSpecialClasses: boolean;
  fingerprint: string;
}

/** 다른 팀 본인 반 조회의 최초/재확인 카탈로그를 한 API 요청 안에서만 분리 보관한다. */
export interface TttOwnedClassProofScope {
  fingerprint: string;
  slots: Partial<Record<TttRegularClassProofLane, Promise<TttOwnedClassCatalogProof>>>;
}

export interface TttOwnedClassProofRead {
  scope: TttOwnedClassProofScope;
  lane: TttRegularClassProofLane;
}

export function createOwnedClassProofScope(): TttOwnedClassProofScope {
  return { fingerprint: '', slots: {} };
}

export interface TttRegularCurrentAssignment {
  className: string;
  dayGroup: TttRegularDayGroup;
}

export interface TttRegularNonPrimaryCurrentClass extends TttRegularCurrentAssignment {
  classCode: string;
  primaryStatus: 'unassigned' | 'other-teacher';
}

export interface TttRegularClass extends TttRegularCatalogClass {
  scheduleCode: TttSpecialSupportedSchedule;
  dayGroup: TttRegularDayGroup;
  startTime: string;
  endTime: string;
  room: string;
  studentCount: number;
  /** 반별 원생목록의 현재 수강생. 같은 학생은 반 코드 + 원생 코드로 중복 제거한다. */
  students: TttSpecialStudent[];
}

export interface TttRegularUnsupportedSchedule extends TttRegularCatalogClass {
  /** 동일 반에 요일표가 여러 개 오면 모두 보고한다. 빈 문자열도 유효한 미지원 값이다. */
  scheduleCodes: string[];
  startTime: string;
  endTime: string;
  room: string;
  studentCount: number;
  /** 본인 반 명단 화면처럼 명시적으로 요청한 좁은 경로에서만 유지한다. 일반 진단/동기화 응답에는 싣지 않는다. */
  students?: TttSpecialStudent[];
}

export interface TttRegularExcludedExtension extends TttRegularExtensionClass {
  studentCount: number;
}

export interface TttRegularMonthData {
  month: string;
  classes: TttRegularClass[];
  excludedExtensions: TttRegularExcludedExtension[];
  unsupportedSchedules: TttRegularUnsupportedSchedule[];
  /** [연장]을 제외한 대상 분류의 활성 반 수(미지원 요일표 포함). */
  listedClassCount: number;
  listedEnrollmentCount: number;
}

export interface TttRegularClassCatalogSnapshot extends TttRegularMonthData {
  targetMonth: string;
  sourceMonth: string;
  searchedMonths: string[];
}

export interface TttRegularTeacherClassSnapshot extends TttRegularClassCatalogSnapshot {
  /** ERP 강사별 필터에서 앱 강사명과 정확히 일치해 사용한 코드/이름. */
  teacherFilter: TttRegularTeacherFilter;
  /** 앱에는 배정돼 있지만 반 상세에서 현재 강사가 담임이 아님을 명시적으로 확인한 반. */
  nonPrimaryCurrentClasses: TttRegularNonPrimaryCurrentClass[];
}

export type TttMotherPhoneFailureReason =
  | 'invalid-student-code'
  | 'session-expired'
  | 'request-failed'
  | 'invalid-response';

export interface TttMotherPhoneResult {
  studentCode: TttSpecialStudentCode;
  /** 원부에 번호가 없으면 빈 문자열. */
  motherPhone: string;
}

export interface TttMotherPhoneFailure {
  studentCode: TttSpecialStudentCode;
  reason: TttMotherPhoneFailureReason;
}

export interface TttMotherPhoneBatchResult {
  phones: TttMotherPhoneResult[];
  failures: TttMotherPhoneFailure[];
}

export interface TttMotherPhoneBatchSummary {
  requested: number;
  received: number;
  populated: number;
  empty: number;
  failures: number;
  failuresByReason: Record<TttMotherPhoneFailureReason, number>;
  allFailed: boolean;
}

/** 개인정보 없이 연락처 상세 조회 결과의 성공/실패 개수만 요약한다. */
export function summarizeSpecialMotherPhoneBatch(
  studentCodes: TttSpecialStudentCode[],
  result: TttMotherPhoneBatchResult,
): TttMotherPhoneBatchSummary {
  const requestedCodes = new Set(studentCodes.map((code) => String(code ?? '').trim()).filter(Boolean));
  const phones = result.phones.filter((row) => requestedCodes.has(String(row.studentCode || '').trim()));
  const failures = result.failures.filter((row) => requestedCodes.has(String(row.studentCode || '').trim()));
  const failuresByReason: Record<TttMotherPhoneFailureReason, number> = {
    'invalid-student-code': 0,
    'session-expired': 0,
    'request-failed': 0,
    'invalid-response': 0,
  };
  for (const failure of failures) failuresByReason[failure.reason] += 1;
  const populated = phones.filter((row) => !!String(row.motherPhone || '').trim()).length;
  return {
    requested: requestedCodes.size,
    received: phones.length,
    populated,
    empty: phones.length - populated,
    failures: failures.length,
    failuresByReason,
    allFailed: requestedCodes.size > 0 && phones.length === 0,
  };
}

/** 명단 조회 실패 분류. 라우트는 CONFIG=503, NO_DATA=404, 나머지=502로 응답한다. */
export type TttSpecialErrorCode =
  | 'CONFIG'
  | 'SESSION_EXPIRED'
  | 'LIST_PARSE_FAILED'
  | 'NO_DATA';

export class TttSpecialError extends Error {
  constructor(
    public readonly code: TttSpecialErrorCode,
    message: string,
    public readonly searchedMonths: string[] = [],
  ) {
    super(message);
    this.name = 'TttSpecialError';
  }
}
