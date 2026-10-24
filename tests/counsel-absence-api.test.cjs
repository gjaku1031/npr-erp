const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
  });
  module._compile(outputText, filename);
};

delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;
process.env.SEED_MODE = 'clean';
process.env.APP_TODAY = '2026-07-23';
process.env.LEAD_ID = 'admin';
process.env.LEAD_PW = 'test-only';
process.env.LEAD_NAME = 'Test Lead';

const { DbService } = require('../src/db/db.service.ts');
const { StoreService } = require('../src/api/store.service.ts');

const handlerPath = path.resolve(__dirname, '../pages/api/[[...slug]].ts');
let activeBackend;

class MockHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
class MockTttSpecialError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
class MockTttCounselWriteIndeterminateError extends Error {
  constructor(message, beforeCount = 0, writeDate = '') {
    super(message);
    this.beforeCount = beforeCount;
    this.writeDate = writeDate;
  }
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
      TttSpecialError: MockTttSpecialError,
    },
    '@/src/ttt/ttt.records': {
      TttCounselWriteIndeterminateError: MockTttCounselWriteIndeterminateError,
    },
    '@/src/api/external-write-sync': {
      persistConfirmedExternalWrite(sync) {
        try { sync(); return 'synced'; } catch { return 'pending'; }
      },
    },
    '@/src/ttt/regular-class-sync': {
      resolveRegularClassAssignments: () => ({
        assignments: [], unclaimedClasses: [], ambiguousClasses: [], retainedByCurrentOwner: [],
        uniquelyClaimedClassCount: 0, matchedTeacherCount: 0, canApply: false,
      }),
    },
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

