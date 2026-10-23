import * as crypto from 'crypto';
import { appSecret } from '../secret';

/**
 * 강사별 외부 ERP 비밀번호 저장용 대칭 암호화(AES-256-GCM).
 * 키는 APP_SECRET에서 파생한다. 키를 바꾸면 기존에 저장한 비밀번호를 복호화할 수 없다.
 */
function key(): Buffer {
  return crypto.createHash('sha256').update(appSecret()).digest();
}

export function encrypt(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decrypt(payload: string): string {
  if (!payload) return '';
  try {
    const [ivB, tagB, encB] = payload.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
    d.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([d.update(Buffer.from(encB, 'base64')), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}
