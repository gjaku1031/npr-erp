import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * 앱 로그인 비밀번호 해시(scrypt).
 * 저장 형식: `scrypt$N$r$p$<salt base64>$<hash base64>`. 매개변수를 함께 저장해 나중에 강도를 올려도 기존 해시를 검증할 수 있다.
 */
const PREFIX = 'scrypt';
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

export function isPasswordHash(stored: string): boolean {
  return String(stored || '').startsWith(`${PREFIX}$`);
}

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(String(plain), salt, KEY_LENGTH, { N, r: R, p: P });
  return [PREFIX, N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

/**
 * 저장값과 입력을 비교한다. 해시가 아닌 저장값은 이전 형식(해시 도입 전 DB)으로 보고 일치 여부와 함께
 * `needsRehash`를 돌려준다. 호출자는 일치했을 때 즉시 해시로 바꿔 저장한다.
 */
export function verifyPassword(stored: string, plain: string): { ok: boolean; needsRehash: boolean } {
  const value = String(stored || '');
  if (!isPasswordHash(value)) {
    const a = Buffer.from(value);
    const b = Buffer.from(String(plain ?? ''));
    const ok = a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
    return { ok, needsRehash: ok };
  }
  const [, n, r, p, saltB64, hashB64] = value.split('$');
  const expected = Buffer.from(hashB64 || '', 'base64');
  if (!expected.length) return { ok: false, needsRehash: false };
  const actual = scryptSync(String(plain ?? ''), Buffer.from(saltB64 || '', 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
  return { ok, needsRehash: ok && (Number(n) !== N || Number(r) !== R || Number(p) !== P) };
}