function responseHarness() {
  return {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npr-counsel-absence-api-'));
  const previousCwd = process.cwd();
  let db;
  try {
    process.chdir(root);
    db = new DbService();
    db.init();
  } finally {
    process.chdir(previousCwd);
  }
  const store = new StoreService(db);
  store.createTeacher('Teacher One', 'teacher-1', 'pw');
  db.run('UPDATE teachers SET classes=? WHERE tid=?', JSON.stringify({
    '월수금반': ['Class One'], '화목토반': [], '특강 월수금반': [], '특강 화목토반': [],
  }), 'teacher-1');
  const taskId = store.createTask({
    title: 'Counsel Task', descr: '', tag: '상담', start: '2026-07-23', due: '2026-07-31',
    all: true, pick: [], links: [], reportReq: true, attachReq: true, mt: false,
  }, 'lead:admin');
  db.run(
    `INSERT INTO counsel_entries(
       id,task_id,teacher,teacher_tid,cls,class_code,scode,student,phone,subject,content,
       synced,synced_at,roster_active,roster_source_month,roster_seen_at,roster_removed_at
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,'',1,?,?,'')`,
    'entry-1', taskId, 'Teacher One', 'teacher-1', 'Class One', 'class-1',
    'S1', 'Student One', '', '', '', '2026-07', '2026-07-23T00:00:00.000Z',
  );
  const calls = { write: 0, args: null };
  const ttt = {
    async getRoster() {
      throw new Error('출결 기반 로스터 fallback은 호출하면 안 됩니다.');
    },
    async writeCounsel(args, creds, options) {
      calls.write += 1;
      calls.args = args;
      await options.onBeforePost({ beforeCount: 0, writeDate: args.date });
      return {
        ok: true,
        verified: true,
        verification: 'read-after-write-count-increased',
        beforeCount: 0,
        afterCount: 1,
        writeDate: args.date,
      };
    },
  };
  activeBackend = {
    store,
    ttt,
    specialTtt: {
      getStudentMotherPhones: async () => ({
        phones: [{ studentCode: 'S1', motherPhone: '' }], failures: [],
      }),
    },
    db,
  };
  return {
    db, store, taskId, calls,
    close() {
      try { db.db.close(); } catch {}
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

async function invoke(taskId, bodyPatch = {}) {
  const response = responseHarness();
  await handler({
    method: 'POST',
    query: { slug: ['counsel', 'entry', 'entry-1', 'absence'] },
    body: {
      role: 'teacher', tid: 'teacher-1', taskId,
      cls: 'Class One', scode: 'S1', content: '전화 부재로 문자 안내',
      date: '2026-07-23', requestId: 'absence-api-request-0001',
      ...bodyPatch,
    },
    headers: {},
  }, response);
  return response;
}

async function invokeRosterSync(taskId, responseMode) {
  const response = responseHarness();
  await handler({
    method: 'POST',
    query: { slug: ['counsel', taskId, 'sync-roster'] },
    body: {
      role: 'teacher', tid: 'teacher-1', teacher: 'Teacher One', cls: 'Class One',
      date: '2026-07-23', responseMode,
    },
    headers: {},
  }, response);
  return response;
}

async function invokeAbsenceReconcile(attemptId) {
  const response = responseHarness();
  await handler({
    method: 'POST',
    query: { slug: ['counsel', 'absence', attemptId, 'reconcile'] },
    body: { role: 'teacher', tid: 'teacher-1' },
    headers: {},
  }, response);
  return response;
}

async function invokeLeadRead(taskId) {
  const response = responseHarness();
  await handler({
    method: 'GET',
    query: { slug: ['counsel', taskId], role: 'lead', tid: 'admin', teacher: 'Teacher One' },
    body: {},
    headers: {},
  }, response);
  return response;
}

test('absence/text API writes the verified ERP kind once and deduplicates a retried request', async () => {
  const harness = createHarness();
  try {
    const first = await invoke(harness.taskId);
    assert.equal(first.statusCode, 201);
    assert.equal(first.payload.attempt.deliveryConfirmed, true);
    assert.equal(first.payload.entries[0].absenceCount, 1);
    assert.equal(harness.calls.write, 1);
    assert.equal(harness.calls.args.kind, 'absence-text');
    assert.equal(harness.calls.args.subject, '부재/문자');

    const retry = await invoke(harness.taskId);
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.payload.attempt.id, first.payload.attempt.id);
    assert.equal(harness.calls.write, 1, 'same requestId must never repeat the ERP POST');
    assert.equal(harness.db.get('SELECT COUNT(*) count FROM counsel_absence_attempts').count, 1);

    const changed = await invoke(harness.taskId, { content: '다른 내용' });
    assert.equal(changed.statusCode, 409);
    assert.equal(harness.calls.write, 1);
  } finally {
    harness.close();
  }
});

test('absence response entries are read from the primary snapshot instead of the embedded replica', async () => {
  const harness = createHarness();
  const primarySnapshot = harness.store.getCounselSnapshotOnPrimary.bind(harness.store);
  let primaryReads = 0;
  harness.store.getCounselSnapshotOnPrimary = (...args) => {
    primaryReads += 1;
    return primarySnapshot(...args);
  };
  harness.store.getCounselEntries = () => {
    throw new Error('stale embedded replica must not build an absence response');
  };
  try {
    const response = await invoke(harness.taskId, { requestId: 'absence-api-primary-0001' });
    assert.equal(response.statusCode, 201);
    assert.equal(response.payload.entries[0].absenceCount, 1);
    assert.equal(response.payload.entries[0].absencePendingCount, 0);
    assert.equal(primaryReads, 1);
  } finally {
    harness.close();
  }
});

test('lead can read counsel status but cannot create an absence/text record', async () => {
  const harness = createHarness();
  try {
    const readable = await invokeLeadRead(harness.taskId);
    assert.equal(readable.statusCode, 200);
    assert.equal(readable.payload.entries.length, 1);
    assert.equal(readable.payload.entries[0].student, 'Student One');
    const denied = await invoke(harness.taskId, { role: 'lead', tid: 'admin', teacher: 'Teacher One' });
    assert.equal(denied.statusCode, 403);
    const deniedReconcile = responseHarness();
    await handler({
      method: 'POST',
      query: { slug: ['counsel', 'absence', 'not-found', 'reconcile'] },
      body: { role: 'lead', tid: 'admin' },
      headers: {},
    }, deniedReconcile);
    assert.equal(deniedReconcile.statusCode, 403);
    assert.match(deniedReconcile.payload.message, /읽기 전용/);
    assert.equal(harness.calls.write, 0);
    assert.equal(harness.db.get('SELECT COUNT(*) count FROM counsel_absence_attempts').count, 0);
  } finally {
    harness.close();
  }
});

test('absence reconcile rejects a same-name parent entry with a blank or different teacher tid', async () => {
  const harness = createHarness();
  try {
    harness.db.run(
      `INSERT INTO counsel_absence_attempts(
         id,entry_id,task_id,teacher,cls,scode,student,content,attempted_date,
         delivery_state,delivery_stage,delivery_fingerprint,created_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      'absence-parent-access', 'entry-1', harness.taskId, 'Teacher One', 'Class One', 'S1', 'Student One',
      'Pending absence', '2026-07-23', 'pending', 'posting', 'absence-parent-access-fingerprint',
      '2026-07-23T00:00:00.000Z',
    );

    for (const teacherTid of ['', 'teacher-other']) {
      harness.db.run('UPDATE counsel_entries SET teacher_tid=? WHERE id=?', teacherTid, 'entry-1');
      const denied = await invokeAbsenceReconcile('absence-parent-access');
      assert.equal(denied.statusCode, 403);
      assert.match(denied.payload.message, /다른 강사/);
    }
    assert.equal(harness.calls.write, 0);
  } finally {
    harness.close();
  }
});

test('direct-primary roster contact responses never fold stale embedded state', async () => {
  const harness = createHarness();
  try {
    const delta = await invokeRosterSync(harness.taskId, 'delta');
    assert.equal(delta.statusCode, 201);
    assert.equal(Object.prototype.hasOwnProperty.call(delta.payload, 'state'), false);
    assert.equal(delta.payload.entries.length, 1);

    const full = await invokeRosterSync(harness.taskId, 'full');
    assert.equal(full.statusCode, 201);
    assert.equal(Object.prototype.hasOwnProperty.call(full.payload, 'state'), false);
    assert.equal(full.payload.entries.length, 1);
  } finally {
    harness.close();
  }
});
