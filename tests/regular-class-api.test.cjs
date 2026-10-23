const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const handlerPath = path.resolve(__dirname, '../pages/api/[[...slug]].ts');
let activeBackend;

class MockHttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function loadHandler() {
  const source = fs.readFileSync(handlerPath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: handlerPath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
  });
  const mocks = {
    '@/src/backend': { backend: () => activeBackend },
    // 라우트 규칙 테스트는 인증을 대신해 요청의 role·tid를 행위자로 쓴다. 실제 인증은 auth-session.test.cjs가 검증한다.
    '@/src/auth': { resolveActor: (req) => { const pick = (v) => String(Array.isArray(v) ? v[0] ?? '' : v ?? '').trim(); const q = req.query || {}; const b = req.body && typeof req.body === 'object' ? req.body : {}; const role = pick(q.role) || pick(b.role); const tid = pick(q.tid) || pick(b.tid); return ['lead', 'teacher', 'other'].includes(role) && tid ? { role, tid } : null; }, assertSameOrigin: () => {}, issueSessionCookie: () => 'npr_session=test', clearSessionCookie: () => 'npr_session=', loginThrottle: { key: () => 'test', assertAllowed() {}, recordFailure() {}, reset() {} } },
    '@/src/secret': { appSecret: () => 'test-only-secret' },
    '@/src/http-error': { HttpError: MockHttpError },
    '@/src/ttt/ttt.special': {
      createOwnedClassProofScope: () => ({ fingerprint: '', slots: {} }),
      createRegularClassProofScope: () => ({ fingerprint: '', slots: {} }),
      summarizeSpecialMotherPhoneBatch: () => ({}),
      TttSpecialError: class extends Error {},
    },
    '@/src/ttt/ttt.records': { TttCounselWriteIndeterminateError: class extends Error {} },
    '@/src/api/external-write-sync': { persistConfirmedExternalWrite: (sync) => { sync(); return 'synced'; } },
    '@/src/ttt/regular-class-sync': { resolveRegularClassAssignments: () => { throw new Error('legacy resolver must not run'); } },
  };
  const originalLoad = Module._load;
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const compiled = new Module(handlerPath, module);
    compiled.filename = handlerPath;
    compiled.paths = Module._nodeModulePaths(path.dirname(handlerPath));
    compiled._compile(outputText, handlerPath);
    return compiled.exports.default;
  } finally {
    Module._load = originalLoad;
  }
}

const handler = loadHandler();

async function invoke(slug) {
  const response = {
    statusCode: 0,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({
    method: 'POST',
    query: { slug, role: 'lead', tid: 'admin' },
    body: { role: 'lead', tid: 'admin', targetDate: '2026-09-05' },
    headers: {},
  }, response);
  return response;
}

test('every legacy automatic or direct class mutation is retired before DB or ERP access', async () => {
  const calls = { strict: 0, sync: 0, lease: 0 };
  activeBackend = {
    store: {
      acquireTeacherClassMutationLease() { calls.lease += 1; throw new Error('lease must not be acquired'); },
    },
    ttt: new Proxy({}, { get() { throw new Error('TTT must not be read'); } }),
    specialTtt: new Proxy({}, { get() { throw new Error('TTT must not be read'); } }),
    db: {
      sync() { calls.sync += 1; },
      syncStrict() { calls.strict += 1; },
    },
  };

  const routes = [
    ['regular-classes', 'sync'],
    ['regular-classes', 'quarter-start'],
    ['special-classes', 'sync'],
    ['other-team', 'classes', 'sync'],
    ['teachers', 'teacher-1', 'classes'],
  ];
  for (const slug of routes) {
    const response = await invoke(slug);
    assert.equal(response.statusCode, 410, slug.join('/'));
    assert.match(response.payload.message, /기존 자동 반 동기화는 종료/);
  }
  assert.deepEqual(calls, { strict: 0, sync: 0, lease: 0 });
});
