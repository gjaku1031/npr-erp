import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { appSecret } from '../secret';

/**
 * 서명된 세션 쿠키.
 *
 * 쿠키에는 계정 종류와 아이디, 만료 시각만 담고 HMAC-SHA256으로 서명한다. 역할(팀장·강사·다른 팀)은 쿠키에 넣지 않고
 * 요청마다 DB의 계정 권한으로 다시 판단하므로, 권한을 회수하면 다음 요청부터 바로 반영된다.
 * HttpOnly라 스크립트에서 읽을 수 없고, SameSite=Lax라 다른 사이트에서 보낸 POST에는 실리지 않는다.
 */
export const SESSION_COOKIE = 'npr_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export type AccountKind = 'lead' | 'teacher';

export interface SessionClaims {
  kind: AccountKind;
  tid: string;
  /** 만료 시각(epoch 초). */
  exp: number;
}

function signingKey(): Buffer {
  // 같은 APP_SECRET에서 용도별 키를 나눠, 다른 서명(반 목록 확인 정보)과 토큰을 바꿔 쓸 수 없게 한다.
  return createHash('sha256').update(`session-cookie\n${appSecret()}`).digest();
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

export function createSessionToken(kind: AccountKind, tid: string, nowMs = Date.now()): string {
  const claims: SessionClaims = { kind, tid, exp: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS };
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: unknown, nowMs = Date.now()): SessionClaims | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const expected = Buffer.from(sign(parts[0]), 'base64url');
  const actual = Buffer.from(parts[1], 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let claims: SessionClaims;
  try { claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return null; }
  if (!claims || (claims.kind !== 'lead' && claims.kind !== 'teacher')) return null;
  if (typeof claims.tid !== 'string' || !claims.tid) return null;
  if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= nowMs) return null;
  return claims;
}

function secureFlag(): string {
  return process.env.NODE_ENV === 'production' ? '; Secure' : '';
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secureFlag()}`;
}

export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}
