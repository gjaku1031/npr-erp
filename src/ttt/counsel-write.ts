import { todayKST } from '../config';
import type { TttCreds, TttGateway } from './ttt.gateway';
import {
  TttCounselWriteIndeterminateError,
  type CounselWriteArgs,
  type CounselWriteDiagnosis,
  type CounselWriteEvidence,
  type CounselWriteKind,
  type CounselWriteOptions,
  type CounselWriteReconcileOptions,
  type CounselWriteReconcileResult,
  type CounselWriteResult,
} from './ttt.records';

/**
 * 외부 ERP 상담 쓰기의 확인 규칙.
 *
 * 상담 저장 요청은 비멱등이고 응답이 성공 여부를 알려 주지 않는다. 그래서 저장 전에 같은 원생·일자·주제·본문의
 * 상담 수를 세어 두고, 저장 뒤 다시 읽어 그 수가 늘었을 때만 성공으로 본다. 다시 읽기가 실패하거나 수가 늘지 않으면
 * "실패"가 아니라 "확인 불가"(`TttCounselWriteIndeterminateError`)로 돌려주고, 저장 요청은 절대 반복하지 않는다.
 * 네트워크와 응답 해석은 포트(`TttGateway`) 구현이 맡고, 이 모듈은 규칙만 가진다.
 */

const SUPPORTED_KINDS: readonly CounselWriteKind[] = ['counsel', 'absence-text'];

/** 지원하지 않는 상담 유형은 요청 전에 거부한다. 잘못된 값이 기본 상담으로 조용히 저장되는 것을 막는다. */
export function assertCounselWriteKind(kind: CounselWriteKind | undefined): CounselWriteKind {
  const normalized = kind || 'counsel';
  if (!SUPPORTED_KINDS.includes(normalized)) throw new Error('지원하지 않는 외부 ERP 상담 유형입니다.');
  return normalized;
}

function normalizedEvidenceDate(value: string): string {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
  return digits.length === 8 ? digits : '';
}

function normalizedEvidenceText(value: string): string {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r\n?/g, '\n')
    .trim();
}

export function canonicalEvidenceDate(value: string): string {
  const compact = normalizedEvidenceDate(value);
  return compact ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : '';
}

/** 운영 ERP의 상담 목록은 긴 본문을 정규화 후 9~10자 미리보기로 돌려주는 것이 확인됐다. */
const MIN_COUNSEL_BODY_PREVIEW_LENGTH = 9;

/**
 * 본문 대조. 원문 전체가 같거나, 충분히 긴 정확한 앞부분이면 같은 상담으로 본다.
 * 원생·일자·주제까지 모두 같고 저장 전후 건수가 늘어야 최종 성공이므로, 앞부분 일치만으로 기존 행을 새 전송으로 오인하지 않는다.
 */
export function counselBodyMatches(previewValue: string, contentValue: string): boolean {
  const preview = normalizedEvidenceText(previewValue);
  const content = normalizedEvidenceText(contentValue);
  if (!preview || !content) return false;
  if (preview === content) return true;
  return content.length > 10 && preview.length >= MIN_COUNSEL_BODY_PREVIEW_LENGTH && content.startsWith(preview);
}

