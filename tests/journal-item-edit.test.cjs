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

const { DbService } = require('../src/db/db.service.ts');
const { StoreService } = require('../src/api/store.service.ts');

delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;
process.env.SEED_MODE = 'clean';
process.env.APP_TODAY = '2026-07-23';
process.env.LEAD_ID = 'admin';
process.env.LEAD_PW = 'test-only';
process.env.LEAD_NAME = 'Test Lead';

function withStore(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npr-journal-item-edit-'));
  const previousCwd = process.cwd();
  let db;
  try {
    process.chdir(root);
    db = new DbService();
    db.init();
    const store = new StoreService(db);
    db.db.prepare('INSERT INTO journals(date,created_at,special_period) VALUES(?,?,?)')
      .run('2026-07-23', '2026-07-23', 1);
    db.db.prepare('INSERT INTO journal_items(id,date,text,required,sort) VALUES(?,?,?,?,?)')
      .run('ji-edit', '2026-07-23', '수정 전', 1, 7);
    db.db.prepare(
      'INSERT INTO daily_reports(id,teacher,date,status,confirmed,payload,submitted_at) VALUES(?,?,?,?,?,?,?)',
    ).run(
      'report-1', 'Teacher One', '2026-07-23', 'draft', 0,
      JSON.stringify({ cl: { 'ji-edit': { checked: true, report: '기존 보고 유지' } } }), null,
    );
    return fn({ db, store });
  } finally {
    try { db?.db.close(); } catch {}
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('editing a journal item changes only trimmed text and preserves its report key', () => {
  withStore(({ db, store }) => {
    store.updateJournalItemText('ji-edit', '  장기결석 명단 최신화  ');

    const item = db.db.prepare('SELECT id,date,text,required,sort FROM journal_items WHERE id=?')
      .get('ji-edit');
    assert.deepEqual(
      { id: item.id, date: item.date, text: item.text, required: item.required, sort: item.sort },
      { id: 'ji-edit', date: '2026-07-23', text: '장기결석 명단 최신화', required: 1, sort: 7 },
    );

    const report = db.db.prepare('SELECT payload FROM daily_reports WHERE id=?').get('report-1');
    assert.deepEqual(JSON.parse(report.payload), {
      cl: { 'ji-edit': { checked: true, report: '기존 보고 유지' } },
    });
  });
});

test('blank, missing, overlong, and unknown-item edits are rejected without a partial update', () => {
  withStore(({ db, store }) => {
    for (const invalidText of ['', '   ', undefined, '가'.repeat(301)]) {
      assert.throws(
        () => store.updateJournalItemText('ji-edit', invalidText),
        (error) => error && error.status === 400,
      );
    }
    assert.throws(
      () => store.updateJournalItemText('missing-item', '정상 길이'),
      (error) => error && error.status === 400 && /찾을 수 없습니다/.test(error.message),
    );

    const item = db.db.prepare('SELECT id,date,text,required,sort FROM journal_items WHERE id=?')
      .get('ji-edit');
    assert.deepEqual(
      { id: item.id, date: item.date, text: item.text, required: item.required, sort: item.sort },
      { id: 'ji-edit', date: '2026-07-23', text: '수정 전', required: 1, sort: 7 },
    );
  });
});

test('past journal item text and its submitted report stay immutable while future text remains editable', () => {
  withStore(({ db, store }) => {
    db.db.prepare('INSERT INTO journals(date,created_at,special_period) VALUES(?,?,?)')
      .run('2026-07-22', '2026-07-22', 0);
    db.db.prepare('INSERT INTO journal_items(id,date,text,required,sort) VALUES(?,?,?,?,?)')
      .run('ji-past', '2026-07-22', '과거 원문', 1, 0);
    const pastPayload = JSON.stringify({ cl: { 'ji-past': { checked: true, report: '과거 제출 내용' } } });
    db.db.prepare(
      'INSERT INTO daily_reports(id,teacher,date,status,confirmed,payload,submitted_at) VALUES(?,?,?,?,?,?,?)',
    ).run('report-past', 'Teacher One', '2026-07-22', 'submitted', 1, pastPayload, '제출');

    assert.throws(
      () => store.updateJournalItemText('ji-past', '소급 변경 시도'),
      (error) => error && error.status === 400 && /지난 일일보고/.test(error.message),
    );
    assert.equal(
      db.db.prepare('SELECT text FROM journal_items WHERE id=?').get('ji-past').text,
      '과거 원문',
    );
    assert.equal(
      db.db.prepare('SELECT payload FROM daily_reports WHERE id=?').get('report-past').payload,
      pastPayload,
    );

    db.db.prepare('INSERT INTO journals(date,created_at,special_period) VALUES(?,?,?)')
      .run('2026-07-24', '2026-07-23', 0);
    db.db.prepare('INSERT INTO journal_items(id,date,text,required,sort) VALUES(?,?,?,?,?)')
      .run('ji-future', '2026-07-24', '미래 원문', 0, 0);
    store.updateJournalItemText('ji-future', '  미래 수정  ');
    assert.equal(
      db.db.prepare('SELECT text FROM journal_items WHERE id=?').get('ji-future').text,
      '미래 수정',
    );
  });
});

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

async function invoke(role, id = 'ji-edit', text = '수정된 항목') {
  const response = {
    statusCode: 0,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({
    method: 'POST',
    query: { slug: ['journal-items', encodeURIComponent(id), 'edit'] },
    body: { role, tid: role === 'lead' ? 'admin' : 'teacher-1', text },
    headers: {},
  }, response);
  return response;
}

async function invokeJournalMutation(method, slug, role, body = {}) {
  const response = {
    statusCode: 0,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({
    method,
    query: { slug, role, tid: role === 'lead' ? 'admin' : 'teacher-1' },
    // query-bound identity must win over a forged body identity.
    body: { role: 'lead', tid: 'admin', ...body },
    headers: {},
  }, response);
  return response;
}

test('POST /api/journal-items/:id/edit is lead-only and durably folds the updated state', async () => {
  const calls = { edit: [], getState: 0, sync: 0, syncStrict: 0 };
  activeBackend = {
    store: {
      updateJournalItemText(id, text) { calls.edit.push({ id, text }); },
      getState() { calls.getState += 1; return { marker: 'updated' }; },
    },
    ttt: {},
    specialTtt: {},
    db: {
      sync() { calls.sync += 1; },
      syncStrict() { calls.syncStrict += 1; },
    },
  };

  const denied = await invoke('teacher');
  assert.equal(denied.statusCode, 403);
  assert.match(denied.payload.message, /팀장만/);
  assert.deepEqual(calls.edit, []);

  const allowed = await invoke('lead', 'ji item', '  새 문구  ');
  assert.equal(allowed.statusCode, 201);
  assert.deepEqual(allowed.payload, { ok: true, state: { marker: 'updated' } });
  assert.deepEqual(calls.edit, [{ id: 'ji item', text: '  새 문구  ' }]);
  assert.equal(calls.sync, 0, 'journal item edits must not use best-effort persistence');
  assert.equal(calls.syncStrict, 3, 'denied pre-pull plus allowed pre/post durable sync');
  assert.equal(calls.getState, 1);
});

test('every journal definition mutation rejects a direct teacher request before touching the store', async () => {
  const calls = [];
  activeBackend = {
    store: {
      createJournal(...args) { calls.push(['createJournal', ...args]); },
      deleteJournal(...args) { calls.push(['deleteJournal', ...args]); },
      addJournalItem(...args) { calls.push(['addJournalItem', ...args]); },
      removeJournalItem(...args) { calls.push(['removeJournalItem', ...args]); },
      toggleJournalItemReq(...args) { calls.push(['toggleJournalItemReq', ...args]); },
      updateJournalItemText(...args) { calls.push(['updateJournalItemText', ...args]); },
      getState() { return { marker: 'unexpected' }; },
    },
    ttt: {},
    specialTtt: {},
    db: { sync() {}, syncStrict() {} },
  };

  const requests = [
    ['POST', ['journals'], { date: '2026-07-24' }],
    ['DELETE', ['journals', '2026-07-24'], {}],
    ['POST', ['journals', '2026-07-24', 'items'], { text: '항목', required: false }],
    ['DELETE', ['journal-items', 'ji-edit'], {}],
    ['POST', ['journal-items', 'ji-edit', 'toggle-req'], {}],
    ['POST', ['journal-items', 'ji-edit', 'edit'], { text: '변경' }],
  ];
  for (const [method, slug, body] of requests) {
    const denied = await invokeJournalMutation(method, slug, 'teacher', body);
    assert.equal(denied.statusCode, 403, `${method} /api/${slug.join('/')} must be lead-only`);
    assert.match(denied.payload.message, /팀장만/);
  }
  assert.deepEqual(calls, []);
});
