export interface CounselRosterSyncFailure {
  cls: string;
  message: string;
}

export interface CounselRosterSyncProgress {
  processed: number;
  total: number;
  percent: number;
  currentClass: string;
  failures: CounselRosterSyncFailure[];
}

/**
 * 반 단위 ERP 요청을 동시성 1로 실행한다. 중간 반은 delta, 마지막 반만 full로 호출해
 * 실제 진행률을 제공하면서 전체 앱 상태 fold는 정상 경로에서 한 번만 수행한다.
 */
export async function runSequentialCounselRosterSync(
  classes: string[],
  syncClass: (cls: string, responseMode: 'delta' | 'full') => Promise<any>,
  onProgress: (progress: CounselRosterSyncProgress) => void,
) {
  const failures: CounselRosterSyncFailure[] = [];
  const total = classes.length;
  onProgress({ processed: 0, total, percent: 0, currentClass: classes[0] || '', failures: [] });
  let finalStateFolded = false;
  for (let index = 0; index < classes.length; index += 1) {
    const cls = classes[index];
    const responseMode = index === classes.length - 1 ? 'full' : 'delta';
    try {
      const result = await syncClass(cls, responseMode);
      if (responseMode === 'full' && result?.state) finalStateFolded = true;
    } catch (error: any) {
      failures.push({ cls, message: String(error?.message || error || '동기화 실패') });
    }
    const processed = index + 1;
    onProgress({
      processed,
      total,
      percent: total ? Math.round(processed / total * 100) : 100,
      currentClass: processed < total ? classes[processed] : '',
      failures: failures.slice(),
    });
  }
  return { failures, finalStateFolded };
}

// ── 현재 월 학생 명단 재조정(prepare) 요약 ──
export interface CounselRosterReconcile {
  added?: number;
  updated?: number;
  inactivated?: number;
  reactivated?: number;
  rosterCount?: number;
}

// prepare 응답에서 재조정 수치만 방어적으로 추린다. 값이 하나도 없으면 null(요약 미표시).
export function pickCounselReconcile(prepared: any): CounselRosterReconcile | null {
  const num = (value: any) => { const n = Number(value); return Number.isFinite(n) ? n : undefined; };
  const src = prepared || {};
  const counts = src.counts || {};
  const out: CounselRosterReconcile = {
    added: num(src.added),
    updated: num(src.updated),
    inactivated: num(src.inactivated),
    reactivated: num(src.reactivated),
    rosterCount: num(src.rosterCount) ?? num(counts.active),
  };
  return (Object.keys(out) as (keyof CounselRosterReconcile)[]).some((key) => out[key] !== undefined) ? out : null;
}

// 추가/수정/비활성/복원을 사람이 읽는 간결한 한 줄로. 값이 모두 0이면 '명단 변경 없음'.
export function counselReconcileSummary(reconcile: CounselRosterReconcile | null | undefined): string {
  if (!reconcile) return '';
  const parts: string[] = [];
  if (reconcile.added) parts.push(`추가 ${reconcile.added}`);
  if (reconcile.updated) parts.push(`수정 ${reconcile.updated}`);
  if (reconcile.inactivated) parts.push(`비활성 ${reconcile.inactivated}`);
  if (reconcile.reactivated) parts.push(`복원 ${reconcile.reactivated}`);
  return parts.length ? parts.join(' · ') : '명단 변경 없음';
}

export interface CounselRosterRefreshOutcome {
  prepared: boolean;
  /** 실제 활성 학생이 있어 연락처 새로고침을 시도한 반 목록. */
  classes: string[];
  contactFailures: CounselRosterSyncFailure[];
  finalStateFolded: boolean;
}

/**
 * 전체 상담 로스터 새로고침의 순서를 강제하는 순수 오케스트레이터.
 * 1) 항상 prepare(현재 월 학생 명단)를 먼저 부른다 — 기존 반 목록이 비었거나 '대상 없음'이어도 마찬가지다.
 *    prepare가 실패(throw)하면 그대로 전파해 연락처 단계·캐시 교체를 절대 실행하지 않는다(호출부가 기존 캐시를 보존).
 * 2) 성공하면 onPrepared로 정본 응답과 정규화된 반 목록을 한 번 넘긴다(반이 0개여도 호출 — 캐시를 정본으로 교체).
 * 3) 반/학생이 0개면 이미 최신(100%)이므로 오류가 아니라 성공으로 마감한다(연락처 단계 없음).
 * 4) 반이 있으면 정본 반 목록으로 어머니 전화를 동시성 1로 순차 새로고침한다(마지막 반만 full).
 */
export async function runCounselRosterRefresh(opts: {
  prepare: () => Promise<any>;
  onPrepared: (prepared: any, classes: string[]) => void;
  syncContacts: (cls: string, responseMode: 'delta' | 'full') => Promise<any>;
  onProgress: (progress: CounselRosterSyncProgress) => void;
}): Promise<CounselRosterRefreshOutcome> {
  const prepared = await opts.prepare();
  const classes = Array.from(new Set<string>(
    (Array.isArray(prepared?.classes) ? prepared.classes : []).map((value: any) => String(value)).filter(Boolean),
  ));
  // prepare 응답의 entries가 현재 활성 학생 정본이다. 학생이 없는 담당 반은 화면의 반 목록에는
  // 유지하되 연락처 조회 대상으로 보내지 않는다. 그렇지 않으면 서버가 엔트리 없는 반을
  // '업무 미배정'으로 방어하며 빈 명단이 거짓 실패로 표시된다.
  const contactClasses = Array.isArray(prepared?.entries)
    ? (() => {
      const populated = new Set<string>(prepared.entries
        .filter((entry: any) => entry?.rosterActive !== false)
        .map((entry: any) => String(entry?.cls || '').trim())
        .filter(Boolean));
      return classes.filter((className) => populated.has(className));
    })()
    : classes;
  opts.onPrepared(prepared, classes);
  if (!contactClasses.length) {
    return { prepared: true, classes: contactClasses, contactFailures: [], finalStateFolded: false };
  }
  const { failures, finalStateFolded } = await runSequentialCounselRosterSync(contactClasses, opts.syncContacts, opts.onProgress);
  return { prepared: true, classes: contactClasses, contactFailures: failures, finalStateFolded };
}
