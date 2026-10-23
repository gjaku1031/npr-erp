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

async function invoke({ slug, role = 'lead', tid = 'admin', query = {}, method = 'GET', body = {} }) {
  const response = {
    statusCode: 0,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  const authQuery = role && tid ? { role, tid } : {};
  await handler({
    method,
    query: { slug, ...authQuery, ...query },
    body,
    headers: {},
  }, response);
  return response;
}

test('counsel GET reads the authorized primary snapshot without a replica pull or false task-not-found', async () => {
  const calls = { snapshot: 0, strict: 0 };
  activeBackend = {
    store: {
      resolveTeacherName() { return 'Own Teacher'; },
      getCounselSnapshotOnPrimary(taskId, teacher, cls) {
        calls.snapshot += 1;
        assert.equal(taskId, 'primary-only-task');
        assert.equal(teacher, 'Own Teacher');
        assert.equal(cls, undefined);
        return {
          kind: 'special', sourceMonth: '2026-07', classes: ['Primary Class'],
          entries: [{ id: 'entry-1', student: 'Primary Student', phone: '010-1111-1111' }],
        };
      },
    },
    ttt: {},
    specialTtt: {},
    db: {
      sync() { throw new Error('best-effort pull must not run'); },
      syncStrict() { calls.strict += 1; throw new Error('replica pull unavailable'); },
    },
  };

  const response = await invoke({
    slug: ['counsel', 'primary-only-task'],
    role: 'teacher',
    tid: 'teacher-1',
    query: { teacher: 'Own%20Teacher' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.kind, 'special');
  assert.equal(response.payload.entries[0].student, 'Primary Student');
  assert.equal(calls.snapshot, 1);
  assert.equal(calls.strict, 0);
});

test('counsel GET preserves teacher ownership before calling the primary snapshot', async () => {
  let snapshotCalls = 0;
  activeBackend = {
    store: {
      resolveTeacherName() { return 'Own Teacher'; },
      getCounselSnapshotOnPrimary() { snapshotCalls += 1; return {}; },
    },
    ttt: {}, specialTtt: {},
    db: { sync() {}, syncStrict() {} },
  };

  const response = await invoke({
    slug: ['counsel', 'primary-only-task'],
    role: 'teacher',
    tid: 'teacher-1',
    query: { teacher: 'Other%20Teacher' },
  });

  assert.equal(response.statusCode, 403);
  assert.match(response.payload.message, /다른 강사/);
  assert.equal(snapshotCalls, 0);
});

test('login strictly pulls the latest teacher replica before checking credentials', async () => {
  const order = [];
  activeBackend = {
    store: {
      login(id, pw) {
        order.push('login');
        assert.deepEqual([id, pw], ['other-user', '1234']);
        return {
          role: 'other', tid: id, name: 'Other User',
          canLead: false, isTeacher: false, canOtherTeam: true,
        };
      },
    },
    ttt: {}, specialTtt: {},
    db: {
      sync() { throw new Error('best-effort pull must not run'); },
      syncStrict() { order.push('strict-pull'); },
    },
  };

  const response = await invoke({
    slug: ['login'], role: null, tid: null, method: 'POST',
    body: { id: 'other-user', pw: '1234' },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.role, 'other');
  assert.deepEqual(order, ['strict-pull', 'login']);
});

test('login fails closed without checking a stale teacher replica when the pull fails', async () => {
  let loginCalls = 0;
  activeBackend = {
    store: { login() { loginCalls += 1; throw new Error('stale login must not run'); } },
    ttt: {}, specialTtt: {},
    db: {
      sync() { throw new Error('best-effort pull must not run'); },
      syncStrict() { throw new Error('replica pull unavailable'); },
    },
  };

  const response = await invoke({
    slug: ['login'], role: null, tid: null, method: 'POST',
    body: { id: 'other-user', pw: '1234' },
  });

  assert.equal(response.statusCode, 500);
  assert.equal(loginCalls, 0);
  assert.doesNotMatch(response.payload.message, /등록된 계정을 찾을 수 없습니다/);
});

test('state and report GETs fail closed when the strict replica pull fails', async () => {
  for (const scenario of [
    { slug: ['state'], forbiddenMethod: 'getState' },
    { slug: ['reports', 'Own%20Teacher', '2026-07-23'], forbiddenMethod: 'getReport' },
  ]) {
    const calls = { strict: 0, route: 0 };
    activeBackend = {
      store: {
        [scenario.forbiddenMethod]() { calls.route += 1; throw new MockHttpError(400, '업무를 찾을 수 없습니다.'); },
      },
      ttt: {}, specialTtt: {},
      db: {
        sync() { throw new Error('best-effort pull must not run'); },
        syncStrict() { calls.strict += 1; throw new Error('replica pull unavailable'); },
      },
    };

    const response = await invoke({ slug: scenario.slug });
    assert.equal(response.statusCode, 500);
    assert.equal(calls.strict, 1);
    assert.equal(calls.route, 0, `${scenario.forbiddenMethod} must not serve a stale replica after pull failure`);
    assert.doesNotMatch(response.payload.message, /업무를 찾을 수 없습니다/);
  }
});
