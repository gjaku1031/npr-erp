import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { backend } from '@/src/backend';
import { HttpError } from '@/src/http-error';
import {
  createOwnedClassProofScope,
  createRegularClassProofScope,
  summarizeSpecialMotherPhoneBatch,
  TttSpecialError,
  type TttRegularClass,
  type TttRegularTeacherClassSnapshot,
} from '@/src/ttt/ttt.special';
import { TttCounselWriteIndeterminateError } from '@/src/ttt/ttt.records';
import { persistConfirmedExternalWrite } from '@/src/api/external-write-sync';
import { appSecret } from '@/src/secret';
import { assertSameOrigin, clearSessionCookie, issueSessionCookie, loginThrottle, resolveActor } from '@/src/auth';

export const config = { maxDuration: 120 }; // 특강 ERP 최근 월 탐색/반별 상세 연락처 조회 여유

const s = (v: any): string => (Array.isArray(v) ? v[0] : (v ?? '')) as string;
const dec = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };
const appToday = () => {
  const fixed = String(process.env.APP_TODAY || '').trim();
  if (fixed) return fixed;
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
};

type ClassCatalogProof = {
  teacherTid: string; sourceMonth: string; credentialBinding: string;
  expiresAt: number; fingerprint: string; classes: Record<string, string>;
};
const catalogProofSecret = () => appSecret();
function signClassCatalogProof(proof: ClassCatalogProof): string {
  const payload = Buffer.from(JSON.stringify(proof)).toString('base64url');
  const signature = createHmac('sha256', catalogProofSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function verifyClassCatalogProof(raw: unknown, teacherTid: string, sourceMonth: string, credentialBinding: string): ClassCatalogProof {
  const invalid = () => new HttpError(409, '반 목록 확인 정보가 만료되었거나 달라졌습니다. 통통통 반을 다시 불러와 주세요.');
  if (typeof raw !== 'string' || raw.length > 100_000) throw invalid();
  const parts = raw.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) throw invalid();
  const expected = createHmac('sha256', catalogProofSecret()).update(parts[0]).digest();
  const signature = Buffer.from(parts[1], 'base64url');
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw invalid();
  let proof: ClassCatalogProof;
  try { proof = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw invalid(); }
  if (!proof || proof.teacherTid !== teacherTid || proof.sourceMonth !== sourceMonth
    || proof.credentialBinding !== credentialBinding || !Number.isFinite(proof.expiresAt)
    || proof.expiresAt <= Date.now() || !proof.classes || typeof proof.classes !== 'object') throw invalid();
  return proof;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requestStartedAt = Date.now();
  const vercelRequestId = s(req.headers?.['x-vercel-id']);
  const { store, ttt, specialTtt, db } = backend();
  const p = ([] as string[]).concat((req.query.slug as any) || []); // /api/ 이후 경로 조각
  const m = (req.method || 'GET').toUpperCase();
  const q = req.query;
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const creds = (tid?: string) => (tid ? store.getTeacherTtt(tid) : null);
  // 행위자는 서명된 세션 쿠키로만 정한다(아래 try 안에서 원격 pull 뒤 확정). 요청의 role은 화면 선택일 뿐이다.
  let requestRole: 'lead' | 'teacher' | 'other' | null = null;
  let requestTid = '';
  const requireLead = () => {
    if (requestRole !== 'lead') throw new HttpError(403, '팀장만 사용할 수 있는 기능입니다.');
  };
  const requireTeacher = () => {
    if (requestRole !== 'teacher' && requestRole !== 'other') throw new HttpError(403, '상담 현황은 팀장에게 읽기 전용으로 제공됩니다.');
  };
  const requireOtherTeam = () => {
    if (requestRole !== 'other' || !store.isOtherTeamTeacher(requestTid)) {
      throw new HttpError(403, '다른 팀 권한이 있는 계정만 사용할 수 있습니다.');
    }
  };
  const requireOwnedOtherTeamCounsel = (taskId: string) => {
    if (requestRole === 'other' && !store.isOwnedOtherTeamCounselTask(taskId, requestTid)) {
      throw new HttpError(403, '본인이 만든 상담일정만 사용할 수 있습니다.');
    }
  };
  const boundTeacher = (requested?: string) => {
    const value = String(requested || '').trim();
    if (requestRole === 'lead') {
      if (!value) throw new HttpError(400, '강사를 선택해 주세요.');
      return value;
    }
    const ownName = store.resolveTeacherName(requestTid);
    if (!ownName) throw new HttpError(403, '강사 계정을 확인할 수 없습니다.');
    if (value && value !== ownName) throw new HttpError(403, '다른 강사의 상담 정보에는 접근할 수 없습니다.');
    return ownName;
  };
  const boundTid = (requested?: string) => {
    const value = String(requested || '').trim();
    if (requestRole === 'teacher' || requestRole === 'other') {
      if (!store.resolveTeacherName(requestTid)) throw new HttpError(403, '강사 계정을 확인할 수 없습니다.');
      if (value && value !== requestTid) throw new HttpError(403, '다른 강사의 통통통 계정을 사용할 수 없습니다.');
      return requestTid;
    }
    return value || requestTid;
  };
  const assertTeacherClassAccess = (className: string) => {
    const normalizedClass = String(className || '').trim();
    if (!normalizedClass) throw new HttpError(400, '반을 선택해 주세요.');
    if (requestRole === 'other') {
      if (!store.isOtherTeamRosterClass(requestTid, normalizedClass)) {
        throw new HttpError(403, '현재 선택한 본인 반만 사용할 수 있습니다.');
      }
      return;
    }
    if (
      requestRole === 'teacher'
      && typeof store.hasTeacherRosterSelection === 'function'
      && store.hasTeacherRosterSelection(requestTid)
      && !store.isTeacherRosterClass(requestTid, normalizedClass)
    ) {
      throw new HttpError(403, '반 관리에서 선택한 본인 반만 사용할 수 있습니다.');
    }
  };
  const assertCounselEntryAccess = (entry: any) => {
    if (!entry) throw new HttpError(400, '상담 항목을 찾을 수 없습니다.');
    if (requestRole === 'teacher' || requestRole === 'other') {
      const entryTeacherTid = String(entry.teacherTid || '').trim();
      if (entryTeacherTid !== String(requestTid || '').trim()) {
        throw new HttpError(403, '다른 강사의 상담 정보에는 접근할 수 없습니다.');
      }
      requireOwnedOtherTeamCounsel(String(entry.taskId || '').trim());
      if (entry.teacher !== boundTeacher(entry.teacher)) {
        throw new HttpError(403, '다른 강사의 상담 정보에는 접근할 수 없습니다.');
      }
    }
  };
  const assertCounselAbsenceAccess = (attempt: any) => {
    if (!attempt) throw new HttpError(400, '부재 상담 기록을 찾을 수 없습니다.');
    if (requestRole === 'teacher' || requestRole === 'other') {
      const parentEntry = store.getCounselEntry(String(attempt.entryId || '').trim());
      assertCounselEntryAccess(parentEntry);
      if (attempt.teacher !== parentEntry.teacher || attempt.teacher !== boundTeacher(attempt.teacher)) {
        throw new HttpError(403, '다른 강사의 부재 상담 정보에는 접근할 수 없습니다.');
      }
    }
  };

  // Turso 임베디드 리플리카 읽기-후-쓰기 일관성 (서버리스는 요청마다 다른 인스턴스 = 각자 /tmp 리플리카):
  //  · 상태 조회 전: 원격 pull → 다른 인스턴스가 방금 쓴 변경(공지 생성/삭제 등)도 즉시 반영
  //  · 변경 후: 원격 동기화 → 프라이머리 반영 + 다음 조회가 최신을 읽음
  // (Turso 아닐 땐 db.sync()가 no-op이라 로컬 개발엔 영향 없음)
  const a0 = p[0];
  const isLogin = a0 === 'login' && m === 'POST';
  const isLogout = a0 === 'logout' && m === 'POST';
  const isPublicRoute = a0 === 'health' || isLogin || isLogout;
  const isJournalCreate = a0 === 'journals' && m === 'POST' && !p[1];
  const isJournalItemTextEdit = a0 === 'journal-items' && m === 'POST' && p[2] === 'edit';
  const isTaskDefinitionWrite = a0 === 'tasks' && m === 'POST' && (!p[1] || p[2] === 'edit');
  // 특강상담 최초 생성은 원격 primary의 단일 트랜잭션이 직접 영속한다.
  // 학생 스냅샷을 다시 embedded replica로 왕복시키지 않고 PII 없는 task delta를 반환한다.
  const isPrimarySpecialTaskCreate = a0 === 'tasks' && m === 'POST' && !p[1]
    && String(b.tag || '').trim() === '특강 상담';
  const isReportSnapshotWrite = a0 === 'reports' && m === 'POST' && (p[3] === 'draft' || p[3] === 'submit');
  const isEventMutation = a0 === 'events' && (m === 'POST' || m === 'DELETE');
  // 체크 한 번마다 전체 상태를 다시 접으면 작은 개인일정 변경도 큰 응답이 된다.
  // todo는 메모 한 컬럼만 바꾸므로 엄격 동기화는 유지하되 작은 delta만 반환한다.
  const isEventTodoMutation = a0 === 'events' && m === 'POST' && p[2] === 'todo';
  const isCounselRosterDelta = a0 === 'counsel' && p[2] === 'sync-roster' && m === 'POST' && b.responseMode === 'delta';
  const isCounselRosterPrepare = a0 === 'counsel' && p[2] === 'sync-roster' && m === 'POST' && b.prepare === true;
  const isTeacherClassCatalogRead = a0 === 'class-management' && p[1] === 'catalog' && m === 'POST';
  const isTeacherClassApply = a0 === 'class-management' && p[1] === 'apply' && m === 'POST';
  const isLegacyClassMutation = m === 'POST' && (
    (a0 === 'other-team' && p[1] === 'classes' && p[2] === 'sync')
    || (a0 === 'special-classes' && p[1] === 'sync')
    || (a0 === 'regular-classes' && (p[1] === 'sync' || p[1] === 'quarter-start'))
    || (a0 === 'teachers' && !!p[1] && p[2] === 'classes')
  );
  const isOtherTeamClassSync = a0 === 'other-team' && p[1] === 'classes' && p[2] === 'sync' && m === 'POST';
  const isOtherTeamMutation = a0 === 'other-team' && (m === 'POST' || m === 'DELETE');
  const isPiiDelete = m === 'DELETE' && !!p[1] && (a0 === 'tasks' || a0 === 'teachers');
  const needsTeacherMutationLease = (
    (a0 === 'special-classes' && p[1] === 'sync' && m === 'POST')
    || (a0 === 'regular-classes' && (p[1] === 'sync' || p[1] === 'quarter-start') && m === 'POST')
    || (a0 === 'teachers' && (
      (!p[1] && m === 'POST')
      || (!!p[1] && !p[2] && m === 'DELETE')
      || (!!p[1] && p[2] === 'ttt' && m === 'POST')
      || (!!p[1] && p[2] === 'other-team' && m === 'POST')
    ))
    || (a0 === 'ttt' && p[1] === 'teacher-creds' && m === 'POST')
    || isTeacherClassApply
    || isOtherTeamClassSync
    || isCounselRosterPrepare
  );
  const needsStrictSync = (
    m === 'POST' && (
      a0 === 'special-period' || a0 === 'special-classes' || a0 === 'regular-classes' || a0 === 'counsel' ||
      isJournalCreate || isJournalItemTextEdit || (isTaskDefinitionWrite && !isPrimarySpecialTaskCreate) || isReportSnapshotWrite
    )
  ) || isPiiDelete || isEventMutation || needsTeacherMutationLease || isOtherTeamMutation;
  // 상태/보고서는 stale replica를 성공 응답으로 내보내면 방금 만든 업무가 사라진 것처럼 보인다.
  // 원격 pull이 실패하면 이전 스냅샷을 제공하지 않고 요청 자체를 실패시킨다.
  // 상담 상세 GET은 아래의 좁은 direct-primary 스냅샷으로 읽으므로 replica pull이 필요 없다.
  // 로그인도 최신 원격 강사 목록을 읽어야 한다. 콜드스타트 pull 실패를 무시한 빈/오래된
  // embedded replica에서 인증하면 존재하는 계정을 간헐적으로 '계정 없음'으로 오판한다.
  const needsStrictReadPull = isLogin || isTeacherClassCatalogRead
    || (m === 'GET' && (a0 === 'state' || a0 === 'reports' || a0 === 'other-team' || a0 === 'class-management'));
  let confirmedCounselWrite: {
    localMarked: boolean;
    verification: 'read-after-write-count-increased';
    beforeCount: number;
    afterCount: number;
  } | null = null;
  let confirmedWritePersistence: 'synced' | 'pending' | null = null;
  let pendingCounselWrite = false;
  let pendingWritePersistence: 'synced' | 'pending' | null = null;
  let counselResponseStatus: number | null = null;
  let regularClassPrimaryWrite = false;
  let counselRosterPrimaryWrite = false;
  let otherTeamPrimaryWrite = false;
  let teacherMutationLeaseToken = '';
  let requestPhase = 'auth';

  try {
    assertSameOrigin(req);
    if (isLegacyClassMutation) {
      throw new HttpError(410, '기존 자동 반 동기화는 종료되었습니다. 강사 현황 또는 본인 반 관리에서 통통통 반을 불러온 뒤 직접 선택해 주세요.');
    }
    requestPhase = 'pre-sync';
    if (needsStrictSync || needsStrictReadPull) db.syncStrict();
    if (!isPublicRoute) {
      requestPhase = 'auth';
      const actor = resolveActor(req, store);
      if (!actor) throw new HttpError(401, '로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.');
      requestRole = actor.role;
      requestTid = actor.tid;
    }
    if (needsTeacherMutationLease) {
      requestPhase = 'mutation-lease';
      teacherMutationLeaseToken = store.acquireTeacherClassMutationLease(`${m}:${p.join('/')}`);
      // lease 직전에 완료된 다른 인스턴스의 쓰기를 반드시 읽은 뒤 route가 snapshot을 만든다.
      db.syncStrict();
    }
    requestPhase = 'route';
    const out = await route();
    if (out === undefined) { res.status(404).json({ statusCode: 404, message: `Cannot ${m} /api/${p.join('/')}` }); return; }
    let payload: any = out;
    if (m !== 'GET') {
      requestPhase = 'post-sync';
      if (isLogin || isLogout || isTeacherClassCatalogRead) {
        // 인증 직전 strict pull로 이미 최신 원격 상태를 읽었다. 로그인은 쓰기가 없으므로 추가 sync 불필요.
      } else if (isPrimarySpecialTaskCreate) {
        // createSpecialCounselTaskOnPrimary에서 이미 원격 원본에 원자적으로 커밋됐다.
      } else if (needsStrictSync && (confirmedCounselWrite || pendingCounselWrite)) {
        const syncResult = persistConfirmedExternalWrite(() => db.syncStrict());
        if (confirmedCounselWrite) {
          confirmedWritePersistence = confirmedCounselWrite.localMarked && syncResult === 'synced' ? 'synced' : 'pending';
        }
        if (pendingCounselWrite) pendingWritePersistence = syncResult;
      } else if (counselRosterPrimaryWrite || otherTeamPrimaryWrite) {
        // Store의 좁은 primary 메서드가 원자 커밋 후 replica를 이미 best-effort로 갱신했다.
        // 여기서 embedded sync를 한 번 더 실행하면 오래된 replica 변경이 방금 쓴 원본과 경합할 수 있다.
      } else if (needsStrictSync && !regularClassPrimaryWrite) db.syncStrict();
      else if (regularClassPrimaryWrite) db.sync(); // 원격 primary 트랜잭션에서 이미 영속됨; replica 갱신은 best-effort
      else db.sync(); // 변경 반영(프라이머리 + 로컬 리플리카)
      // fold-state: 변경 응답에 최신 뷰 상태를 함께 실어 보냄 → 클라가 별도 GET /state 없이 즉시 반영(왕복 1회 제거).
      // login/ttt는 자체 응답 형태 유지.
      if (a0 !== 'login' && a0 !== 'logout' && a0 !== 'ttt' && out !== null && !isTeacherClassCatalogRead && !regularClassPrimaryWrite && !counselRosterPrimaryWrite && !otherTeamPrimaryWrite && !isCounselRosterDelta && !isPrimarySpecialTaskCreate && !isEventTodoMutation) {
        requestPhase = 'fold-state';
        try { payload = Object.assign(typeof out === 'object' ? { ...out } : { ok: true }, { state: store.getState(requestRole!, requestTid) }); } catch { /* fold 실패해도 변경 자체는 성공 */ }
      }
      if (confirmedCounselWrite) {
        const persistence = confirmedWritePersistence || (confirmedCounselWrite.localMarked ? 'synced' : 'pending');
        if (persistence === 'pending' && payload && typeof payload === 'object') {
          // 로컬 replica의 confirmed 상태가 Turso에 아직 반영되지 않았다. 이 임시 상태를
          // fold하면 상단 진행률만 완료되고 행은 pending인 모순이 생기므로 원격 확정 전에는 전달하지 않는다.
          delete payload.state;
          if (payload.entry && typeof payload.entry === 'object') {
            payload.entry = Object.assign({}, payload.entry, {
              synced: false,
              syncedAt: '',
              deliveryState: 'pending',
              deliveryPending: true,
              deliveryConfirmed: false,
            });
          }
        }
        payload = Object.assign(typeof payload === 'object' && payload !== null ? { ...payload } : { ok: true }, {
          delivery: {
            erp: 'confirmed',
            verification: confirmedCounselWrite.verification,
            persistence,
            doNotRetransmit: true,
            message: persistence === 'pending'
              ? '통통통 전송은 확인됐지만 앱 상태 저장이 지연 중입니다. 같은 상담을 다시 전송하지 마세요.'
              : '통통통 전송과 앱 상태 저장을 확인했습니다.',
          },
        });
      }
      if (pendingCounselWrite) {
        payload = Object.assign(typeof payload === 'object' && payload !== null ? { ...payload } : { ok: true }, {
          delivery: Object.assign({}, (payload as any)?.delivery || {}, {
            erp: 'unconfirmed',
            state: 'pending',
            persistence: pendingWritePersistence || 'pending',
            doNotRetransmit: true,
          }),
        });
      }
    }
    const responseStatus = (confirmedCounselWrite && confirmedWritePersistence === 'pending') || pendingCounselWrite
      ? 202
      : (counselResponseStatus ?? (m === 'POST' && !isTeacherClassCatalogRead ? 201 : 200));
    requestPhase = 'response';
    const durationMs = Date.now() - requestStartedAt;
    if (isPrimarySpecialTaskCreate) {
      console.info(JSON.stringify({
        level: 'info', message: 'special_task_primary_create', method: m,
        route: `/api/${p.join('/')}`, status: responseStatus, durationMs,
        created: !!(payload as any)?.created,
        rosterCount: Number((payload as any)?.rosterCount || 0),
        requestId: vercelRequestId || undefined,
      }));
    }
    if (durationMs >= 5000) {
      console.warn(JSON.stringify({
        level: 'warning', message: 'slow_api_request', method: m,
        route: `/api/${p.join('/')}`, status: responseStatus, durationMs,
        requestId: vercelRequestId || undefined,
      }));
    }
    res.status(responseStatus).json(payload === null ? null : payload);
  } catch (e: any) {
    const status = e instanceof HttpError
      ? e.status
      : e instanceof TttSpecialError
        ? (e.code === 'CONFIG' ? 503 : e.code === 'NO_DATA' ? 404 : 502)
        : (e?.status || 500);
    const controlled = e instanceof HttpError || e instanceof TttSpecialError;
    const message = controlled
      ? e.message
      : status >= 500
        ? '서버에서 요청을 안전하게 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        : (e?.message || '요청을 처리하지 못했습니다.');
    console.error(JSON.stringify({
      level: 'error', message: 'api_request_failed', method: m,
      route: `/api/${p.join('/')}`, status, phase: requestPhase,
      durationMs: Date.now() - requestStartedAt,
      requestId: vercelRequestId || undefined,
      errorName: String(e?.name || 'Error'),
      errorCode: e?.code ? String(e.code) : undefined,
      errorMessage: String(e?.message || '').slice(0, 300) || undefined,
    }));
    res.status(status).json({ statusCode: status, message, error: status === 400 ? 'Bad Request' : undefined });
  } finally {
    if (teacherMutationLeaseToken) {
      try { store.releaseTeacherClassMutationLease(teacherMutationLeaseToken); } catch { /* 3분 만료로 자동 회수 */ }
    }
  }

  function counselNaturalKey() {
    const hasStableIdentity = [b.taskId, b.cls, b.scode, b.teacher].some((value) => String(value || '').trim());
    if (!hasStableIdentity) return undefined;
    return {
      taskId: String(b.taskId || '').trim(),
      teacher: requestRole === 'teacher' || requestRole === 'other' ? boundTeacher() : String(b.teacher || '').trim(),
      cls: String(b.cls || '').trim(),
      scode: String(b.scode || '').trim(),
    };
  }

  function counselSyncedAt() {
    return new Date().toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }

  function pendingCounselPayload(entry: any, message?: string) {
    pendingCounselWrite = true;
    counselResponseStatus = 202;
    return {
      entry,
      delivery: {
        erp: 'unconfirmed',
        state: 'pending',
        persistence: 'synced',
        doNotRetransmit: true,
        message: message || entry?.deliveryMessage || '통통통 전송 결과를 확인 중입니다. 같은 상담을 다시 전송하지 마세요.',
      },
    };
  }

  /**
   * 저장이 확인되지 않은 상담에 "왜 안 보이는지"와 "다음에 무엇을 할지"를 붙인다.
   * 읽기 전용 진단이며, 실패하면 기본 안내만 남기고 전송 상태에는 손대지 않는다.
   */
  async function unconfirmedCounselGuidance(entry: any, writeDate: string, base: string, erpNotice = '') {
    const cls = String(entry?.cls || '').trim();
    const student = String(entry?.student || '').trim();
    // 진단은 운영 백엔드에만 있는 읽기 경로다. 없으면 기존 안내를 그대로 쓴다.
    const diagnosis = typeof (ttt as any)?.diagnoseCounselWrite === 'function'
      ? await ttt.diagnoseCounselWrite({
        scode: entry?.scode, sname: student, className: cls,
        content: entry?.content, subject: entry?.subject, date: writeDate,
      }, writeDate, creds(boundTid(b.tid))).catch(() => null)
      : null;
    const parts = [base];
    if (erpNotice) parts.push(`통통통 응답: “${erpNotice}”`);
    if (diagnosis?.rosterHasStudent === false) {
      parts.push(`통통통 「${cls}」 반 명단에 ${student || '이 학생'}이(가) 없습니다. 반 편성을 먼저 확인해 주세요.`);
    } else if (diagnosis?.teacherScopeMatch === true) {
      parts.push('강사별 상담 목록에는 같은 상담이 보입니다. 통통통에서 확인한 뒤 「통통통에 있음」으로 처리해 주세요.');
    }
    parts.push('통통통을 직접 확인한 뒤에는 「통통통에 없음」 또는 「통통통에 있음」으로 처리할 수 있습니다.');
    console.warn(JSON.stringify({
      level: 'warning', message: 'counsel_delivery_unconfirmed',
      entryId: String(entry?.id || ''), scode: String(entry?.scode || ''), cls,
      classCode: diagnosis?.classCode || undefined, writeDate,
      beforeCount: Number.isInteger(entry?.deliveryBeforeCount) ? entry.deliveryBeforeCount : null,
      rosterHasStudent: diagnosis?.rosterHasStudent ?? null,
      teacherScopeMatch: diagnosis?.teacherScopeMatch ?? null,
      erpNotice: erpNotice || undefined,
      requestId: vercelRequestId || undefined,
    }));
    return parts.join(' ');
  }

  /** ERP POST 전 선점만 남은 시도는 외부 전송이 없었음이 확실하므로 안전하게 재시도할 수 있다. */
  function retryableCounselPayload(entry: any, message?: string) {
    counselResponseStatus = 200;
    return {
      entry,
      delivery: {
        erp: 'not-sent',
        state: 'retryable',
        persistence: 'synced',
        doNotRetransmit: false,
        message: message || '통통통에는 전송되지 않았습니다. 작성 내용을 확인한 뒤 다시 전송해 주세요.',
      },
    };
  }

  function counselEntriesForAttempt(attempt: any) {
    if (!attempt) return [];
    // 부재 전송 상태는 remote primary에서 직접 확정된다. 응답 payload도 같은 원본에서 읽어야
    // 뒤이어 실행되는 replica pull 성공 여부와 무관하게 방금 만든 이력/카운트를 돌려줄 수 있다.
    return store.getCounselSnapshotOnPrimary(attempt.taskId, attempt.teacher, attempt.cls).entries;
  }

  function pendingCounselAbsencePayload(attempt: any, message?: string) {
    pendingCounselWrite = true;
    counselResponseStatus = 202;
    return {
      attempt,
      entries: counselEntriesForAttempt(attempt),
      delivery: {
        erp: 'unconfirmed', state: 'pending', persistence: 'synced', doNotRetransmit: true,
        message: message || attempt?.deliveryMessage || '통통통 부재/문자 전송 결과를 확인 중입니다. 같은 기록을 다시 전송하지 마세요.',
      },
    };
  }

  function retryableCounselAbsencePayload(attempt: any, fallbackEntry: any, message?: string) {
    counselResponseStatus = 200;
    return {
      attempt: attempt || null,
      entries: fallbackEntry
        ? store.getCounselEntries(fallbackEntry.taskId, fallbackEntry.teacher, fallbackEntry.cls)
        : [],
      delivery: {
        erp: 'not-sent', state: 'retryable', persistence: 'synced', doNotRetransmit: false,
        message: message || '통통통에는 부재/문자 기록이 전송되지 않았습니다. 내용을 확인한 뒤 다시 시도해 주세요.',
      },
    };
  }

  /** pending 부재/문자는 ERP POST를 반복하지 않고 기존 목록 증거만 조회한다. */
  async function reconcilePendingCounselAbsence(attempt: any) {
    assertCounselAbsenceAccess(attempt);
    const fingerprint = String(attempt?.deliveryFingerprint || '');
    if (fingerprint && attempt?.deliveryStage === 'claimed') {
      const snapshot = { taskId: attempt.taskId, teacher: attempt.teacher, cls: attempt.cls };
      const recovered = store.recoverStaleCounselAbsenceClaim(attempt.id);
      if (recovered.action === 'reset') {
        return retryableCounselAbsencePayload(null, snapshot, '통통통 전송 전에 중단된 부재 상담 요청을 정리했습니다. 다시 시도해 주세요.');
      }
      attempt = recovered.attempt;
      if (attempt?.deliveryConfirmed) {
        counselResponseStatus = 200;
        return {
          attempt,
          entries: counselEntriesForAttempt(attempt),
          delivery: {
            erp: 'confirmed', state: 'confirmed', persistence: 'synced', doNotRetransmit: true,
            message: attempt.deliveryMessage || '통통통 부재/문자 전송과 앱 저장을 확인했습니다.',
          },
        };
      }
      if (attempt?.deliveryStage === 'claimed') {
        return pendingCounselAbsencePayload(
          attempt,
          '통통통 부재/문자 전송을 준비 중입니다. 다시 전송하지 말고 잠시 후 결과를 확인해 주세요.',
        );
      }
    }
    const beforeCount = attempt?.deliveryBeforeCount;
    const writeDate = String(attempt?.date || '');
    if (!fingerprint || !/^\d{4}-\d{2}-\d{2}$/.test(writeDate) || !Number.isInteger(beforeCount) || beforeCount < 0) {
      const message = '부재/문자 전송 시도는 보존됐지만 확인 기준을 준비 중입니다. 다시 전송하지 말고 잠시 후 확인해 주세요.';
      const pending = fingerprint
        ? store.markCounselAbsenceIndeterminate(attempt.id, fingerprint, { message })
        : attempt;
      return pendingCounselAbsencePayload(pending, message);
    }
    try {
      const result = await ttt.reconcileCounselWrite({
        scode: attempt.scode,
        sname: attempt.student,
        className: attempt.cls,
        content: attempt.content,
        subject: '부재/문자',
        kind: 'absence-text',
        date: writeDate,
      }, beforeCount, writeDate, creds(boundTid(b.tid)));
      if (result.confirmed) {
        let confirmedAttempt = attempt;
        let localMarked = false;
        try {
          confirmedAttempt = store.confirmCounselAbsenceDelivery(attempt.id, fingerprint, counselSyncedAt(), {
            beforeCount: result.beforeCount,
            message: '통통통 부재/문자 전송과 앱 저장을 확인했습니다.',
          });
          localMarked = true;
        } catch { /* ERP 반영은 읽기로 확인됐으므로 재전송 가능한 실패로 바꾸지 않는다. */ }
        confirmedCounselWrite = {
          localMarked,
          verification: 'read-after-write-count-increased',
          beforeCount: result.beforeCount,
          afterCount: result.afterCount,
        };
        counselResponseStatus = 200;
        return { attempt: confirmedAttempt, entries: counselEntriesForAttempt(confirmedAttempt) };
      }
      const message = '아직 통통통 목록에서 부재/문자 전송 결과를 확인하지 못했습니다. 다시 전송하지 말고 잠시 후 확인해 주세요.';
      const pending = store.markCounselAbsenceIndeterminate(attempt.id, fingerprint, { beforeCount, message });
      return pendingCounselAbsencePayload(pending, message);
    } catch {
      const message = '통통통 조회가 지연되어 부재/문자 전송 결과를 확인하지 못했습니다. 다시 전송하지 말고 잠시 후 확인해 주세요.';
      const pending = store.markCounselAbsenceIndeterminate(attempt.id, fingerprint, { beforeCount, message });
      return pendingCounselAbsencePayload(pending, message);
    }
  }

  /** pending 상담은 ERP 저장 POST 없이 목록 조회만으로 확정한다. */
  async function reconcilePendingCounsel(entry: any) {
    const fingerprint = String(entry?.deliveryFingerprint || '');
    if (fingerprint && entry?.deliveryStage === 'claimed') {
      const recovered = store.recoverStaleCounselDeliveryClaim(entry.id, fingerprint);
      if (recovered.action === 'reset') {
        const message = '통통통 전송 전에 중단된 요청을 정리했습니다. 작성 내용을 확인한 뒤 다시 전송해 주세요.';
        return retryableCounselPayload(recovered.entry, message);
      }
      // 선점 직후에는 원래 요청이 아직 ERP 사전 조회 중일 수 있다. 3분 lease가
      // 끝나기 전에는 다른 요청이 이를 초기화하거나 같은 상담을 전송하지 않는다.
      entry = recovered.entry;
      if (entry?.deliveryState === 'confirmed' || entry?.synced) {
        counselResponseStatus = 200;
        return {
          entry,
          delivery: {
            erp: 'confirmed', state: 'confirmed', persistence: 'synced', doNotRetransmit: true,
            message: entry.deliveryMessage || '통통통 전송과 앱 상태 저장을 확인했습니다.',
          },
        };
      }
      if (entry?.deliveryStage === 'claimed') {
        return pendingCounselPayload(
          entry,
          '통통통 전송을 준비 중입니다. 같은 상담을 다시 전송하지 말고 잠시 후 「전송 결과 확인」을 눌러 주세요.',
        );
      }
    }
    const writeDate = String(entry?.deliveryDate || '');
    const beforeCount = entry?.deliveryBeforeCount;
    if (!fingerprint || !/^\d{4}-\d{2}-\d{2}$/.test(writeDate) || !Number.isInteger(beforeCount) || beforeCount < 0) {
      const message = '통통통 전송 시도는 보존됐지만 확인 기준을 준비 중입니다. 같은 상담을 다시 전송하지 말고 잠시 후 다시 확인해 주세요.';
      const pending = fingerprint
        ? store.markCounselDeliveryIndeterminate(entry.id, fingerprint, { message })
        : entry;
      return pendingCounselPayload(pending, message);
    }
    try {
      const result = await ttt.reconcileCounselWrite({
        scode: entry.scode,
        sname: entry.student,
        className: entry.cls,
        content: entry.content,
        subject: entry.subject,
        date: writeDate,
      }, beforeCount, writeDate, creds(boundTid(b.tid)));
      if (result.confirmed) {
        let confirmedEntry = entry;
        let localMarked = false;
        try {
          confirmedEntry = store.confirmCounselDelivery(entry.id, fingerprint, counselSyncedAt(), {
            beforeCount: result.beforeCount,
            message: '통통통 전송과 앱 상태 저장을 확인했습니다.',
          });
          localMarked = true;
        } catch {
          // ERP 반영은 읽기로 확인됐다. 로컬 확정 실패를 재전송 가능한 실패로 바꾸지 않는다.
        }
        confirmedCounselWrite = {
          localMarked,
          verification: 'read-after-write-count-increased',
          beforeCount: result.beforeCount,
          afterCount: result.afterCount,
        };
        counselResponseStatus = 200;
        return { entry: confirmedEntry };
      }
      const message = await unconfirmedCounselGuidance(
        entry,
        writeDate,
        '아직 통통통 목록에서 전송 결과를 확인하지 못했습니다. 같은 상담을 다시 전송하지 마세요.',
      );
      const pending = store.markCounselDeliveryIndeterminate(entry.id, fingerprint, { beforeCount, message });
      return pendingCounselPayload(pending, message);
    } catch {
      const message = '통통통 조회가 지연되어 전송 결과를 확인하지 못했습니다. 같은 상담을 다시 전송하지 말고 잠시 후 다시 확인해 주세요.';
      const pending = store.markCounselDeliveryIndeterminate(entry.id, fingerprint, { beforeCount, message });
      return pendingCounselPayload(pending, message);
    }
  }

  function classManagementTeacherTid(requested?: string) {
    const requestedTid = String(requested || '').trim();
    if (requestRole === 'lead') {
      if (!requestedTid) throw new HttpError(400, '관리할 강사를 선택해 주세요.');
      if (!store.resolveTeacherName(requestedTid)) throw new HttpError(404, '강사를 찾을 수 없습니다.');
      return requestedTid;
    }
    if (requestRole === 'other') requireOtherTeam();
    else if (requestRole === 'teacher') {
      if (!store.isRegularTeacher(requestTid)) throw new HttpError(403, '강사 계정을 확인할 수 없습니다.');
    } else {
      throw new HttpError(403, '강사 또는 팀장만 반을 관리할 수 있습니다.');
    }
    return boundTid(requestedTid);
  }

  function normalizeOwnedClassSnapshot(candidate: TttRegularTeacherClassSnapshot) {
    const mapStudents = (students: any) => (Array.isArray(students) ? students : []).map((student: any) => ({
      scode: String(student.scode || student.studentCode || '').trim(),
      student: String(student.student || student.studentName || '').trim(),
      grade: String(student.grade || '').trim(),
      status: String(student.status || '').trim(),
    }));
    const supported = (candidate.classes || []).map((cls: any) => ({
      classCode: String(cls.classCode || '').trim(),
      className: String(cls.className || '').trim(),
      topName: String(cls.topName || '').trim(),
      middleName: String(cls.middleName || '').trim(),
      dayGroup: String(cls.dayGroup || '').trim(),
      scheduleCode: String(cls.scheduleCode || '').trim(),
      students: mapStudents(cls.students),
    }));
    const unsupported = (candidate.unsupportedSchedules || []).map((cls: any) => ({
      classCode: String(cls.classCode || '').trim(),
      className: String(cls.className || '').trim(),
      topName: String(cls.topName || '').trim(),
      middleName: String(cls.middleName || '').trim(),
      dayGroup: 'OTHER',
      scheduleCode: (Array.isArray(cls.scheduleCodes) ? cls.scheduleCodes : []).map(String).join(', '),
      students: mapStudents(cls.students),
    }));
    return { supported, unsupported, classes: [...supported, ...unsupported] };
  }

  function classMembershipSignature(classes: any[]) {
    return JSON.stringify(classes.map((cls) => ({
      classCode: cls.classCode,
      className: cls.className,
      topName: cls.topName,
      middleName: cls.middleName,
      dayGroup: cls.dayGroup,
      scheduleCode: cls.scheduleCode,
      students: cls.students.map((student: any) => ({
        scode: student.scode, student: student.student, grade: student.grade, status: student.status,
      })).sort((left: any, right: any) => left.scode.localeCompare(right.scode)),
    })).sort((left, right) => left.classCode.localeCompare(right.classCode)));
  }

  function classCatalogFingerprint(sourceMonth: string, classes: any[]) {
    return createHash('sha256')
      .update(JSON.stringify({ sourceMonth, membership: classMembershipSignature(classes) }))
      .digest('hex');
  }

  async function readOwnedClassSnapshot(
    teacherTid: string,
    targetDate: string,
    proofScope: ReturnType<typeof createOwnedClassProofScope>,
    lane: 'initial' | 'confirmation',
    options: { selectedClassCodes?: string[]; cacheCatalog?: boolean; forceRefresh?: boolean } = {},
  ) {
    const startedAt = Date.now();
    const teacherName = store.resolveTeacherName(teacherTid);
    const credentials = creds(teacherTid);
    if (!teacherName || !credentials) throw new HttpError(400, '강사 통통통 계정을 먼저 연결해 주세요.');
    try {
      const candidate = await ttt.getCurrentMonthOwnedClassSnapshotForTeacher(
        targetDate,
        teacherName,
        credentials,
        { scope: proofScope, lane },
        // 직접 선택 화면은 반명·분류 예외 없이 전부 보여 준다.
        { includeUnsupportedStudents: true, includeSpecialClasses: true, ...options },
      );
      const targetMonth = targetDate.slice(0, 7);
      if (candidate.sourceMonth !== targetMonth || candidate.targetMonth !== targetMonth) {
        throw new HttpError(502, '통통통이 요청한 수강년월과 다른 반 명단을 반환했습니다.');
      }
      console.info(JSON.stringify({
        level: 'info', message: 'teacher_class_erp_read', lane,
        mode: options.selectedClassCodes ? 'selected-only' : 'catalog',
        selectedCount: options.selectedClassCodes?.length,
        durationMs: Date.now() - startedAt, requestId: vercelRequestId || undefined,
      }));
      return candidate;
    } catch (error: any) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, error?.message || '통통통에서 담당 반 목록을 불러오지 못했습니다.');
    }
  }

  async function route(): Promise<any> {
    const [a, b1, b2, b3] = p;
    const ok = { ok: true };

    // ── keep-warm 헬스체크: 외부 핑(예: UptimeRobot 5분)이 이 경로를 때려 컨테이너를 웜 유지 → 콜드스타트 회피.
    // DB 동기화 없이 즉시 응답(핑 비용 최소).
    if (a === 'health') return { ok: true, warm: true };

    // ── 인증/상태 ──
    if (a === 'login' && m === 'POST') {
      const throttleKey = loginThrottle.key(req, b.id);
      loginThrottle.assertAllowed(throttleKey);
      let account: ReturnType<typeof store.login>;
      try { account = store.login(b.id, b.pw); } catch (error) { loginThrottle.recordFailure(throttleKey); throw error; }
      loginThrottle.reset(throttleKey);
      res.setHeader('Set-Cookie', issueSessionCookie(account.accountKind, account.tid));
      const { accountKind: _kind, ...session } = account;
      return session;
    }
    if (a === 'logout' && m === 'POST') {
      res.setHeader('Set-Cookie', clearSessionCookie());
      return ok;
    }
    if (a === 'state' && m === 'GET') return store.getState(requestRole!, requestTid);

    // ── 전체 강사 공통 반 관리: 전체 후보 조회와 선택 적용을 명시적으로 분리 ──
    if (a === 'class-management') {
      const requestedTeacherTid = m === 'GET' ? s(q.teacherTid) : b.teacherTid;
      const teacherTid = classManagementTeacherTid(requestedTeacherTid);
      if (!b1 && m === 'GET') return store.getTeacherRoster(teacherTid);
      if (b1 === 'student-details' && m === 'GET') {
        const current = store.getTeacherRoster(teacherTid);
        if (!s(q.selectionRevision) || s(q.selectionRevision) !== current.selectionRevision) {
          throw new HttpError(409, '반 선택이 변경되었습니다. 반 현황을 다시 불러와 주세요.');
        }
        const cls = current.classes.find((item: any) => item.classCode === s(q.classCode));
        if (!cls) throw new HttpError(403, '현재 선택한 본인 반의 학생만 조회할 수 있습니다.');
        const startedAt = Date.now();
        const details = await ttt.getClassStudentDetails(
          cls.students.map((student: any) => String(student.scode)), appToday(), creds(teacherTid), s(q.forceRefresh) === '1',
        );
        console.info(JSON.stringify({ level: 'info', message: 'teacher_class_student_details',
          durationMs: Date.now() - startedAt, studentCount: cls.students.length,
          warningCount: details.warnings.length, requestId: vercelRequestId || undefined,
        }));
        res.setHeader?.('Cache-Control', 'private, no-store');
        return { ...details, today: appToday(), historyFrom: '2020-01-01', checkedAt: new Date().toISOString() };
      }
      if ((b1 === 'catalog' || b1 === 'apply') && m === 'POST') {
        const targetDate = String(b.targetDate || '').trim();
        if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(targetDate)) {
          throw new HttpError(400, '수강 기준일을 확인해 주세요.');
        }
        if (targetDate.slice(0, 7) !== appToday().slice(0, 7)) {
          throw new HttpError(400, '반 현황은 현재 수강년월만 관리할 수 있습니다. 기준일을 오늘이 속한 달로 선택해 주세요.');
        }
        const proofScope = createOwnedClassProofScope();
        const credentials = creds(teacherTid);
        if (!credentials) throw new HttpError(400, '강사 통통통 계정을 먼저 연결해 주세요.');
        // 공개되는 서명 payload에 자격증명의 단순 해시(비밀번호 추측용 검증값)를 노출하지 않는다.
        const credentialBinding = createHmac('sha256', catalogProofSecret())
          .update('teacher-class-credentials\u0000').update(JSON.stringify(credentials)).digest('hex');

        if (b1 === 'catalog') {
          const snapshot = await readOwnedClassSnapshot(teacherTid, targetDate, proofScope, 'initial', {
            cacheCatalog: true, forceRefresh: b.forceRefresh === true,
          });
          const normalized = normalizeOwnedClassSnapshot(snapshot);
          if (!normalized.classes.length) {
            throw new HttpError(502, '통통통에서 현재 담당 반을 한 개도 확인하지 못했습니다. 저장된 선택은 변경하지 않았습니다.');
          }
          const fingerprint = classCatalogFingerprint(snapshot.sourceMonth, normalized.classes);
          const current = store.getTeacherRoster(teacherTid);
          const catalogCodes = new Set(normalized.classes.map((cls) => cls.classCode));
          const uniqueCodeByName = new Map<string, string | null>();
          for (const cls of normalized.classes) {
            uniqueCodeByName.set(cls.className, uniqueCodeByName.has(cls.className) ? null : cls.classCode);
          }
          const selectedCodes = new Set<string>();
          if (current.sourceMonth === snapshot.sourceMonth) {
            for (const cls of current.classes || []) {
              const classCode = String(cls.classCode || '');
              if (catalogCodes.has(classCode)) selectedCodes.add(classCode);
            }
          } else {
            const previousNames = current.sourceMonth
              ? (current.classes || []).map((cls: any) => String(cls.className || ''))
              : store.getTeacherLegacyClassNames(teacherTid);
            for (const className of previousNames) {
              const classCode = uniqueCodeByName.get(className);
              if (classCode) selectedCodes.add(classCode);
            }
          }
          return {
            teacherTid,
            targetDate,
            sourceMonth: snapshot.sourceMonth,
            catalogFingerprint: fingerprint,
            catalogProof: signClassCatalogProof({
              teacherTid, sourceMonth: snapshot.sourceMonth, credentialBinding,
              expiresAt: Date.now() + 5 * 60_000, fingerprint,
              classes: Object.fromEntries(normalized.classes.map((cls) => [
                cls.classCode, classCatalogFingerprint(snapshot.sourceMonth, [cls]),
              ])),
            }),
            selectionRevision: current.selectionRevision,
            selectedClassCodes: [...selectedCodes],
            classes: normalized.classes.map((cls) => ({
              classCode: cls.classCode,
              className: cls.className,
              topName: cls.topName,
              middleName: cls.middleName,
              dayGroup: cls.dayGroup,
              scheduleCode: cls.scheduleCode,
              studentCount: cls.students.length,
            })),
          };
        }

        const proof = verifyClassCatalogProof(b.catalogProof, teacherTid, targetDate.slice(0, 7), credentialBinding);
        const submittedFingerprint = String(b.catalogFingerprint || '').trim();
        if (!/^[a-f0-9]{64}$/.test(submittedFingerprint) || submittedFingerprint !== proof.fingerprint) {
          throw new HttpError(409, '통통통 반 또는 학생 명단이 달라졌습니다. 반 목록을 다시 불러와 선택해 주세요.');
        }
        const selectionRevision = String(b.selectionRevision || '').trim();
        if (!/^[a-f0-9]{64}$/.test(selectionRevision)) {
          throw new HttpError(400, '반 선택 버전이 없습니다. 목록을 다시 불러와 주세요.');
        }
        const selectedClassCodes: string[] = Array.isArray(b.selectedClassCodes)
          ? Array.from(new Set<string>(
            b.selectedClassCodes
              .map((value: unknown) => String(value || '').trim())
              .filter((value: string) => Boolean(value)),
          ))
          : [];
        if (!selectedClassCodes.length) throw new HttpError(400, '적용할 반을 한 개 이상 선택해 주세요.');
        if (selectedClassCodes.length > 500) throw new HttpError(400, '선택한 반이 허용 범위를 초과했습니다.');
        if (selectedClassCodes.some((code) => !Object.prototype.hasOwnProperty.call(proof.classes, code))) {
          throw new HttpError(409, '확인한 통통통 목록에 없는 반입니다. 반 목록을 다시 불러와 주세요.');
        }
        let snapshot = await readOwnedClassSnapshot(teacherTid, targetDate, proofScope, 'initial', { selectedClassCodes });
        let normalized = normalizeOwnedClassSnapshot(snapshot);
        // 선택하지 않은 반의 변경은 저장을 막지 않는다. 선택한 반은 최신 소유권과 학생 명단을 정확히 재검증한다.
        normalized.classes = normalized.classes.filter((cls) => selectedClassCodes.includes(cls.classCode));
        if (selectedClassCodes.some((code) => {
          const cls = normalized.classes.find((item) => item.classCode === code);
          return !cls || classCatalogFingerprint(snapshot.sourceMonth, [cls]) !== proof.classes[code];
        })) throw new HttpError(409, '선택한 반 또는 학생 명단이 달라졌습니다. 반 목록을 다시 불러와 선택해 주세요.');
        const byCode = new Map(normalized.classes.map((cls) => [cls.classCode, cls]));
        if (selectedClassCodes.some((code) => !byCode.has(code))) {
          throw new HttpError(409, '현재 통통통 목록에 없는 반이 선택되었습니다. 목록을 다시 불러와 주세요.');
        }

        const existing = store.getTeacherRoster(teacherTid);
        const selected = selectedClassCodes.map((code) => byCode.get(code)!);
        const incomingMembership = new Set(selected.flatMap((cls: any) =>
          cls.students.map((student: any) => `${cls.classCode}\u0000${student.scode}`)));
        const removesExistingStudent = (existing.classes || []).filter((cls: any) => selectedClassCodes.includes(cls.classCode)).some((cls: any) =>
          (cls.students || []).some((student: any) => !incomingMembership.has(`${cls.classCode}\u0000${student.scode}`)));
        if (removesExistingStudent) {
          const confirmation = await readOwnedClassSnapshot(teacherTid, targetDate, proofScope, 'confirmation', { selectedClassCodes });
          const confirmed = normalizeOwnedClassSnapshot(confirmation);
          confirmed.classes = confirmed.classes.filter((cls) => selectedClassCodes.includes(cls.classCode));
          if (classMembershipSignature(normalized.classes) !== classMembershipSignature(confirmed.classes)) {
            throw new HttpError(502, '제외가 포함된 명단이 두 번의 확인에서 달라 기존 선택을 변경하지 않았습니다.');
          }
          snapshot = confirmation;
          normalized = confirmed;
        }
        const finalByCode = new Map(normalized.classes.map((cls) => [cls.classCode, cls]));
        const finalSelection = selectedClassCodes.map((code) => finalByCode.get(code)!);
        const unsupportedCount = finalSelection.filter((cls: any) => cls.dayGroup === 'OTHER').length;
        const saveStartedAt = Date.now();
        const roster = store.applyTeacherRosterSnapshotOnPrimary({
          teacherTid,
          sourceMonth: snapshot.sourceMonth,
          syncedAt: new Date().toISOString(),
          classes: finalSelection,
          expectedRevision: selectionRevision,
          warnings: unsupportedCount
            ? [`요일표가 월수금·화목토가 아닌 ${unsupportedCount}개 반은 일일보고에서는 제외되고 반 현황·상담·알림장에 사용됩니다.`]
            : [],
        });
        console.info(JSON.stringify({
          level: 'info', message: 'teacher_class_selection_applied', teacherTid,
          sourceMonth: snapshot.sourceMonth, classCount: roster.classCount,
          studentCount: roster.studentCount, saveDurationMs: Date.now() - saveStartedAt,
          requestId: vercelRequestId || undefined,
        }));
        otherTeamPrimaryWrite = true;
        return { ...roster, targetDate };
      }
    }

    // ── 다른 팀 편의 기능: 본인 반/학생, 스스로 만드는 상담일정 ──
    if (a === 'other-team') {
      requireOtherTeam();
      if (b1 === 'classes' && !b2 && m === 'GET') return store.getOtherTeamRoster(requestTid);
      if (b1 === 'classes' && b2 === 'sync' && m === 'POST') {
        const targetDate = String(b.targetDate || '').trim();
        if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(targetDate)) {
          throw new HttpError(400, '본인 반 동기화 기준일을 확인해 주세요.');
        }
        const expectedClassCount = b.expectedClassCount === undefined
          ? null
          : Number(b.expectedClassCount);
        if (
          expectedClassCount !== null
          && (!Number.isSafeInteger(expectedClassCount) || expectedClassCount < 1 || expectedClassCount > 500)
        ) {
          throw new HttpError(400, '예상 본인 반 수를 확인해 주세요.');
        }
        const teacher = store.resolveTeacherName(requestTid);
        const credentials = creds(requestTid);
        if (!teacher || !credentials) throw new HttpError(400, '강사 통통통 계정을 먼저 연결해 주세요.');
        const targetMonth = targetDate.slice(0, 7);
        const includeSpecialClasses = store.getSpecialPeriodSettings().enabled;
        const proofScope = createOwnedClassProofScope();
        const readSnapshot = async (lane: 'initial' | 'confirmation') => {
          try {
            const candidate = await ttt.getCurrentMonthOwnedClassSnapshotForTeacher(
              targetDate,
              teacher,
              credentials,
              { scope: proofScope, lane },
              { includeUnsupportedStudents: true, includeSpecialClasses },
            );
            if (candidate.sourceMonth !== targetMonth || candidate.targetMonth !== targetMonth) {
              throw new HttpError(502, '통통통이 요청한 수강년월과 다른 본인 반 명단을 반환했습니다.');
            }
            return candidate;
          } catch (error: any) {
            if (error instanceof HttpError) throw error;
            throw new HttpError(
              502,
              error?.message || (lane === 'confirmation'
                ? '기존 학생 제외 명단을 다시 확인하지 못해 본인 반을 변경하지 않았습니다.'
                : '통통통에서 본인 반 학생 명단을 불러오지 못했습니다.'),
            );
          }
        };
        const normalizeSnapshot = (candidate: TttRegularTeacherClassSnapshot) => {
          const mapStudents = (students: any) => (Array.isArray(students) ? students : []).map((student: any) => ({
            scode: String(student.scode || student.studentCode || '').trim(),
            student: String(student.student || student.studentName || '').trim(),
            grade: String(student.grade || '').trim(),
            status: String(student.status || '').trim(),
          }));
          const supported = (candidate.classes || []).map((cls: any) => ({
            classCode: String(cls.classCode || '').trim(),
            className: String(cls.className || '').trim(),
            topName: String(cls.topName || '').trim(),
            middleName: String(cls.middleName || '').trim(),
            dayGroup: String(cls.dayGroup || '').trim(),
            scheduleCode: String(cls.scheduleCode || '').trim(),
            students: mapStudents(cls.students),
          }));
          const unsupported = (candidate.unsupportedSchedules || []).map((cls: any) => ({
            classCode: String(cls.classCode || '').trim(),
            className: String(cls.className || '').trim(),
            topName: String(cls.topName || '').trim(),
            middleName: String(cls.middleName || '').trim(),
            dayGroup: 'OTHER',
            scheduleCode: (Array.isArray(cls.scheduleCodes) ? cls.scheduleCodes : []).map(String).join(', '),
            students: mapStudents(cls.students),
          }));
          return { supported, unsupported, classes: [...supported, ...unsupported] };
        };
        const membershipSignature = (classes: any[]) => JSON.stringify(classes.map((cls) => ({
          classCode: cls.classCode,
          className: cls.className,
          dayGroup: cls.dayGroup,
          scheduleCode: cls.scheduleCode,
          students: cls.students.map((student: any) => ({ scode: student.scode, student: student.student }))
            .sort((left: any, right: any) => left.scode.localeCompare(right.scode)),
        })).sort((left, right) => left.classCode.localeCompare(right.classCode)));

        const existing = store.getOtherTeamRoster(requestTid);
        let snapshot = await readSnapshot('initial');
        let normalized = normalizeSnapshot(snapshot);
        if (normalized.classes.length === 0) {
          console.warn(JSON.stringify({
            level: 'warning',
            message: 'other_team_class_sync_empty',
            teacherTid: requestTid,
            targetMonth,
            includeSpecialClasses,
            requestId: vercelRequestId || undefined,
          }));
          throw new HttpError(
            502,
            '통통통에서 본인 담당 반을 한 개도 확인하지 못해 기존 명단을 변경하지 않았습니다.',
          );
        }
        if (expectedClassCount !== null && normalized.classes.length !== expectedClassCount) {
          console.warn(JSON.stringify({
            level: 'warning',
            message: 'other_team_class_sync_count_mismatch',
            teacherTid: requestTid,
            targetMonth,
            expectedClassCount,
            actualClassCount: normalized.classes.length,
            includeSpecialClasses,
            classes: normalized.classes.map((cls) => ({
              classCode: cls.classCode,
              className: cls.className,
              topName: cls.topName,
              middleName: cls.middleName,
              dayGroup: cls.dayGroup,
              studentCount: cls.students.length,
            })),
            requestId: vercelRequestId || undefined,
          }));
          throw new HttpError(
            409,
            `확인된 본인 반이 ${normalized.classes.length}개로 예상한 ${expectedClassCount}개와 달라 명단을 변경하지 않았습니다.`,
          );
        }
        const incomingMembership = new Set(normalized.classes.flatMap((cls) =>
          cls.students.map((student: any) => `${cls.classCode}\u0000${student.scode}`)));
        const removesExistingStudent = (existing.classes || []).some((cls: any) =>
          (cls.students || []).some((student: any) => !incomingMembership.has(`${cls.classCode}\u0000${student.scode}`)));
        if (removesExistingStudent) {
          const confirmation = await readSnapshot('confirmation');
          const confirmed = normalizeSnapshot(confirmation);
          if (membershipSignature(normalized.classes) !== membershipSignature(confirmed.classes)) {
            throw new HttpError(502, '기존 학생을 제외하는 본인 반 명단이 두 번의 확인에서 일치하지 않아 변경하지 않았습니다.');
          }
          snapshot = confirmation;
          normalized = confirmed;
        }
        // ERP 조회 중 특강기간 토글이 바뀌었다면 이전 범위의 스냅샷을 저장하지 않는다.
        db.syncStrict();
        if (store.getSpecialPeriodSettings().enabled !== includeSpecialClasses) {
          throw new HttpError(409, '특강기간 설정이 변경되어 본인 반 동기화를 취소했습니다. 다시 실행해 주세요.');
        }
        const { supported, unsupported } = normalized;
        const warnings = [
          ...(unsupported.length ? [`지원 요일표 밖의 ${unsupported.length}개 반도 본인 반 목록에 포함했습니다.`] : []),
          ...((snapshot.excludedExtensions || []).length
            ? [`연장 ${snapshot.excludedExtensions.length}개 반은 본인 반 목록에서 제외했습니다.`]
            : []),
        ];
        const roster = store.applyOtherTeamRosterSnapshotOnPrimary({
          teacherTid: requestTid,
          sourceMonth: snapshot.sourceMonth,
          syncedAt: new Date().toISOString(),
          classes: normalized.classes,
          warnings,
        });
        console.log(JSON.stringify({
          level: 'info',
          message: 'other_team_class_sync_applied',
          teacherTid: requestTid,
          targetMonth,
          classCount: roster.classCount,
          studentCount: roster.studentCount,
          includeSpecialClasses,
          requestId: vercelRequestId || undefined,
        }));
        otherTeamPrimaryWrite = true;
        return { ...roster, targetDate };
      }
      if (b1 === 'counsel' && !b2 && m === 'POST') {
        const result = store.createOtherTeamCounselTaskOnPrimary(b, requestTid);
        otherTeamPrimaryWrite = true;
        return result;
      }
      if (b1 === 'counsel' && b2 && !b3 && m === 'DELETE') {
        store.deleteOtherTeamCounselTaskOnPrimary(b2, requestTid);
        otherTeamPrimaryWrite = true;
        return ok;
      }
    }

    // ── 업무 ──
    if (a === 'tasks') {
      if (requestRole === 'other') throw new HttpError(403, '다른 팀 계정은 상담일정 화면에서만 업무를 만들거나 변경할 수 있습니다.');
      if (!b1 && m === 'POST') {
        requireLead();
        if (String(b.tag || '').trim() === '특강 상담') {
          return store.createSpecialCounselTaskOnPrimary(b, `${requestRole}:${requestTid}`);
        }
        return { id: store.createTask(b, `${requestRole}:${requestTid}`) };
      }
      if (b1 && b2 === 'edit' && m === 'POST') { requireLead(); store.updateTask(b1, b); return ok; }
      // 처리 상태와 보고는 강사 본인 것만 바꿀 수 있다. 팀장 화면은 강사를 지정할 수 있다.
      if (b1 && b2 === 'status' && m === 'POST') { store.setTaskStatus(b1, boundTeacher(b.teacher), b.status, b.at); return ok; }
      if (b1 && b2 === 'mt' && m === 'POST') { store.setTaskMt(b1, boundTeacher(b.teacher), b.part, !!b.value, b.at); return ok; }
      if (b1 && b2 === 'report' && m === 'POST') { store.saveTaskReport(b1, boundTeacher(b.teacher), b.text || '', b.files || []); return ok; }
      if (b1 && !b2 && m === 'DELETE') { requireLead(); store.deleteTask(b1); return ok; }
    }

    // ── 일정 ──
    if (a === 'events') {
      if (!b1 && m === 'POST') return { id: store.createEvent(b, requestTid, requestRole!) };
      if (b1 && b2 === 'edit' && m === 'POST') { store.updateEvent(b1, b, requestTid, requestRole!); return ok; }
      if (b1 && b2 === 'todo' && m === 'POST') {
        store.updateEventTodo(b1, b.descr, requestTid, requestRole!);
        return { ok: true, event: { id: b1, descr: String(b.descr || '') } };
      }
      if (b1 && !b2 && m === 'DELETE') { store.deleteEvent(b1, requestTid, requestRole!); return ok; }
    }

    // ── 태그 ──
    if (a === 'tags') {
      if (requestRole === 'other') throw new HttpError(403, '다른 팀 계정은 태그를 변경할 수 없습니다.');
      requireLead();
      if (!b1 && m === 'POST') { store.createTag(b.name, b.color, b.emoji); return ok; }
      if (b1 && m === 'POST') { store.updateTag(dec(b1), b); return ok; }
      if (b1 && m === 'DELETE') { store.deleteTag(dec(b1)); return ok; }
    }

    // ── 공지 ──
    if (a === 'notices') {
      if (requestRole === 'other') throw new HttpError(403, '다른 팀 계정은 공지사항을 변경할 수 없습니다.');
      requireLead();
      if (!b1 && m === 'POST') return { id: store.createNotice(b.text) };
      if (b1 === 'reorder' && m === 'POST') { store.reorderNotices(b.ids || []); return ok; }
      if (b1 && m === 'POST') { store.updateNotice(b1, b); return ok; }
      if (b1 && m === 'DELETE') { store.deleteNotice(b1); return ok; }
    }

    // ── 강사 ──
    if (a === 'teachers') {
      requireLead();
      if (!b1 && m === 'POST') { store.createTeacher(b.name, b.tid, b.pw, b.tttId || '', b.tttPw || ''); return ok; }
      if (b1 && b2 === 'classes' && m === 'POST') {
        if (b.group === '월수금반' || b.group === '화목토반') {
          throw new HttpError(400, '정규 반은 직접 추가·삭제할 수 없습니다. 정규 반 동기화를 사용해 주세요.');
        }
        store.updateTeacherClasses(b1, b.group, b.classes);
        return ok;
      }
      if (b1 && b2 === 'ttt' && m === 'POST') { store.setTeacherTtt(b1, b.tttId || '', b.tttPw || ''); return ok; }
      if (b1 && b2 === 'lead' && m === 'POST') { store.setTeacherLead(b1, !!b.isLead); return ok; }
      if (b1 && b2 === 'other-team' && m === 'POST') { store.setTeacherOtherTeam(b1, !!b.isOtherTeam); return ok; }
      if (b1 && b2 === 'reset-pw' && m === 'POST') return { tmp: store.resetTeacherPw(b1) };
      if (b1 && b2 === 'password' && m === 'POST') { store.setTeacherPassword(b1, b.pw); return ok; }
      if (b1 && !b2 && m === 'DELETE') { store.deleteTeacher(b1); return ok; }
    }

    // ── 일일보고 정의 ──
    if (a === 'journals') {
      if (!b1 && m === 'POST') { requireLead(); store.createJournal(b.date); return ok; }
      if (b1 && !b2 && m === 'DELETE') { requireLead(); store.deleteJournal(b1); return ok; }
      if (b1 && b2 === 'items' && m === 'POST') { requireLead(); store.addJournalItem(b1, b.text, !!b.required); return ok; }
    }
    if (a === 'journal-items' && b1) {
      if (!b2 && m === 'DELETE') { requireLead(); store.removeJournalItem(b1); return ok; }
      if (b2 === 'toggle-req' && m === 'POST') { requireLead(); store.toggleJournalItemReq(b1); return ok; }
      if (b2 === 'edit' && m === 'POST') { requireLead(); store.updateJournalItemText(dec(b1), b.text); return ok; }
    }

    // ── 일일보고 제출물 ── /reports/:teacher/:date[/action]
    if (a === 'reports' && b1 && b2) {
      if (requestRole === 'other') throw new HttpError(403, '다른 팀 계정은 일일보고 대상이 아닙니다.');
      const date = b2;
      // 강사는 본인 보고만 읽고 쓴다. 확인 처리는 팀장만 한다.
      if (b3 === 'confirm' && m === 'POST') { requireLead(); store.confirmReport(dec(b1), date); return ok; }
      const teacher = boundTeacher(dec(b1));
      if (!b3 && m === 'GET') return store.getReport(teacher, date);
      if (b3 === 'draft' && m === 'POST') { store.saveDraft(teacher, date, b.payload); return ok; }
      if (b3 === 'submit' && m === 'POST') { store.submitReport(teacher, date, b.payload); return ok; }
      if (b3 === 'reopen' && m === 'POST') { store.reopenReport(teacher, date); return ok; }
    }


    // ── 설정 (주간테스트 날짜 등) ──
    if (a === 'settings' && m === 'POST') {
      if (requestRole === 'other') throw new HttpError(403, '다른 팀 계정은 운영 설정을 변경할 수 없습니다.');
      requireLead();
      store.setSetting(b.key, b.value); return ok;
    }

    // ── 특강기간 / 특강 반 동기화 ──
    if (a === 'special-period' && m === 'POST') {
      requireLead();
      return store.setSpecialPeriod(!!b.enabled, String(b.targetDate || ''));
    }
    if (a === 'special-classes' && b1 === 'sync' && m === 'POST') {
      requireLead();
      const setting = store.getSpecialPeriodSettings();
      if (!setting.enabled) throw new HttpError(400, '특강기간을 먼저 켜 주세요.');
      if (!setting.targetDate) throw new HttpError(400, '특강 동기화 기준일을 선택해 주세요.');
      try {
        const snapshot = await specialTtt.getNearestClassSnapshot(setting.targetDate);
        // ERP 조회가 길어지는 동안 다른 요청에서 토글/기준일이 바뀌었다면 오래된 결과를 적용하지 않는다.
        db.syncStrict();
        const latestSetting = store.getSpecialPeriodSettings();
        if (!latestSetting.enabled || latestSetting.targetDate !== setting.targetDate) {
          throw new HttpError(409, '특강기간 또는 기준일이 변경되어 동기화를 취소했습니다. 다시 실행해 주세요.');
        }
        const applied = store.applySpecialClassSnapshot({
          targetDate: setting.targetDate,
          sourceMonth: snapshot.sourceMonth,
          classes: snapshot.classes.map((cls) => ({
            classCode: cls.classCode,
            className: cls.className,
            teacherName: cls.teacherName,
            dayGroup: cls.dayGroup,
            scheduleLabel: cls.scheduleCode,
            students: cls.students.map((student) => ({ scode: student.scode, student: student.student })),
          })),
          unsupportedClasses: snapshot.unsupportedSchedules.map((cls) =>
            `${cls.className} (${cls.scheduleCode || '요일 미지정'})`,
          ),
        });
        return {
          ...applied,
          searchedMonths: snapshot.searchedMonths,
          listedClassCount: snapshot.listedClassCount,
          listedEnrollmentCount: snapshot.listedEnrollmentCount,
          uniqueStudentCount: snapshot.uniqueSupportedStudentCount,
        };
      } catch (e: any) {
        if (e instanceof HttpError) throw e;
        if (e instanceof TttSpecialError) {
          const status = e.code === 'CONFIG' ? 503 : e.code === 'NO_DATA' ? 404 : 502;
          throw new HttpError(status, e.message);
        }
        throw e;
      }
    }

    // ── 등록 강사 계정별 정규 반 동기화 (ERP 읽기 전용 → 완전한 결과만 원자 적용) ──
    // 일반 동기화는 사라진 기존 반을 불완전 조회로 간주해 보존한다. `quarter-start`만
    // 이전 수강월의 반이 현재 카탈로그에서 완전히 사라지는 분기 교체를 명시적으로 허용한다.
    if (a === 'regular-classes' && (b1 === 'sync' || b1 === 'quarter-start') && m === 'POST') {
      requireLead();
      const isQuarterStart = b1 === 'quarter-start';
      const targetDate = String(b.targetDate || '').trim();
      const dryRun = !!b.dryRun;
      const expectedPreviewFingerprint = String(b.previewFingerprint || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        throw new HttpError(400, '정규 반 동기화 기준일을 선택해 주세요.');
      }
      if (isQuarterStart && !dryRun) {
        if (b.confirmQuarterStart !== true) {
          throw new HttpError(400, '새 분기 시작 확인이 필요합니다. 먼저 변경 내용을 미리 확인해 주세요.');
        }
        if (!/^[a-f0-9]{64}$/.test(expectedPreviewFingerprint)) {
          throw new HttpError(400, '새 분기 미리보기 확인값이 없습니다. 미리보기를 다시 실행해 주세요.');
        }
      }
      try {
        const teachers = store.getRegularClassSyncTeachers();
        if (!teachers.length) throw new HttpError(400, '등록된 강사가 없습니다.');
        // ERP 조회 중 강사/계정/현재 담당 반이 바뀌면 원격 원본 트랜잭션에서 적용을 거부한다.
        // guard는 암호문·반정보를 되돌릴 수 없는 SHA-256 지문이라 자격증명 원문을 보유하지 않는다.
        const guard = store.getRegularClassSyncGuard();
        const targetMonth = targetDate.slice(0, 7);
        const previousSourceMonth = isQuarterStart
          ? String(store.getRegularClassSyncSettings()?.sourceMonth || '').trim()
          : '';
        if (isQuarterStart && !/^\d{4}-\d{2}$/.test(previousSourceMonth)) {
          throw new HttpError(400, '이전 정규 반 기준이 없습니다. 먼저 정규 반 동기화를 실행해 주세요.');
        }
        if (isQuarterStart && targetMonth <= previousSourceMonth) {
          throw new HttpError(
            400,
            targetMonth === previousSourceMonth
              ? '이미 현재 수강년월로 분기 기준이 설정되어 있습니다. 정규 반 동기화를 사용해 주세요.'
              : '새 분기 시작은 마지막 반영 월보다 이후 수강년월에서만 실행할 수 있습니다.',
          );
        }
        const regularProofScope = createRegularClassProofScope();
        const validateTeacherSnapshot = (
          snapshot: TttRegularTeacherClassSnapshot,
          currentAssignments: Array<{ className: string; dayGroup: 'M' | 'T' }>,
        ) => {
          if (snapshot.targetMonth !== targetMonth || snapshot.sourceMonth !== targetMonth) {
            throw new Error('요청한 현재 수강년월과 다른 명단을 반환했습니다.');
          }
          if (!Number.isFinite(Number(snapshot.listedClassCount)) || Number(snapshot.listedClassCount) < 0) {
            throw new Error('반별 원생목록의 반 수를 확인할 수 없습니다.');
          }
          const unsupported = snapshot.unsupportedSchedules || [];
          if (unsupported.length) {
            const labels = unsupported
              .slice(0, 3)
              .map((cls) => String(cls.className || '').trim())
              .filter(Boolean)
              .join(' · ');
            throw new Error(`지원하지 않는 요일표${labels ? `(${labels})` : ''}가 있습니다.`);
          }
          const currentKeys = new Set(currentAssignments.map((entry) =>
            `${entry.dayGroup}\u0000${String(entry.className || '').trim()}`));
          const nonPrimary = snapshot.nonPrimaryCurrentClasses || [];
          for (const entry of nonPrimary) {
            const key = `${entry.dayGroup}\u0000${String(entry.className || '').trim()}`;
            if (!currentKeys.has(key)
              || (entry.primaryStatus !== 'unassigned' && entry.primaryStatus !== 'other-teacher')) {
              throw new Error('기존 담당 반이 아닌 항목이 담임 제외 진단에 포함되어 있습니다.');
            }
          }
          const provenNames = new Set([
            ...(snapshot.classes || []).map((cls) => String(cls.className || '').trim()),
            ...(snapshot.unsupportedSchedules || []).map((cls) => String(cls.className || '').trim()),
            ...nonPrimary.map((entry) => String(entry.className || '').trim()),
          ].filter(Boolean));
          const unknownMissing = currentAssignments
            .map((entry) => String(entry.className || '').trim())
            .filter((className) => className && !provenNames.has(className));
          if (unknownMissing.length && !isQuarterStart) {
            throw new Error(`기존 담당 반 '${unknownMissing[0]}'을 반 상세에서 확인하지 못했습니다.`);
          }
        };
        const teacherSnapshotSignature = (snapshot: TttRegularTeacherClassSnapshot) => JSON.stringify({
          targetMonth: snapshot.targetMonth,
          sourceMonth: snapshot.sourceMonth,
          teacherFilter: {
            code: String(snapshot.teacherFilter?.teacherCode || '').trim(),
            name: String(snapshot.teacherFilter?.teacherName || '').trim(),
          },
          listedClassCount: Number(snapshot.listedClassCount),
          listedEnrollmentCount: Number(snapshot.listedEnrollmentCount),
          classes: (snapshot.classes || []).map((cls) => ({
            code: String(cls.classCode || '').trim(),
            name: String(cls.className || '').trim(),
            dayGroup: cls.dayGroup,
            schedule: cls.scheduleCode,
            students: (cls.students || [])
              .map((student) => String(student.studentCode || student.scode || '').trim())
              .sort(),
          })).sort((left, right) => left.code.localeCompare(right.code)),
          unsupported: (snapshot.unsupportedSchedules || [])
            .map((cls) => ({
              code: String(cls.classCode || '').trim(),
              schedules: (cls.scheduleCodes || []).map((value) => String(value || '').trim()).sort(),
              studentCount: Number(cls.studentCount || 0),
            }))
            .sort((left, right) => left.code.localeCompare(right.code)),
          extensions: (snapshot.excludedExtensions || [])
            .map((cls) => ({
              code: String(cls.classCode || '').trim(),
              studentCount: Number(cls.studentCount || 0),
            }))
            .sort((left, right) => left.code.localeCompare(right.code)),
          nonPrimaryCurrent: (snapshot.nonPrimaryCurrentClasses || [])
            .map((entry) => ({
              code: String(entry.classCode || '').trim(),
              name: String(entry.className || '').trim(),
              dayGroup: entry.dayGroup,
              status: entry.primaryStatus,
            }))
            .sort((left, right) => `${left.dayGroup}\u0000${left.name}`.localeCompare(`${right.dayGroup}\u0000${right.name}`)),
        });
        const teacherReads: Array<{
          tid: string;
          name: string;
          snapshot: TttRegularTeacherClassSnapshot | null;
          error: string;
          currentAssignments: Array<{ className: string; dayGroup: 'M' | 'T' }>;
          needsConfirmation: boolean;
        }> = new Array(teachers.length);
        let cursor = 0;
        const worker = async () => {
          while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= teachers.length) return;
            const teacher = teachers[index];
            let snapshot: TttRegularTeacherClassSnapshot | null = null;
            let error = teacher.credentialError;
            let needsConfirmation = false;
            const currentRegularAssignments = [
              ...(teacher.classes?.['월수금반'] || []).map((className) => ({ className: String(className || '').trim(), dayGroup: 'M' as const })),
              ...(teacher.classes?.['화목토반'] || []).map((className) => ({ className: String(className || '').trim(), dayGroup: 'T' as const })),
            ].filter((entry) => entry.className && !entry.className.includes('[연장]'));
            if (!error && teacher.credentials) {
              try {
                snapshot = await ttt.getCurrentMonthRegularClassSnapshotForTeacher(
                  targetDate,
                  teacher.name,
                  teacher.credentials,
                  currentRegularAssignments,
                  { scope: regularProofScope, lane: 'initial' },
                );
                validateTeacherSnapshot(snapshot, currentRegularAssignments);
                const currentAssignments = new Set(currentRegularAssignments
                  .map((entry) => `${entry.dayGroup}\u0000${entry.className}`));
                const nextAssignments = new Set((snapshot.classes || [])
                  .map((cls) => `${cls.dayGroup}\u0000${String(cls.className || '').trim()}`)
                  .filter((value) => !value.endsWith('\u0000')));
                needsConfirmation = isQuarterStart || [...currentAssignments]
                  .some((assignment) => !nextAssignments.has(assignment));
              } catch (readError: any) {
                error = readError?.message || '강사별 반별 원생목록 조회 실패';
              }
            }
            teacherReads[index] = {
              tid: teacher.tid,
              name: teacher.name,
              snapshot,
              error,
              currentAssignments: currentRegularAssignments,
              needsConfirmation,
            };
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, teachers.length) }, () => worker()));

        // 최초 증명과 모든 강사별 명단 조회가 끝난 뒤에만 파괴 후보를 재확인한다. 여러 강사가
        // 삭제 후보여도 confirmation 카탈로그+전체 반 상세는 이 요청의 fresh lane에서 한 번만 읽는다.
        const confirmationIndexes = teacherReads
          .map((read, index) => (read?.snapshot && !read.error && read.needsConfirmation ? index : -1))
          .filter((index) => index >= 0);
        let confirmationCursor = 0;
        const confirmationWorker = async () => {
          while (true) {
            const candidateIndex = confirmationCursor;
            confirmationCursor += 1;
            if (candidateIndex >= confirmationIndexes.length) return;
            const index = confirmationIndexes[candidateIndex];
            const teacher = teachers[index];
            const read = teacherReads[index];
            try {
              const confirmation = await ttt.getCurrentMonthRegularClassSnapshotForTeacher(
                targetDate,
                teacher.name,
                teacher.credentials,
                read.currentAssignments,
                { scope: regularProofScope, lane: 'confirmation' },
              );
              validateTeacherSnapshot(confirmation, read.currentAssignments);
              if (teacherSnapshotSignature(read.snapshot!) !== teacherSnapshotSignature(confirmation)) {
                throw new Error(isQuarterStart
                  ? '새 분기 통통통 명단이 두 번의 확인에서 일치하지 않습니다.'
                  : '기존 담당 반을 제외하는 통통통 명단이 두 번의 확인에서 일치하지 않습니다.');
              }
              read.snapshot = confirmation;
            } catch (readError: any) {
              read.error = readError?.message || '기존 담당 반 제외 명단 재확인 실패';
            }
          }
        };
        await Promise.all(Array.from(
          { length: Math.min(4, confirmationIndexes.length) },
          () => confirmationWorker(),
        ));

        const accountFailures = teacherReads
          .filter((teacher) => !!teacher.error)
          .map((teacher) => `${teacher.name}: ${teacher.error}`);

        const catalogByCode = new Map<string, TttRegularClass>();
        const classClaimants = new Map<string, Set<string>>();
        const classNameCodes = new Map<string, Set<string>>();
        const classNameClaimants = new Map<string, Set<string>>();
        const listedEnrollmentKeys = new Set<string>();
        const assignmentKeys = new Set<string>();
        const assignments: Array<{
          classCode: string;
          className: string;
          teacherTid: string;
          teacherName: string;
          dayGroup: 'M' | 'T';
          scheduleLabel: string;
        }> = [];
        const excludedExtensionClasses = new Map<string, string>();
        const nonPrimaryCurrentClasses = new Set<string>();
        const unsupportedClasses = new Map<string, {
          className: string;
          schedules: Set<string>;
          teachers: Set<string>;
          studentCount: number;
        }>();
        for (const teacher of teacherReads) {
          if (!teacher.snapshot) continue;
          for (const entry of teacher.snapshot.nonPrimaryCurrentClasses || []) {
            const className = String(entry.className || '').trim();
            if (className) {
              const status = entry.primaryStatus === 'unassigned' ? '담임 미지정' : '다른 담임';
              nonPrimaryCurrentClasses.add(`${teacher.name}: ${className} (${status})`);
            }
          }
          for (const extension of teacher.snapshot.excludedExtensions || []) {
            const code = String(extension.classCode || '').trim();
            const name = String(extension.className || '').trim();
            if (code && name) excludedExtensionClasses.set(code, name);
          }
          for (const unsupported of teacher.snapshot.unsupportedSchedules || []) {
            const code = String(unsupported.classCode || '').trim();
            const name = String(unsupported.className || '').trim();
            if (!code || !name) {
              accountFailures.push(`${teacher.name}: 미지원 반 코드 또는 반명이 비어 있습니다.`);
              continue;
            }
            const existing = unsupportedClasses.get(code) || {
              className: name,
              schedules: new Set<string>(),
              teachers: new Set<string>(),
              studentCount: 0,
            };
            if (existing.className !== name) {
              accountFailures.push(`${teacher.name}: 미지원 반 '${name}'의 정보가 다른 강사 조회 결과와 일치하지 않습니다.`);
              continue;
            }
            for (const schedule of unsupported.scheduleCodes || []) {
              const normalized = String(schedule || '').trim();
              if (normalized) existing.schedules.add(normalized);
            }
            existing.teachers.add(teacher.name);
            existing.studentCount = Math.max(existing.studentCount, Number(unsupported.studentCount || 0));
            unsupportedClasses.set(code, existing);
          }
          for (const cls of teacher.snapshot.classes || []) {
            const classCode = String(cls.classCode || '').trim();
            const className = String(cls.className || '').trim();
            if (!classCode || !className) {
              accountFailures.push(`${teacher.name}: 반 코드 또는 반명이 비어 있습니다.`);
              continue;
            }
            const existing = catalogByCode.get(classCode);
            if (existing && (
              String(existing.className || '').trim() !== className
              || String(existing.dayGroup || '') !== String(cls.dayGroup || '')
              || String(existing.scheduleCode || '') !== String(cls.scheduleCode || '')
            )) {
              accountFailures.push(`${teacher.name}: 반 '${className}'의 정보가 다른 담임 조회 결과와 일치하지 않습니다.`);
              continue;
            }
            if (!existing) catalogByCode.set(classCode, cls);
            const codesForName = classNameCodes.get(className) || new Set<string>();
            codesForName.add(classCode);
            classNameCodes.set(className, codesForName);
            for (const student of cls.students || []) {
              const studentCode = String(student.studentCode || student.scode || '').trim();
              if (studentCode) listedEnrollmentKeys.add(`${classCode}\u0000${studentCode}`);
            }
            const claimants = classClaimants.get(classCode) || new Set<string>();
            claimants.add(teacher.tid);
            classClaimants.set(classCode, claimants);
            const nameClaimants = classNameClaimants.get(className) || new Set<string>();
            nameClaimants.add(teacher.tid);
            classNameClaimants.set(className, nameClaimants);
            // 이 스냅샷은 반 상세 cl_sf_code까지 검증해 실제 담임 반만 포함한다.
            // 동일 반이 둘 이상의 로컬 강사에 반환되면 아래에서 전체 적용을 거부한다.
            if (!teacher.error) {
              const assignmentKey = `${teacher.tid}\u0000${classCode}`;
              if (!assignmentKeys.has(assignmentKey)) {
                assignmentKeys.add(assignmentKey);
                assignments.push({
                  classCode,
                  className,
                  teacherTid: teacher.tid,
                  teacherName: teacher.name,
                  dayGroup: cls.dayGroup,
                  scheduleLabel: cls.scheduleCode,
                });
              }
            }
          }
        }

        const excludedExtensionClassList = [...excludedExtensionClasses.values()]
          .sort((a, b) => a.localeCompare(b, 'ko'));
        const unsupportedClassList = [...unsupportedClasses.values()]
          .map((entry) => {
            const schedules = [...entry.schedules].join(' · ') || '요일 미지정';
            const teachers = [...entry.teachers].sort((a, b) => a.localeCompare(b, 'ko')).join(' · ');
            return `${teachers ? `${teachers}: ` : ''}${entry.className} (${schedules})`;
          })
          .sort((a, b) => a.localeCompare(b, 'ko'));
        const listedEnrollmentCount = listedEnrollmentKeys.size
          + [...unsupportedClasses.values()].reduce((sum, entry) => sum + entry.studentCount, 0);
        const connectedTeacherCount = teacherReads.filter((teacher) => !teacher.error).length;
        const ambiguousClassSet = new Set<string>();
        for (const [classCode, claimants] of classClaimants) {
          if (claimants.size > 1) {
            ambiguousClassSet.add(`${String(catalogByCode.get(classCode)?.className || classCode)} (담임 중복)`);
          }
        }
        for (const [className, claimants] of classNameClaimants) {
          if (claimants.size > 1 || (classNameCodes.get(className)?.size || 0) > 1) {
            ambiguousClassSet.add(`${className} (담임 또는 반코드 중복)`);
          }
        }
        const ambiguousClasses = [...ambiguousClassSet].sort((a, b) => a.localeCompare(b, 'ko'));
        const matchedTeacherCount = new Set(assignments.map((entry) => entry.teacherTid)).size;
        const uniquelyClaimedClassCount = [...classClaimants.values()]
          .filter((claimants) => claimants.size === 1).length;
        const canApply = assignments.length > 0
          && accountFailures.length === 0
          && unsupportedClassList.length === 0
          && ambiguousClasses.length === 0;
        const transition = isQuarterStart && canApply ? (() => {
          const nextByTeacher = new Map<string, Set<string>>();
          for (const assignment of assignments) {
            const values = nextByTeacher.get(assignment.teacherTid) || new Set<string>();
            values.add(`${assignment.dayGroup}\u0000${assignment.className}`);
            nextByTeacher.set(assignment.teacherTid, values);
          }
          let addedClassCount = 0;
          let removedClassCount = 0;
          let unchangedClassCount = 0;
          const teacherChanges = teachers.map((teacher) => {
            const before = new Set([
              ...(teacher.classes?.['월수금반'] || []).map((className) => `M\u0000${String(className || '').trim()}`),
              ...(teacher.classes?.['화목토반'] || []).map((className) => `T\u0000${String(className || '').trim()}`),
            ].filter((value) => !value.endsWith('\u0000') && !value.includes('[연장]')));
            const after = nextByTeacher.get(teacher.tid) || new Set<string>();
            const label = (value: string) => {
              const [dayGroup, className] = value.split('\u0000');
              return `${dayGroup === 'M' ? '월수금' : '화목토'} · ${className}`;
            };
            const added = [...after].filter((value) => !before.has(value)).map(label).sort((a, b) => a.localeCompare(b, 'ko'));
            const removed = [...before].filter((value) => !after.has(value)).map(label).sort((a, b) => a.localeCompare(b, 'ko'));
            const unchanged = [...before].filter((value) => after.has(value)).length;
            addedClassCount += added.length;
            removedClassCount += removed.length;
            unchangedClassCount += unchanged;
            return {
              teacherTid: teacher.tid,
              teacherName: teacher.name,
              beforeClassCount: before.size,
              afterClassCount: after.size,
              added,
              removed,
            };
          }).filter((entry) => entry.added.length || entry.removed.length);
          return {
            previousSourceMonth,
            targetSourceMonth: targetMonth,
            changedTeacherCount: teacherChanges.length,
            addedClassCount,
            removedClassCount,
            unchangedClassCount,
            teacherChanges,
          };
        })() : null;
        const previewFingerprint = isQuarterStart && canApply
          ? createHash('sha256').update(JSON.stringify({
            version: 1,
            guard,
            previousSourceMonth,
            targetDate,
            teacherSnapshots: teacherReads
              .filter((read) => !!read.snapshot && !read.error)
              .map((read) => ({ tid: read.tid, snapshot: teacherSnapshotSignature(read.snapshot!) }))
              .sort((left, right) => left.tid.localeCompare(right.tid)),
            assignments: assignments
              .map((entry) => ({
                classCode: entry.classCode,
                className: entry.className,
                teacherTid: entry.teacherTid,
                dayGroup: entry.dayGroup,
                scheduleLabel: entry.scheduleLabel,
              }))
              .sort((left, right) => `${left.teacherTid}\u0000${left.dayGroup}\u0000${left.classCode}`
                .localeCompare(`${right.teacherTid}\u0000${right.dayGroup}\u0000${right.classCode}`)),
          })).digest('hex')
          : '';
        const proposal = {
          applied: false,
          dryRun,
          canApply,
          syncMode: isQuarterStart ? 'quarter-start' : 'routine',
          targetDate,
          sourceMonth: targetDate.slice(0, 7),
          previousSourceMonth: isQuarterStart ? previousSourceMonth : undefined,
          previewFingerprint: isQuarterStart ? previewFingerprint : undefined,
          transition,
          matchedTeacherCount,
          classCount: assignments.length,
          listedClassCount: catalogByCode.size + unsupportedClassList.length,
          listedEnrollmentCount,
          registeredTeacherCount: teachers.length,
          connectedTeacherCount,
          validatedTeacherCount: connectedTeacherCount,
          uniquelyClaimedClassCount,
          retainedByCurrentOwner: [],
          nonPrimaryCurrentClasses: [...nonPrimaryCurrentClasses].sort((a, b) => a.localeCompare(b, 'ko')),
          excludedExtensionClasses: excludedExtensionClassList,
          unsupportedClasses: unsupportedClassList,
          unclaimedClasses: [],
          ambiguousClasses,
          accountFailures,
          searchedMonths: [targetDate.slice(0, 7)],
          message: canApply
            ? (dryRun
              ? (isQuarterStart
                ? '새 분기 명단 검증을 통과했습니다. 변경 내용을 확인해 주세요.'
                : '정규 반 동기화 사전 검증을 통과했습니다.')
              : '')
            : (isQuarterStart
              ? '새 분기 명단을 안전하게 확정하지 못해 기존 정규 반을 변경하지 않았습니다.'
              : '모든 반의 담당자를 안전하게 확정하지 못해 기존 일반 반을 변경하지 않았습니다.'),
        };
        if (dryRun || !canApply) return proposal;

        if (isQuarterStart && previewFingerprint !== expectedPreviewFingerprint) {
          throw new HttpError(409, '미리보기 이후 새 분기 명단 또는 강사 설정이 변경되었습니다. 미리보기를 다시 실행해 주세요.');
        }

        const applied = store.applyRegularClassSnapshot({
          targetDate,
          sourceMonth: targetDate.slice(0, 7),
          syncMode: isQuarterStart ? 'quarter-start' : 'routine',
          previousSourceMonth: isQuarterStart ? previousSourceMonth : undefined,
          addedClassCount: transition?.addedClassCount,
          removedClassCount: transition?.removedClassCount,
          changedTeacherCount: transition?.changedTeacherCount,
          classes: assignments,
          excludedExtensionClasses: excludedExtensionClassList,
          unsupportedClasses: unsupportedClassList,
          ambiguousClasses,
          retainedByCurrentOwner: [],
          uniquelyClaimedClassCount,
          registeredTeacherCount: teachers.length,
          connectedTeacherCount,
          listedClassCount: catalogByCode.size + unsupportedClassList.length,
          listedEnrollmentCount,
          searchedMonths: [targetDate.slice(0, 7)],
        }, guard);
        regularClassPrimaryWrite = true;
        return {
          ...proposal,
          ...applied,
          applied: true,
          dryRun: false,
          canApply: true,
          persistence: 'primary-confirmed',
          message: isQuarterStart ? '새 분기 정규 반 적용을 완료했습니다.' : '정규 반 동기화를 완료했습니다.',
        };
      } catch (e: any) {
        if (e instanceof HttpError) throw e;
        if (e instanceof TttSpecialError) {
          const status = e.code === 'CONFIG' ? 503 : e.code === 'NO_DATA' ? 404 : 502;
          throw new HttpError(status, e.message);
        }
        throw e;
      }
    }

    // ── 전체 상담 업무: 로스터/드래프트/통통통 전송 ──
    if (a === 'counsel') {
      if (b1 && !b2 && m === 'GET') {
        requireOwnedOtherTeamCounsel(b1);
        const teacher = boundTeacher(dec(s(q.teacher)));
        return store.getCounselSnapshotOnPrimary(b1, teacher, s(q.cls) || undefined);
      }
      if (b1 && b2 === 'sync-roster' && m === 'POST') {
        requireTeacher();
        requireOwnedOtherTeamCounsel(b1);
        const teacher = boundTeacher(b.teacher);
        const teacherTid = boundTid(b.tid);
        const context = store.getCounselContext(b1, teacher);
        if (b.prepare === true) {
          if (context.selfManaged) {
            const refreshed = store.syncSelfManagedCounselRosterFromCacheOnPrimary(b1, teacherTid);
            counselRosterPrimaryWrite = true;
            return {
              ...refreshed,
              kind: 'regular',
              targetDate: String(b.date || ''),
              rosterCount: Number(refreshed?.counts?.active || refreshed?.entries?.length || 0),
              snapshotCounts: {
                classes: Array.isArray(refreshed.classes) ? refreshed.classes.length : 0,
                enrollments: Number(refreshed?.counts?.active || refreshed?.entries?.length || 0),
                selectedClasses: Array.isArray(refreshed.classes) ? refreshed.classes.length : 0,
                selectedEnrollments: Number(refreshed?.counts?.active || refreshed?.entries?.length || 0),
              },
              excludedExtraClasses: [],
              removedNonPrimaryClasses: [],
              warnings: [],
            };
          }
          if (
            context.kind === 'regular'
            && typeof store.hasTeacherRosterSelection === 'function'
            && store.hasTeacherRosterSelection(teacherTid)
          ) {
            const refreshed = store.syncTeacherCounselRosterFromSelectionOnPrimary(b1, teacherTid);
            counselRosterPrimaryWrite = true;
            const counts = refreshed.snapshotCounts || { classes: 0, enrollments: 0 };
            return {
              ...refreshed,
              kind: 'regular',
              targetDate: String(b.date || ''),
              rosterCount: Number(refreshed?.counts?.active || refreshed?.entries?.length || 0),
              snapshotCounts: {
                classes: Number(counts.classes || 0),
                enrollments: Number(counts.enrollments || 0),
                selectedClasses: Number(counts.classes || 0),
                selectedEnrollments: Number(counts.enrollments || 0),
              },
              excludedExtraClasses: [],
              removedNonPrimaryClasses: [],
              warnings: [],
            };
          }
          const currentRegularMembership = context.kind === 'regular'
            ? store.getActiveCounselRosterMembershipOnPrimary({
              taskId: b1, teacher, teacherTid, kind: 'regular',
            })
            : [];
          const counselRegularProofScope = context.kind === 'regular'
            ? createRegularClassProofScope()
            : null;
          const requestedDate = String(b.date || '').trim();
          const targetDate = requestedDate || (() => {
            const parts: Record<string, string> = {};
            for (const part of new Intl.DateTimeFormat('en-CA', {
              timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
            }).formatToParts(new Date())) parts[part.type] = part.value;
            return `${parts.year}-${parts.month}-${parts.day}`;
          })();
          if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(targetDate)) {
            throw new HttpError(400, '학생 명단 동기화 기준일을 확인해 주세요.');
          }

          let snapshot: any;
          let regularTeacherCredentials: ReturnType<typeof creds> = null;
          if (context.kind === 'special') {
            snapshot = await specialTtt.getCurrentMonthClassSnapshot(targetDate);
          } else {
            regularTeacherCredentials = creds(teacherTid);
            if (!regularTeacherCredentials) throw new HttpError(400, '강사 통통통 계정을 먼저 연결해 주세요.');
            try {
              snapshot = await ttt.getCurrentMonthRegularClassSnapshotForTeacher(
                targetDate,
                teacher,
                regularTeacherCredentials,
                context.regularClasses || [],
                { scope: counselRegularProofScope!, lane: 'initial' },
              );
            } catch (readError: any) {
              throw new HttpError(
                502,
                readError?.message || '통통통 강사별 반별 원생목록을 불러오지 못했습니다.',
              );
            }
          }
          const targetMonth = targetDate.slice(0, 7);
          const validateSnapshotEnvelope = (candidate: any) => {
            if (candidate?.sourceMonth !== targetMonth || candidate?.targetMonth !== targetMonth) {
              throw new HttpError(502, '통통통이 요청한 현재 수강년월과 다른 명단을 반환해 기존 명단을 변경하지 않았습니다.');
            }
            if (!Number.isFinite(Number(candidate?.listedClassCount)) || Number(candidate.listedClassCount) < 0) {
              throw new HttpError(502, '통통통 반별 원생목록의 반 수를 확인할 수 없어 기존 명단을 변경하지 않았습니다.');
            }
            if (Number(candidate.listedClassCount) === 0 && context.kind === 'special') {
              throw new HttpError(502, '통통통 반별 원생목록이 비어 있어 기존 명단을 변경하지 않았습니다.');
            }
          };
          validateSnapshotEnvelope(snapshot);

          let selectedClasses = snapshot.classes as Array<any>;
          let excludedExtraClasses: string[] = [];
          let removedNonPrimaryClasses: string[] = [];
          let confirmedRemovalSignature = '';
          if (context.kind === 'special') {
            const unsupportedForTeacher = (snapshot.unsupportedSchedules || []).filter(
              (cls: any) => String(cls.teacherName || '').trim() === teacher,
            );
            if (unsupportedForTeacher.length) {
              throw new HttpError(502, '현재 강사의 특강 반에 지원하지 않는 요일표가 있어 기존 학생 명단을 변경하지 않았습니다.');
            }
            selectedClasses = selectedClasses.filter((cls) => String(cls.teacherName || '').trim() === teacher);
          } else {
            const expectedRegular = Array.isArray(context.regularClasses)
              ? context.regularClasses.map((entry: any) => ({
                className: String(entry?.className || '').trim(),
                dayGroup: entry?.dayGroup,
              }))
              : [];
            const contextNames = [...new Set(
              context.classes.map((className: string) => String(className || '').trim()).filter(Boolean),
            )];
            if (!Array.isArray(context.regularClasses)
              || expectedRegular.some((entry: any) => !entry.className || (entry.dayGroup !== 'M' && entry.dayGroup !== 'T'))
              || expectedRegular.length !== contextNames.length
              || expectedRegular.some((entry: any) => !contextNames.includes(entry.className))) {
              throw new HttpError(
                502,
                '현재 강사의 일반 담당 반 그룹을 정확히 확인할 수 없어 기존 학생 명단을 변경하지 않았습니다.',
              );
            }
            const expectedByName = new Map<string, 'M' | 'T'>();
            for (const entry of expectedRegular) {
              if (expectedByName.has(entry.className)) {
                throw new HttpError(502, '같은 일반 반이 여러 담당 그룹에 배정되어 기존 학생 명단을 변경하지 않았습니다.');
              }
              expectedByName.set(entry.className, entry.dayGroup);
            }

            const selectRegularSnapshot = (candidate: any) => {
              const explicitlyNonPrimary = new Map<string, 'unassigned' | 'other-teacher'>();
              for (const entry of candidate.nonPrimaryCurrentClasses || []) {
                const className = String(entry?.className || '').trim();
                const dayGroup = entry?.dayGroup;
                const expectedGroup = expectedByName.get(className);
                if (!className
                  || (dayGroup !== 'M' && dayGroup !== 'T')
                  || expectedGroup !== dayGroup
                  || (entry?.primaryStatus !== 'unassigned' && entry?.primaryStatus !== 'other-teacher')) {
                  throw new HttpError(502, '통통통 담임 제외 진단이 현재 담당 반과 일치하지 않아 기존 학생 명단을 변경하지 않았습니다.');
                }
                explicitlyNonPrimary.set(`${dayGroup}\u0000${className}`, entry.primaryStatus);
              }

              const supportedByName = new Map<string, any[]>();
              for (const cls of candidate.classes || []) {
                const className = String(cls.className || '').trim();
                if (!className) {
                  throw new HttpError(502, '통통통 일반 반명이 비어 있어 기존 학생 명단을 변경하지 않았습니다.');
                }
                const rows = supportedByName.get(className) || [];
                rows.push(cls);
                supportedByName.set(className, rows);
              }
              const unsupportedByName = new Map<string, any[]>();
              for (const cls of candidate.unsupportedSchedules || []) {
                const className = String(cls.className || '').trim();
                if (!className) {
                  throw new HttpError(502, '통통통 미지원 일반 반명이 비어 있어 기존 학생 명단을 변경하지 않았습니다.');
                }
                const rows = unsupportedByName.get(className) || [];
                rows.push(cls);
                unsupportedByName.set(className, rows);
              }

              const chosen: any[] = [];
              const removed: string[] = [];
              const canonicalStates: any[] = [];
              for (const [className, expectedGroup] of expectedByName) {
                const nonPrimaryStatus = explicitlyNonPrimary.get(`${expectedGroup}\u0000${className}`);
                if (nonPrimaryStatus) {
                  removed.push(className);
                  canonicalStates.push({
                    className,
                    dayGroup: expectedGroup,
                    status: 'nonPrimary',
                    primaryStatus: nonPrimaryStatus,
                  });
                  continue;
                }
                if ((unsupportedByName.get(className) || []).length) {
                  throw new HttpError(
                    502,
                    `담당 일반 반 '${className}'의 요일표를 지원하지 않아 기존 학생 명단을 변경하지 않았습니다.`,
                  );
                }
                const matches = supportedByName.get(className) || [];
                if (matches.length !== 1) {
                  throw new HttpError(
                    502,
                    `담당 일반 반 '${className}'을 현재 월 통통통 명단에서 정확히 확인하지 못해 기존 학생 명단을 변경하지 않았습니다.`,
                  );
                }
                if (matches[0].dayGroup !== expectedGroup) {
                  throw new HttpError(
                    502,
                    `담당 일반 반 '${className}'의 요일 그룹이 기존 배정과 달라 학생 명단을 변경하지 않았습니다.`,
                  );
                }
                chosen.push(matches[0]);
                canonicalStates.push({
                  className,
                  dayGroup: expectedGroup,
                  status: 'primary',
                  classCode: String(matches[0].classCode || '').trim(),
                  scheduleCode: String(matches[0].scheduleCode || '').trim(),
                  studentCodes: [...new Set<string>(
                    (Array.isArray(matches[0].students) ? matches[0].students : [])
                      .map((student: any) => String(student.scode || student.studentCode || '').trim()),
                  )].sort((left, right) => left.localeCompare(right)),
                });
              }
              return {
                selectedClasses: chosen,
                excludedExtraClasses: [...new Set([
                  ...[...supportedByName.keys()].filter((className) => !expectedByName.has(className)),
                  ...[...unsupportedByName.keys()].filter((className) => !expectedByName.has(className)),
                ])].sort((left, right) => left.localeCompare(right, 'ko')),
                removedNonPrimaryClasses: removed.sort((left, right) => left.localeCompare(right, 'ko')),
                fullSignature: JSON.stringify(canonicalStates.sort((left, right) =>
                  left.className.localeCompare(right.className, 'ko')
                  || left.dayGroup.localeCompare(right.dayGroup))),
              };
            };
            const membershipOf = (chosen: any[]) => chosen.flatMap((cls) =>
              (Array.isArray(cls.students) ? cls.students : []).map((student: any) => ({
                classCode: String(cls.classCode || '').trim(),
                className: String(cls.className || '').trim(),
                scode: String(student.scode || student.studentCode || '').trim(),
              })));

            let selection = selectRegularSnapshot(snapshot);
            selectedClasses = selection.selectedClasses;
            excludedExtraClasses = selection.excludedExtraClasses;
            removedNonPrimaryClasses = selection.removedNonPrimaryClasses;
            const firstMembership = membershipOf(selectedClasses);
            const incomingStableKeys = new Set(firstMembership.map((row: any) =>
              JSON.stringify([row.classCode, row.scode])));
            const incomingNaturalKeys = new Set(firstMembership.map((row: any) =>
              JSON.stringify([row.className, row.scode])));
            const removesActiveStudent = currentRegularMembership.some((row: any) => {
              const scode = String(row.scode || '').trim();
              return !incomingStableKeys.has(JSON.stringify([String(row.classCode || '').trim(), scode]))
                && !incomingNaturalKeys.has(JSON.stringify([String(row.className || '').trim(), scode]));
            });

            if (removesActiveStudent) {
              let confirmation: any;
              try {
                confirmation = await ttt.getCurrentMonthRegularClassSnapshotForTeacher(
                  targetDate,
                  teacher,
                  regularTeacherCredentials!,
                  context.regularClasses || [],
                  { scope: counselRegularProofScope!, lane: 'confirmation' },
                );
              } catch (readError: any) {
                throw new HttpError(
                  502,
                  readError?.message || '통통통 기존 학생 제외 명단을 다시 확인하지 못해 기존 명단을 변경하지 않았습니다.',
                );
              }
              validateSnapshotEnvelope(confirmation);
              const confirmedSelection = selectRegularSnapshot(confirmation);
              const confirmationMembershipSignature = store.counselRosterMembershipSignature(
                membershipOf(confirmedSelection.selectedClasses),
              );
              if (selection.fullSignature !== confirmedSelection.fullSignature) {
                throw new HttpError(
                  502,
                  '기존 활성 학생을 제외하는 통통통 명단이 두 번의 확인에서 일치하지 않아 기존 명단을 변경하지 않았습니다.',
                );
              }
              snapshot = confirmation;
              selection = confirmedSelection;
              selectedClasses = selection.selectedClasses;
              excludedExtraClasses = selection.excludedExtraClasses;
              removedNonPrimaryClasses = selection.removedNonPrimaryClasses;
              confirmedRemovalSignature = confirmationMembershipSignature;
            }
          }

          const classes = selectedClasses.map((cls) => ({
            classCode: String(cls.classCode || '').trim(),
            className: String(cls.className || '').trim(),
            students: (Array.isArray(cls.students) ? cls.students : []).map((student: any) => ({
              scode: String(student.scode || student.studentCode || '').trim(),
              student: String(student.student || student.studentName || '').trim(),
            })),
          }));
          const result = store.reconcileCounselRosterSnapshotOnPrimary({
            taskId: b1,
            teacher,
            teacherTid,
            kind: context.kind,
            sourceMonth: snapshot.sourceMonth,
            classes,
            syncedAt: new Date().toISOString(),
            ...(confirmedRemovalSignature ? { confirmedRemovalSignature } : {}),
          });
          counselRosterPrimaryWrite = true;
          return {
            ...result,
            kind: context.kind,
            targetDate,
            sourceMonth: snapshot.sourceMonth,
            classes: result.classes,
            rosterCount: result.counts.active,
            snapshotCounts: {
              classes: Number(snapshot.listedClassCount),
              enrollments: Number(snapshot.listedEnrollmentCount),
              selectedClasses: classes.length,
              selectedEnrollments: classes.reduce((sum, cls) => sum + cls.students.length, 0),
            },
            excludedExtraClasses,
            removedNonPrimaryClasses,
            warnings: [
              ...(removedNonPrimaryClasses.length
                ? [`담임이 아님을 확인한 기존 ${removedNonPrimaryClasses.length}개 반을 명단에서 제외했습니다.`]
                : []),
              ...(excludedExtraClasses.length
                ? [`현재 담당 반이 아닌 ${excludedExtraClasses.length}개 반을 제외했습니다.`]
                : []),
            ],
          };
        }

        const cls = String(b.cls || '').trim();
        if (!cls) throw new HttpError(400, '연락처를 동기화할 반을 선택해 주세요.');
        const current = store.getCounselSnapshotOnPrimary(b1, teacher, cls);
        if (current.kind !== context.kind || !current.classes.includes(cls)) {
          throw new HttpError(400, '이 상담 업무에 배정되지 않은 반입니다.');
        }
        const activeEntries = current.entries.filter((entry: any) => entry.rosterActive !== false);
        const rosterSourceMonths = Array.from(new Set<string>(
          activeEntries.map((entry: any) => String(entry.rosterSourceMonth || '').trim()).filter(Boolean),
        ));
        if (rosterSourceMonths.length > 1) {
          throw new HttpError(409, '서로 다른 수강년월의 학생 명단이 섞여 있어 연락처 동기화를 취소했습니다. 명단을 다시 동기화해 주세요.');
        }
        const contactSourceMonth = rosterSourceMonths[0] || String(current.sourceMonth || '').trim();
        if (activeEntries.length && !/^\d{4}-(0[1-9]|1[0-2])$/.test(contactSourceMonth)) {
          throw new HttpError(409, '학생 명단의 수강년월을 확인할 수 없습니다. 명단을 먼저 다시 동기화해 주세요.');
        }
        if (activeEntries.some((entry: any) => !String(entry.classCode || '').trim())) {
          throw new HttpError(409, '기존 학생 명단에 반 코드가 없습니다. 현재 수강년월 명단을 먼저 다시 동기화해 주세요.');
        }
        const targetCodes = Array.from(new Set<string>(
          activeEntries.map((entry: any) => String(entry.scode || '').trim()).filter(Boolean),
        ));
        let detail = { phones: [] as Array<{ studentCode: string; motherPhone: string }>, failures: [] as Array<{ studentCode: string; reason: any }> };
        if (targetCodes.length) detail = await specialTtt.getStudentMotherPhones(targetCodes);

        const requested = new Set(targetCodes);
        const phoneByCode = new Map<string, string>();
        for (const row of detail.phones || []) {
          const scode = String(row.studentCode || '').trim();
          if (requested.has(scode) && !phoneByCode.has(scode)) phoneByCode.set(scode, String(row.motherPhone || '').trim());
        }
        const failureReasonByCode = new Map<string, any>();
        for (const row of detail.failures || []) {
          const scode = String(row.studentCode || '').trim();
          if (requested.has(scode) && !phoneByCode.has(scode) && !failureReasonByCode.has(scode)) {
            failureReasonByCode.set(scode, row.reason);
          }
        }
        const normalizedFailures = targetCodes
          .filter((scode) => !phoneByCode.has(scode))
          .map((scode) => ({ studentCode: scode, reason: failureReasonByCode.get(scode) || 'invalid-response' }));
        const normalizedDetail = {
          phones: [...phoneByCode].map(([studentCode, motherPhone]) => ({ studentCode, motherPhone })),
          failures: normalizedFailures,
        };
        const contactSync = summarizeSpecialMotherPhoneBatch(targetCodes, normalizedDetail);
        if (contactSync.allFailed) {
          throw new HttpError(502, '통통통 학생 상세 정보를 불러오지 못해 기존 연락처를 변경하지 않았습니다.');
        }
        const contacts = activeEntries.map((entry: any) => {
          const scode = String(entry.scode || '').trim();
          return {
            classCode: String(entry.classCode || '').trim(),
            scode,
            motherPhone: phoneByCode.get(scode) || '',
            success: phoneByCode.has(scode),
          };
        });
        const updated = store.updateCounselRosterContactsOnPrimary({
          taskId: b1,
          teacher,
          teacherTid,
          kind: current.kind,
          sourceMonth: contactSourceMonth,
          contacts,
          syncedAt: new Date().toISOString(),
        });
        counselRosterPrimaryWrite = true;
        const entries = updated.entries.filter((entry: any) => entry.cls === cls);
        const warnings: string[] = [];
        if (normalizedFailures.length) warnings.push(`학생 상세 조회 실패 ${normalizedFailures.length}명 · 기존 번호 유지`);
        const missingPhoneCount = entries.filter((entry: any) => !String(entry.phone || '').trim()).length;
        if (missingPhoneCount) warnings.push(`어머니 연락처 미확인 ${missingPhoneCount}명`);
        return {
          ...updated,
          entries,
          kind: current.kind,
          sourceMonth: contactSourceMonth,
          classes: current.classes,
          rosterCount: entries.length,
          missingPhoneCount,
          warnings,
          contactSync,
        };
      }
      if (b1 === 'entry' && b2 && b3 === 'absence' && m === 'POST') {
        requireTeacher();
        const entry = store.resolveCounselEntry(b2, counselNaturalKey());
        assertCounselEntryAccess(entry);
        const content = String(b.content || '').trim();
        if (!content) throw new HttpError(400, '부재/문자 내용을 입력해 주세요.');
        const attempt = store.beginCounselAbsenceDelivery(b2, counselNaturalKey(), {
          content,
          date: String(b.date || '').trim(),
          requestId: String(b.requestId || '').trim(),
        }, `${requestRole}:${requestTid}`);
        assertCounselAbsenceAccess(attempt.attempt);
        if (attempt.action === 'confirmed') {
          counselResponseStatus = 200;
          return {
            attempt: attempt.attempt,
            entries: counselEntriesForAttempt(attempt.attempt),
            delivery: {
              erp: 'confirmed', state: 'confirmed', persistence: 'synced', doNotRetransmit: true,
              message: attempt.attempt.deliveryMessage || '통통통 부재/문자 전송과 앱 저장을 이미 확인했습니다.',
            },
          };
        }
        if (attempt.action === 'pending') return reconcilePendingCounselAbsence(attempt.attempt);

        let writeResult: Awaited<ReturnType<typeof ttt.writeCounsel>>;
        try {
          writeResult = await ttt.writeCounsel({
            scode: entry.scode,
            sname: entry.student,
            className: entry.cls,
            content,
            subject: '부재/문자',
            kind: 'absence-text',
            openLevel: b.openLevel,
            date: String(b.date || '').trim(),
          }, creds(boundTid(b.tid)), {
            onBeforePost: async ({ beforeCount }) => {
              store.recordCounselAbsenceBeforePost(attempt.attempt.id, attempt.fingerprint, attempt.claimToken, {
                beforeCount,
                message: '통통통 부재/문자 전송을 시작했습니다. 같은 기록을 다시 전송하지 마세요.',
              });
            },
          });
        } catch (error) {
          if (error instanceof TttCounselWriteIndeterminateError) {
            const message = '통통통 부재/문자 전송 요청은 완료됐고 결과를 확인 중입니다. 같은 기록을 다시 전송하지 마세요.';
            const pending = store.markCounselAbsenceIndeterminate(attempt.attempt.id, attempt.fingerprint, {
              beforeCount: error.beforeCount,
              claimToken: attempt.claimToken,
              message,
            });
            return pendingCounselAbsencePayload(pending, message);
          }
          try {
            store.resetCounselAbsenceBeforePost(attempt.attempt.id, attempt.fingerprint, attempt.claimToken);
            try { db.syncStrict(); } catch { /* primary 삭제는 이미 영속됐다. */ }
            throw new HttpError(502, '통통통 부재/문자 전송 전에 요청이 중단되었습니다. 통통통에는 전송하지 않았습니다.');
          } catch (resetError) {
            if (resetError instanceof HttpError && resetError.status === 502) throw resetError;
            const message = '통통통 부재/문자 전송이 시작됐을 수 있어 결과를 확인 중입니다. 같은 기록을 다시 전송하지 마세요.';
            const pending = store.markCounselAbsenceIndeterminate(attempt.attempt.id, attempt.fingerprint, {
              claimToken: attempt.claimToken,
              message,
            });
            return pendingCounselAbsencePayload(pending, message);
          }
        }
        let confirmedAttempt = attempt.attempt;
        let localMarked = false;
        try {
          confirmedAttempt = store.confirmCounselAbsenceDelivery(attempt.attempt.id, attempt.fingerprint, counselSyncedAt(), {
            beforeCount: writeResult.beforeCount,
            message: '통통통 부재/문자 전송과 앱 저장을 확인했습니다.',
          });
          localMarked = true;
        } catch { /* ERP 성공은 읽기로 확인됐으므로 로컬 표시 실패를 재전송 가능한 오류로 바꾸지 않는다. */ }
        confirmedCounselWrite = {
          localMarked,
          verification: writeResult.verification,
          beforeCount: writeResult.beforeCount,
          afterCount: writeResult.afterCount,
        };
        return { attempt: confirmedAttempt, entries: counselEntriesForAttempt(confirmedAttempt) };
      }
      if (b1 === 'absence' && b2 && b3 === 'reconcile' && m === 'POST') {
        requireTeacher();
        const attempt = store.getCounselAbsenceAttempt(b2);
        assertCounselAbsenceAccess(attempt);
        return reconcilePendingCounselAbsence(attempt);
      }
      if (b1 === 'entry' && b2 && b3 === 'done' && m === 'POST') {
        requireTeacher();
        const entry = store.getCounselEntry(b2);
        assertCounselEntryAccess(entry);
        store.setCounselDone(b2, !!b.done);
        return { entry: store.getCounselEntry(b2) };
      }
      if (b1 === 'entry' && b2 && b3 === 'write' && m === 'POST') {
        requireTeacher();
        const e = store.resolveCounselEntry(b2, counselNaturalKey());
        assertCounselEntryAccess(e);
        const content = (b.content ?? e.content ?? '').trim();
        if (!content) throw new HttpError(400, '상담 내용을 입력해 주세요.');
        const subject = (b.subject ?? e.subject ?? '상담').trim() || '상담';
        const attempt = store.beginCounselDelivery(b2, counselNaturalKey(), {
          subject,
          content,
          date: String(b.date || '').trim(),
        });
        const actual = attempt.entry;
        assertCounselEntryAccess(actual);
        if (attempt.action === 'confirmed') {
          counselResponseStatus = 200;
          return {
            entry: actual,
            delivery: {
              erp: 'confirmed', state: 'confirmed', persistence: 'synced', doNotRetransmit: true,
              message: actual.deliveryMessage || '통통통 전송과 앱 상태 저장을 이미 확인했습니다.',
            },
          };
        }
        if (attempt.action === 'pending') return reconcilePendingCounsel(actual);

        let writeResult: Awaited<ReturnType<typeof ttt.writeCounsel>>;
        try {
          writeResult = await ttt.writeCounsel({
            scode: actual.scode,
            sname: actual.student,
            className: actual.cls,
            content,
            subject,
            openLevel: b.openLevel,
            date: actual.deliveryDate,
          }, creds(boundTid(b.tid)), {
            onBeforePost: async ({ beforeCount, writeDate }) => {
              store.recordCounselDeliveryBeforePost(actual.id, attempt.fingerprint, attempt.claimToken, {
                beforeCount,
                message: '통통통 전송을 시작했습니다. 결과 확인 전에는 같은 상담을 다시 전송하지 마세요.',
              });
              // recordCounselDeliveryBeforePost 자체가 공유 Turso primary에 직접 영속한다.
              // 여기서 embedded replica sync를 추가하면 primary 기록은 성공했는데 sync만 실패해
              // POST를 막고도 posting 상태를 남길 수 있으므로 외부 POST 경계에는 끼우지 않는다.
            },
          });
        } catch (error) {
          if (error instanceof TttCounselWriteIndeterminateError) {
            // 저장 거부 안내문은 이 응답에서만 얻을 수 있다. 이후 「전송 결과 확인」이 다시 읽어도 남지 않으므로 함께 보존한다.
            const erpNotice = String((error as any).erpNotice || '').trim();
            const message = '통통통 전송 요청은 완료됐고 결과를 확인 중입니다. 같은 상담을 다시 전송하지 말고 「전송 결과 확인」을 눌러 주세요.'
              + (erpNotice ? ` 통통통 응답: “${erpNotice}”` : '');
            const pending = store.markCounselDeliveryIndeterminate(actual.id, attempt.fingerprint, {
              beforeCount: error.beforeCount,
              claimToken: attempt.claimToken,
              message,
            });
            return pendingCounselPayload(pending, message);
          }
          // claimed라면 외부 POST 경계를 넘지 않았음이 증명되므로 선점을 풀 수 있다.
          // 이미 posting이면 요청 도달 여부를 단정할 수 없어 재전송 금지 pending으로 보존한다.
          try {
            store.resetCounselDeliveryBeforePost(actual.id, attempt.fingerprint, attempt.claimToken, '통통통 전송 전에 요청이 중단되어 전송하지 않았습니다.');
            try { db.syncStrict(); } catch { /* primary 초기화는 이미 영속됐고 다음 요청에서 다시 pull한다. */ }
            throw new HttpError(502, '통통통 상담 전송 전에 요청이 중단되었습니다. 작성 내용은 저장했고 통통통에는 전송하지 않았습니다.');
          } catch (resetError) {
            if (resetError instanceof HttpError && resetError.status === 502) throw resetError;
            const message = '통통통 전송이 시작됐을 수 있어 결과를 확인 중입니다. 같은 상담을 다시 전송하지 말고 「전송 결과 확인」을 눌러 주세요.';
            const pending = store.markCounselDeliveryIndeterminate(actual.id, attempt.fingerprint, {
              claimToken: attempt.claimToken,
              message,
            });
            return pendingCounselPayload(pending, message);
          }
        }
        confirmedCounselWrite = {
          localMarked: false,
          verification: writeResult.verification,
          beforeCount: writeResult.beforeCount,
          afterCount: writeResult.afterCount,
        };
        let confirmedEntry = actual;
        try {
          confirmedEntry = store.confirmCounselDelivery(actual.id, attempt.fingerprint, counselSyncedAt(), {
            beforeCount: writeResult.beforeCount,
            message: '통통통 전송과 앱 상태 저장을 확인했습니다.',
          });
          confirmedCounselWrite.localMarked = true;
        } catch {
          // ERP 성공은 이미 조회로 확인됐다. 로컬 표시 실패를 전송 실패로 바꿔 재전송을 유도하지 않는다.
        }
        return { entry: confirmedEntry };
      }
      if (b1 === 'entry' && b2 && b3 === 'reconcile' && m === 'POST') {
        requireTeacher();
        const entry = store.resolveCounselEntry(b2, counselNaturalKey());
        assertCounselEntryAccess(entry);
        if (entry.deliveryState === 'confirmed' || entry.synced) {
          counselResponseStatus = 200;
          return {
            entry,
            delivery: {
              erp: 'confirmed', state: 'confirmed', persistence: 'synced', doNotRetransmit: true,
              message: entry.deliveryMessage || '통통통 전송과 앱 상태 저장을 이미 확인했습니다.',
            },
          };
        }
        if (entry.deliveryState !== 'pending') throw new HttpError(409, '확인 중인 상담 전송이 없습니다. 목록을 새로고침해 주세요.');
        return reconcilePendingCounsel(entry);
      }
      // 사람이 통통통을 직접 확인한 뒤에만 쓰는 수동 종결. 자동 조회로는 저장 실패와 조회 실패를
      // 끝내 구분할 수 없어 pending이 영구히 남는데, 그 유일한 탈출구다. ERP는 호출하지 않는다.
      if (b1 === 'entry' && b2 && b3 === 'resolve' && m === 'POST') {
        requireTeacher();
        const entry = store.resolveCounselEntry(b2, counselNaturalKey());
        assertCounselEntryAccess(entry);
        const resolution = String(b.resolution || '').trim();
        if (resolution !== 'not-sent' && resolution !== 'sent') {
          throw new HttpError(400, '통통통 확인 결과를 선택해 주세요.');
        }
        if (entry.deliveryState === 'confirmed' || entry.synced) {
          counselResponseStatus = 200;
          return {
            entry,
            delivery: {
              erp: 'confirmed', state: 'confirmed', persistence: 'synced', doNotRetransmit: true,
              message: entry.deliveryMessage || '통통통 전송과 앱 상태 저장을 이미 확인했습니다.',
            },
          };
        }
        const fingerprint = String(b.fingerprint || entry.deliveryFingerprint || '');
        if (!fingerprint || fingerprint !== String(entry.deliveryFingerprint || '')) {
          throw new HttpError(409, '상담 전송 상태가 변경되었습니다. 목록을 새로고침해 주세요.');
        }
        const actor = store.resolveTeacherName(requestTid) || '강사';
        const resolved = store.resolveStuckCounselDelivery(
          entry.id, fingerprint, resolution, actor, counselSyncedAt(),
        );
        console.warn(JSON.stringify({
          level: 'warning', message: 'counsel_delivery_resolved_manually',
          entryId: String(entry.id || ''), scode: String(entry.scode || ''), cls: String(entry.cls || ''),
          writeDate: String(entry.deliveryDate || ''), resolution,
          requestId: vercelRequestId || undefined,
        }));
        counselResponseStatus = 200;
        return {
          entry: resolved,
          delivery: resolution === 'sent'
            ? {
              erp: 'confirmed', state: 'confirmed', persistence: 'synced', doNotRetransmit: true,
              message: resolved.deliveryMessage,
            }
            : {
              erp: 'not-sent', state: 'retryable', persistence: 'synced', doNotRetransmit: false,
              message: resolved.deliveryMessage,
            },
        };
      }
    }

    // ── 통통통 ──
    if (a === 'ttt') {
      if (requestRole === 'other' && b1 !== 'notebook') {
        throw new HttpError(403, '다른 팀 계정은 본인 반 알림장 기능만 사용할 수 있습니다.');
      }
      if (b1 === 'status' && m === 'GET') return ttt.status(creds(boundTid(s(q.tid))));
      if (b1 === 'teacher-creds' && m === 'POST') {
        requireLead();
        const id = (b.tttId || '').trim();
        if (!b.tid || !id) throw new HttpError(400, '통통통 아이디를 입력해 주세요.');
        let pw = b.tttPw || '';
        if (!pw) { const ex = store.getTeacherTtt(b.tid); pw = ex?.pw || ''; }
        if (!pw) throw new HttpError(400, '통통통 비밀번호를 입력해 주세요.');
        let memberName: string;
        try { memberName = await ttt.validateCreds({ id, pw }); }
        catch (e: any) { throw new HttpError(400, `통통통 로그인 실패 — ${e?.message || e}`); }
        store.setTeacherTtt(b.tid, id, b.tttPw || '');
        return { ok: true, memberName };
      }
      if (b1 === 'notebook' && m === 'GET') {
        const cls = s(q.cls);
        assertTeacherClassAccess(cls);
        return ttt.getNotebook(cls, s(q.date), creds(boundTid(s(q.tid))));
      }
      if (b1 === 'notebook' && m === 'POST') {
        assertTeacherClassAccess(b.cls);
        return ttt.postNotebook(b.cls, b.date, b.title, b.body, b.files || [], b.cmtId || null, b.attach, creds(boundTid(b.tid)));
      }
      if (b1 === 'attendance' && m === 'GET') {
        assertTeacherClassAccess(s(q.cls));
        return ttt.getAttendance(s(q.cls), s(q.date), creds(boundTid(s(q.tid))));
      }
      if (b1 === 'counsel' && m === 'GET') {
        const classes = String(s(q.classes) || '').split(',').filter(Boolean);
        classes.forEach(assertTeacherClassAccess);
        return ttt.getCounsel(s(q.date), classes, creds(boundTid(s(q.tid))));
      }
      if (b1 === 'scores' && m === 'GET') {
        assertTeacherClassAccess(s(q.cls));
        return ttt.getScores(s(q.cls), s(q.date), s(q.hwdate), creds(boundTid(s(q.tid))));
      }
      if (b1 === 'roster' && m === 'GET') {
        assertTeacherClassAccess(s(q.cls));
        return ttt.getRoster(s(q.cls), s(q.date), creds(boundTid(s(q.tid))));
      }
      if (b1 === 'counsel-write' && m === 'POST') {
        throw new HttpError(410, '이 상담 전송 경로는 중복 방지 상태를 저장하지 않아 비활성화되었습니다. 내 업무의 상담 작성·전송을 이용해 주세요.');
      }
    }

    return undefined; // 매칭 없음 → 404
  }
}