/** 상담 목록에서 이번 상담과 원생·일자·주제·본문이 같은 행의 수를 센다. */
export function countCounselWriteMatches(
  rows: CounselWriteEvidence[],
  args: Pick<CounselWriteArgs, 'scode' | 'subject' | 'content'>,
  writeDate: string,
): number {
  const scode = String(args.scode || '').trim();
  const subject = normalizedEvidenceText(args.subject || '상담');
  const content = normalizedEvidenceText(args.content || '');
  const date = normalizedEvidenceDate(writeDate);
  return (rows || []).filter((row) =>
    String(row.scode || '').trim() === scode
    && normalizedEvidenceDate(row.date) === date
    && normalizedEvidenceText(row.topic) === subject
    && counselBodyMatches(row.body, content)).length;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** ERP가 저장 직후 목록 반영을 늦출 수 있어 약 5.5초 동안 다시 읽는다. */
export const DEFAULT_COUNSEL_READ_BACK_DELAYS_MS = [0, 250, 750, 1500, 3000] as const;

async function requireClassCode(gateway: TttGateway, account: TttCreds, className: string): Promise<string> {
  const classCode = await gateway.resolveClassCode(account, className);
  if (!classCode) throw new Error(`반코드를 찾을 수 없습니다: ${className}`);
  return classCode;
}

/**
 * 이미 저장 요청을 마친 상담을 목록 읽기만으로 다시 확인한다.
 * 저장 요청을 절대 보내지 않으므로 확인 불가 건의 수동·백그라운드 재확인에 쓸 수 있다. 일시적 읽기 오류는 다음 간격에 다시 시도한다.
 */
export async function reconcileCounselWrite(
  gateway: TttGateway,
  account: TttCreds,
  args: CounselWriteArgs,
  beforeCount: number,
  writeDate: string,
  options: CounselWriteReconcileOptions = {},
): Promise<CounselWriteReconcileResult> {
  const classCode = options.classCode || await requireClassCode(gateway, account, args.className);
  const evidenceArgs = { ...args, subject: (args.subject || '상담').trim() || '상담', content: (args.content || '').trim() };
  const canonicalDate = canonicalEvidenceDate(writeDate) || writeDate;
  const delays = options.delaysMs?.length ? options.delaysMs : DEFAULT_COUNSEL_READ_BACK_DELAYS_MS;
  let afterCount = beforeCount;
  let successfulReads = 0;
  let lastError: unknown;
  for (const delay of delays) {
    if (delay > 0) await wait(delay);
    try {
      const rows = await gateway.listCounselEvidence(account, classCode, { scode: args.scode, date: canonicalDate });
      successfulReads += 1;
      afterCount = countCounselWriteMatches(rows, evidenceArgs, canonicalDate);
      if (afterCount > beforeCount) {
        return { confirmed: true, verification: 'read-after-write-count-increased', beforeCount, afterCount, writeDate: canonicalDate };
      }
    } catch (error) {
      lastError = error;
    }
  }
  // 모든 읽기가 실패했으면 구체 오류를 그대로 올린다. 쓰기 흐름은 이를 확인 불가로 감싼다.
  if (successfulReads === 0 && lastError) throw lastError;
  return { confirmed: false, verification: 'not-observed', beforeCount, afterCount, writeDate: canonicalDate };
}

/**
 * 상담 쓰기: 저장 전 건수 고정 → 호출자의 시도 기록(onBeforePost) → 저장 요청 1회 → 다시 읽어 대조.
 * 저장 전 읽기가 실패하면 저장 요청을 보내지 않는다. 저장 요청 뒤의 모든 실패는 확인 불가로 돌려준다.
 */
export async function writeCounselVerified(
  gateway: TttGateway,
  account: TttCreds,
  args: CounselWriteArgs,
  options: CounselWriteOptions = {},
): Promise<CounselWriteResult> {
  const content = (args.content || '').trim();
  if (!content) throw new Error('상담 내용을 입력해 주세요.');
  const kind = assertCounselWriteKind(args.kind);
  const classCode = await requireClassCode(gateway, account, args.className);
  const writeDate = canonicalEvidenceDate(args.date || '') || todayKST();
  const subject = (args.subject || '상담').trim() || '상담';
  const evidenceArgs = { ...args, subject, content };

  const beforeRows = await gateway.listCounselEvidence(account, classCode, { scode: args.scode, date: writeDate });
  const beforeCount = countCounselWriteMatches(beforeRows, evidenceArgs, writeDate);

  // 비멱등 저장 요청보다 앱의 전송 시도 상태를 먼저 영속한다. 콜백이 실패하면 저장 요청에 도달하지 않는다.
  if (options.onBeforePost) await options.onBeforePost({ beforeCount, writeDate });

  let notice = '';
  try {
    const response = await gateway.postCounsel(account, {
      classCode,
      scode: args.scode,
      sname: args.sname || '',
      subject,
      content,
      date: writeDate,
      kind,
      openLevel: args.openLevel ?? 0,
    });
    notice = response.notice;
    // 응답이 로그인 화면이어도 저장 처리에 도달했는지는 단정할 수 없다. 다시 보내지 않고 읽기 전용 재확인에 맡긴다.
    if (response.sessionExpired) throw new TttCounselWriteIndeterminateError(undefined, beforeCount, writeDate, beforeCount);
  } catch (error) {
    if (error instanceof TttCounselWriteIndeterminateError) throw error;
    // 요청이 서버에 도달했는지 알 수 없으므로 자동 재시도 가능한 일반 실패로 바꾸지 않는다.
    throw new TttCounselWriteIndeterminateError(undefined, beforeCount, writeDate, beforeCount);
  }

  try {
    const reconciled = await reconcileCounselWrite(gateway, account, evidenceArgs, beforeCount, writeDate, {
      classCode, delaysMs: options.delaysMs,
    });
    if (reconciled.confirmed) {
      return {
        ok: true,
        verified: true,
        verification: 'read-after-write-count-increased',
        beforeCount,
        afterCount: reconciled.afterCount,
        writeDate: reconciled.writeDate,
      };
    }
    throw new TttCounselWriteIndeterminateError(undefined, beforeCount, writeDate, reconciled.afterCount, notice);
  } catch (error) {
    if (error instanceof TttCounselWriteIndeterminateError) throw error;
    throw new TttCounselWriteIndeterminateError(undefined, beforeCount, writeDate, beforeCount, notice);
  }
}

/**
 * 확인되지 않은 상담의 원인을 읽기만으로 좁힌다. 저장 요청은 보내지 않는다.
 * "반 명단에 없는 원생"과 "다른 반으로 저장됨"은 반별 목록만으로는 구분되지 않아 명단과 강사별 상담 목록을 함께 본다.
 */
export async function diagnoseCounselWrite(
  gateway: TttGateway,
  account: TttCreds,
  args: CounselWriteArgs,
  writeDate: string,
): Promise<CounselWriteDiagnosis> {
  const canonicalDate = canonicalEvidenceDate(writeDate) || writeDate;
  const scode = String(args.scode || '').trim();
  let classCode = '';
  try { classCode = (await gateway.resolveClassCode(account, args.className)) || ''; } catch { /* 해석 실패도 진단 결과의 일부다. */ }

  let rosterHasStudent: boolean | null = null;
  try {
    const roster = await gateway.getRoster(account, args.className, canonicalDate);
    // 빈 명단은 "학생이 없다"가 아니라 "명단을 읽지 못했다"에 가깝다.
    if (roster.length) rosterHasStudent = roster.some((row) => String(row.scode || '').trim() === scode);
  } catch { /* 판단 보류 */ }

  let teacherScopeMatch: boolean | null = null;
  try {
    const rows = await gateway.getCounsel(account, canonicalDate, []);
    const subject = normalizedEvidenceText(args.subject || '상담');
    const student = String(args.sname || '').trim();
    const day = normalizedEvidenceDate(canonicalDate);
    teacherScopeMatch = rows.some((row) =>
      String(row.student || '').trim() === student
      && normalizedEvidenceDate(row.date || '') === day
      && normalizedEvidenceText(row.topic) === subject
      && counselBodyMatches(row.body, args.content || ''));
  } catch { /* 판단 보류 */ }

  return { classCode, rosterHasStudent, teacherScopeMatch };
}
