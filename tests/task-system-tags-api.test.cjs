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
      summarizeSpecialMotherPhoneBatch: () => ({}),
      TttSpecialError: class extends Error {},
    },
    '@/src/ttt/ttt.records': { TttCounselWriteIndeterminateError: class extends Error {} },
    '@/src/api/external-write-sync': { persistConfirmedExternalWrite: (sync) => { sync(); return 'synced'; } },
    '@/src/ttt/regular-class-sync': { resolveRegularClassAssignments: () => ({}) },
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

function createBackend() {
  const calls = { create: 0, createSpecial: 0, update: 0, getState: 0, sync: 0, syncStrict: 0 };
  return {
    calls,
    backend: {
      store: {
        createTask() { calls.create += 1; return 'task-id'; },
        createSpecialCounselTaskOnPrimary() {
          calls.createSpecial += 1;
          return {
            id: 'special-task-id',
            created: true,
            rosterCount: 270,
            task: {
              id: 'special-task-id',
              title: 'Special counsel',
              counselProg: { 'Teacher One': { synced: 0, total: 17, absenceCount: 0, absencePendingCount: 0 } },
            },
          };
        },
        updateTask() { calls.update += 1; },
        getState() { calls.getState += 1; return { marker: 'folded' }; },
      },
      ttt: {}, specialTtt: {},
      db: {
        sync() { calls.sync += 1; },
        syncStrict() { calls.syncStrict += 1; },
      },
    },
  };
}

async function invoke({ role, slug = ['tasks'], body }) {
  const response = {
    statusCode: 0, payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({
    method: 'POST',
    query: { slug },
    body: { role, tid: role === 'lead' ? 'admin' : 'teacher-1', ...body },
    headers: {},
  }, response);
  return response;
}

test('the special-counsel system tag keeps lead-only API authorization even without a legacy toggle', async () => {
  const harness = createBackend();
  activeBackend = harness.backend;

  const deniedCreate = await invoke({ role: 'teacher', body: { tag: '특강 상담', specialCounsel: false } });
  assert.equal(deniedCreate.statusCode, 403);
  assert.match(deniedCreate.payload.message, /팀장만/);
  assert.equal(harness.calls.create, 0);

  const deniedEdit = await invoke({
    role: 'teacher', slug: ['tasks', 'task-id', 'edit'], body: { tag: ' 특강 상담 ', specialCounsel: false },
  });
  assert.equal(deniedEdit.statusCode, 403);
  assert.equal(harness.calls.update, 0);

  const beforeAllowed = {
    getState: harness.calls.getState,
    sync: harness.calls.sync,
    syncStrict: harness.calls.syncStrict,
  };

  const allowed = await invoke({ role: 'lead', body: { tag: '특강 상담', specialCounsel: false } });
  assert.equal(allowed.statusCode, 201);
  assert.deepEqual(allowed.payload, {
    id: 'special-task-id',
    created: true,
    rosterCount: 270,
    task: {
      id: 'special-task-id',
      title: 'Special counsel',
      counselProg: { 'Teacher One': { synced: 0, total: 17, absenceCount: 0, absencePendingCount: 0 } },
    },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(allowed.payload, 'state'), false);
  assert.equal(harness.calls.create, 0);
  assert.equal(harness.calls.createSpecial, 1);
  assert.equal(harness.calls.getState, beforeAllowed.getState, 'the primary task delta must not fold a stale replica state');
  assert.equal(harness.calls.sync, beforeAllowed.sync, 'the primary transaction is already durable and must not sync the replica afterward');
  assert.equal(harness.calls.syncStrict, beforeAllowed.syncStrict, 'the special create path must skip both replica pulls and pushes');
});
