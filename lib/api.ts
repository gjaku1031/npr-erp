// API 클라이언트 — 기본 28초, ERP 장기 조회만 별도 타임아웃 + 친절한 오류 메시지

// 로그인/부트 시 현재 뷰(role/tid) 기록 → 변경 요청에 실어 서버가 응답에 최신 상태를 fold 하게 함(왕복 1회 절약).
let authCtx: { role: string; tid: string } | null = null;
export function setAuthCtx(role: string, tid: string) { authCtx = { role, tid }; }

function withAuth(path: string): string {
  // 기존 역할 기반 요청 컨텍스트를 조회에도 실어 상담/연락처 API가 현재 강사 본인으로 바인딩할 수 있게 한다.
  if (authCtx) {
    const params: string[] = [];
    if (!/[?&]role=/.test(path)) params.push(`role=${encodeURIComponent(authCtx.role)}`);
    if (!/[?&]tid=/.test(path)) params.push(`tid=${encodeURIComponent(authCtx.tid)}`);
    if (params.length) path = `${path}${path.includes('?') ? '&' : '?'}${params.join('&')}`;
  }
  return path;
}

function isLongErpRequest(path: string, body?: any): boolean {
  return /^\/api\/special-classes\/sync(?:\?|$)/.test(path)
    || /^\/api\/regular-classes\/sync(?:\?|$)/.test(path)
    || /^\/api\/regular-classes\/quarter-start(?:\?|$)/.test(path)
    || /^\/api\/other-team\/classes\/sync(?:\?|$)/.test(path)
    || /^\/api\/class-management\/(?:catalog|apply)(?:\?|$)/.test(path)
    || /^\/api\/class-management\/student-details(?:\?|$)/.test(path)
    || /^\/api\/counsel\/[^/?]+\/sync-roster(?:\?|$)/.test(path)
    || /^\/api\/counsel\/entry\/[^/?]+\/write(?:\?|$)/.test(path)
    || /^\/api\/counsel\/entry\/[^/?]+\/reconcile(?:\?|$)/.test(path)
    || /^\/api\/counsel\/entry\/[^/?]+\/absence(?:\?|$)/.test(path)
    || /^\/api\/counsel\/absence\/[^/?]+\/reconcile(?:\?|$)/.test(path)
    || /^\/api\/utility\/weekly-ppt(?:\?|$)/.test(path)
    // 특강상담 생성은 월간 로스터 전체를 스냅샷하고 Turso에 동기화하므로 일반 28초 요청으로 취급하지 않는다.
    || ((body?.specialCounsel === true || String(body?.tag || '').trim() === '특강 상담')
      && /^\/api\/tasks(?:\/[^/?]+\/edit)?(?:\?|$)/.test(path));
}

function filenameFromDisposition(value: string | null): string {
  if (!value) return 'weekly-test.pptx';
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* fall through */ }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] || 'weekly-test.pptx';
}

export async function req(method: string, path: string, body?: any): Promise<any> {
  path = withAuth(path);
  const opt: any = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const ctrl = new AbortController();
  // 서버의 120초 상한보다 조금 더 기다려 서버가 만든 명확한 실패 응답을 먼저 받는다.
  const timer = setTimeout(() => ctrl.abort(), isLongErpRequest(path, body) ? 125000 : 28000);
  opt.signal = ctrl.signal;
  let res: Response;
  try {
    res = await fetch(path, opt);
  } catch (e: any) {
    clearTimeout(timer);
    if (e && e.name === 'AbortError') throw new Error('응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.');
    throw new Error('네트워크 연결을 확인해 주세요.');
  }
  clearTimeout(timer);
  const txt = await res.text();
  let data: any = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = (data && data.message)
      || (res.status >= 500 ? '서버가 일시적으로 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.' : (res.statusText || '요청을 처리하지 못했습니다.'));
    throw new Error(msg);
  }
  return data;
}

export async function postBlob(path: string, body: any): Promise<{
  blob: Blob;
  filename: string;
  headers: Headers;
}> {
  path = withAuth(path);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), isLongErpRequest(path) ? 125000 : 28000);
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (error: any) {
    clearTimeout(timer);
    if (error?.name === 'AbortError') throw new Error('파일 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.');
    throw new Error('네트워크 연결을 확인해 주세요.');
  }
  clearTimeout(timer);
  if (!res.ok) {
    let message = res.status >= 500
      ? '서버가 일시적으로 응답하지 못했습니다. 잠시 후 다시 시도해 주세요.'
      : '요청을 처리하지 못했습니다.';
    try {
      const data = await res.json();
      if (data?.message) message = data.message;
    } catch { /* keep default */ }
    throw new Error(message);
  }
  return {
    blob: await res.blob(),
    filename: filenameFromDisposition(res.headers.get('Content-Disposition')),
    headers: res.headers,
  };
}

export const api = {
  get: (p: string) => req('GET', p),
  post: (p: string, b?: any) => req('POST', p, b || {}),
  postBlob,
  del: (p: string) => req('DELETE', p),
};
