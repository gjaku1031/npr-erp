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
 * 저장된 해시와 입력을 비교한다. scrypt 해시가 아닌 저장값은 맞지 않는 것으로 본다. 해시를 만든 강도 매개변수(N·r·p)가
 * 지금 값과 다르면 `needsRehash`를 함께 돌려주고, 호출자는 비밀번호가 맞았을 때 지금 매개변수로 다시 해시해 저장한다.
 */
export function verifyPassword(stored: string, plain: string): { ok: boolean; needsRehash: boolean } {
  const value = String(stored || '');
  if (!isPasswordHash(value)) return { ok: false, needsRehash: false };
  const [, n, r, p, saltB64, hashB64] = value.split('$');
  const expected = Buffer.from(hashB64 || '', 'base64');
  if (!expected.length) return { ok: false, needsRehash: false };
  const actual = scryptSync(String(plain ?? ''), Buffer.from(saltB64 || '', 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
  return { ok, needsRehash: ok && (Number(n) !== N || Number(r) !== R || Number(p) !== P) };
}
