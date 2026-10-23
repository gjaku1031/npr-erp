import { HttpError } from '../http-error';
import {
  clearedSessionCookie,
  createSessionToken,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  verifySessionToken,
  type AccountKind,
} from './session';

/**
 * API 요청의 행위자 결정, 변경 요청의 출처 검사, 로그인 시도 제한.
 *
 * 행위자(누가 요청했는지)는 서명된 세션 쿠키에서만 정한다. 요청의 `role` 값은 "어느 화면으로 보고 있는지"만 뜻하며,
 * 그 계정이 가진 권한 안에서만 받아들인다. 요청의 `tid`는 행위자 판단에 쓰지 않는다.
 */

export type Role = 'lead' | 'teacher' | 'other';

export interface Actor {
  role: Role;
  tid: string;
}

export interface SessionAccount {
  tid: string;
  canLead: boolean;
  isTeacher: boolean;
  canOtherTeam: boolean;
}

export interface SessionAccountReader {
  getSessionAccount(kind: AccountKind, tid: string): SessionAccount | null;
}

interface RequestLike {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  body?: unknown;
  socket?: { remoteAddress?: string };
}

const first = (value: unknown): string => String(Array.isArray(value) ? value[0] ?? '' : value ?? '').trim();

function header(req: RequestLike, name: string): string {
  return first(req.headers?.[name]);
}

function allowedRoles(account: SessionAccount): Role[] {
  const roles: Role[] = [];
  if (account.canLead) roles.push('lead');
  if (account.isTeacher) roles.push('teacher');
  if (account.canOtherTeam) roles.push('other');
  return roles;
}

/** 세션 쿠키와 DB의 계정 권한으로 행위자를 정한다. 세션이 없거나 계정이 사라졌으면 null. */
export function resolveActor(req: RequestLike, accounts: SessionAccountReader): Actor | null {
  const claims = verifySessionToken(readCookie(header(req, 'cookie'), SESSION_COOKIE));
  if (!claims) return null;
  const account = accounts.getSessionAccount(claims.kind, claims.tid);
  if (!account) return null;
  const roles = allowedRoles(account);
  if (!roles.length) return null;
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const requested = first(req.query?.role) || first(body.role);
  const role = roles.includes(requested as Role) ? requested as Role : roles[0];
  return { role, tid: account.tid };
}

/** 로그인 성공 후 내려 줄 세션 쿠키. */
export function issueSessionCookie(kind: AccountKind, tid: string): string {
  return sessionCookie(createSessionToken(kind, tid));
}

export function clearSessionCookie(): string {
  return clearedSessionCookie();
}

/**
 * 상태를 바꾸는 요청은 같은 출처에서 온 것만 받는다. 브라우저가 붙이는 Origin(없으면 Sec-Fetch-Site)으로 판단하므로
 * 세션 쿠키가 실린 다른 사이트의 요청을 막는다. 두 헤더가 모두 없는 요청(서버 간 호출·테스트)은 쿠키도 없으므로 통과시킨다.
 */
export function assertSameOrigin(req: RequestLike): void {
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const host = header(req, 'x-forwarded-host') || header(req, 'host');
  const origin = header(req, 'origin');
  if (origin) {
    let originHost = '';
    try { originHost = new URL(origin).host; } catch { /* 잘못된 Origin은 거부 */ }
    if (!originHost || !host || originHost !== host) throw new HttpError(403, '허용되지 않은 출처의 요청입니다.');
    return;
  }
  const site = header(req, 'sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, '허용되지 않은 출처의 요청입니다.');
}

/**
 * 로그인 시도 제한. 같은 IP·아이디 조합이 10분 안에 5번 틀리면 10분 동안 막는다.
 * 프로세스 메모리에 두므로 서버리스 인스턴스마다 따로 센다.
 */
export class LoginThrottle {
  private readonly attempts = new Map<string, { failures: number; firstAt: number; blockedUntil: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 10 * 60 * 1000,
    private readonly maxEntries = 5000,
  ) {}

  key(req: RequestLike, id: unknown): string {
    const forwarded = header(req, 'x-forwarded-for').split(',')[0].trim();
    const ip = forwarded || req.socket?.remoteAddress || 'unknown';
    return `${ip}|${String(id ?? '').trim().toLowerCase()}`;
  }

  assertAllowed(key: string, now = Date.now()): void {
    const entry = this.attempts.get(key);
    if (entry && entry.blockedUntil > now) {
      throw new HttpError(429, '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    }
  }

  recordFailure(key: string, now = Date.now()): void {
    let entry = this.attempts.get(key);
    if (!entry || now - entry.firstAt > this.windowMs) entry = { failures: 0, firstAt: now, blockedUntil: 0 };
    entry.failures += 1;
    if (entry.failures >= this.maxFailures) entry.blockedUntil = now + this.windowMs;
    this.attempts.delete(key);
    this.attempts.set(key, entry);
    while (this.attempts.size > this.maxEntries) this.attempts.delete(this.attempts.keys().next().value!);
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

export const loginThrottle = new LoginThrottle();
