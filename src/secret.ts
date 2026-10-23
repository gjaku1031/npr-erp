import { randomBytes } from 'crypto';

/**
 * 서버 비밀값(APP_SECRET).
 *
 * 강사별 외부 ERP 비밀번호 암호화 키와 반 목록 확인 정보의 서명 키를 이 값에서 만든다.
 * 운영(NODE_ENV=production)에서는 반드시 지정해야 하고, 없으면 기동하지 않는다.
 * 개발·테스트에서 비어 있으면 프로세스마다 임의 키를 만든다. 이 경우 재시작하면 저장된 ERP 비밀번호를 복호화할 수 없다.
 */
let developmentSecret: string | null = null;

export function appSecret(): string {
  const configured = String(process.env.APP_SECRET || '').trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_SECRET 환경변수가 필요합니다.');
  }
  if (!developmentSecret) {
    developmentSecret = randomBytes(32).toString('hex');
    console.warn('[secret] APP_SECRET이 없어 이 프로세스 전용 임의 키를 사용합니다.');
  }
  return developmentSecret;
}
