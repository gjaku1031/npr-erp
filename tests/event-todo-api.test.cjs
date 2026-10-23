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

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npr-event-todo-'));
  const previousCwd = process.cwd();
  let db;
  try {
    process.chdir(root);
    db = new DbService();
    db.init();
  } finally {
    process.chdir(previousCwd);
  }
  const insertTeacher = (tid, name, isLead = false) => {
    db.db.prepare(
      `INSERT INTO teachers(tid,name,pw,classes,is_lead,sort)
       VALUES(?,?,?,? ,?,(SELECT COALESCE(MAX(sort),0)+1 FROM teachers))`,
    ).run(tid, name, '1234', '{"월수금반":[],"화목토반":[],"특강 월수금반":[],"특강 화목토반":[]}', isLead ? 1 : 0);
  };
  insertTeacher('teacher-1', 'Teacher One');
  insertTeacher('teacher-2', 'Teacher Two');
  insertTeacher('lead-a', 'Promoted Lead A', true);
  insertTeacher('lead-b', 'Promoted Lead B', true);
  const insert = (id, owner, type = 'personal') => {
    db.db.prepare(
      'INSERT INTO events(id,owner,type,tag,title,descr,start_date,end_date) VALUES(?,?,?,?,?,?,?,?)',
    ).run(
      id,
      owner,
      type,
      type === 'team_event' ? '일정' : '개인일정',
      `${id} title`,
      `${id} original`,
      '2026-07-23',
      '2026-07-24',
    );
  };
  return {
    db,
    store: new StoreService(db),
    insert,
    insertTeacher,
    row(id) {
      const value = db.db.prepare('SELECT * FROM events WHERE id=?').get(id);
      if (!value) return value;
      const { _metadata, ...event } = value;
      return event;
    },
    close() {
      try { db.db.close(); } catch {}
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function expectHttpError(operation, status, pattern) {
  assert.throws(operation, (error) => {
    assert.equal(error.status, status);
    assert.match(error.message, pattern);
    return true;
  });
}

test('personal event todo updates only descr for the exact owner', () => {
  const h = createHarness();
  try {
    h.insert('teacher-own', 'teacher-1');
    h.insert('lead-own', 'lead');
    const teacherBefore = h.row('teacher-own');
    const leadBefore = h.row('lead-own');

    h.store.updateEventTodo('teacher-own', '[x] 전화\n[ ] 문자', 'teacher-1', 'teacher');
    h.store.updateEventTodo('lead-own', '[x] 팀장 할 일', 'admin', 'lead');

    assert.deepEqual(h.row('teacher-own'), {
      ...teacherBefore,
      descr: '[x] 전화\n[ ] 문자',
    });
    assert.deepEqual(h.row('lead-own'), {
      ...leadBefore,
      descr: '[x] 팀장 할 일',
    });
  } finally {
    h.close();
  }
});

test('todo rejects cross-owner, cross-role, team, invalid, and missing events without mutation', () => {
  const h = createHarness();
  try {
    h.insert('teacher-one', 'teacher-1');
    h.insert('teacher-two', 'teacher-2');
    h.insert('lead-own', 'lead');
    h.insert('team-one', 'team', 'team_event');
    const before = Object.fromEntries(
      ['teacher-one', 'teacher-two', 'lead-own', 'team-one'].map((id) => [id, h.row(id)]),
    );

    expectHttpError(
      () => h.store.updateEventTodo('teacher-two', '[x] stolen', 'teacher-1', 'teacher'),
      403,
      /본인/,
    );
    expectHttpError(
      () => h.store.updateEventTodo('teacher-one', '[x] lead override', 'admin', 'lead'),
      403,
      /본인/,
    );
    expectHttpError(
      () => h.store.updateEventTodo('lead-own', '[x] teacher override', 'teacher-1', 'teacher'),
      403,
      /다른 사용자/,
    );
    expectHttpError(
      () => h.store.updateEventTodo('team-one', '[x] team', 'admin', 'lead'),
      403,
      /개인일정/,
    );
    expectHttpError(
      () => h.store.updateEventTodo('teacher-one', null, 'teacher-1', 'teacher'),
      400,
      /내용/,
    );
    expectHttpError(
      () => h.store.updateEventTodo('missing', '[x] missing', 'teacher-1', 'teacher'),
      404,
      /찾을 수 없습니다/,
    );

    for (const [id, snapshot] of Object.entries(before)) assert.deepEqual(h.row(id), snapshot);
  } finally {
    h.close();
  }
});

test('event edit and delete enforce ownership while preserving lead team-event management', () => {
  const h = createHarness();
  try {
    h.insert('teacher-own', 'teacher-1');
    h.insert('teacher-other', 'teacher-2');
    h.insert('lead-own', 'lead');
    h.insert('team-edit', 'team', 'team_event');
    h.insert('team-delete', 'team', 'team_event');

    h.store.updateEvent('teacher-own', {
      title: '내 수정', descr: '내 메모', start: '2026-07-25', end: '2026-07-26', mode: 'team', tag: '',
    }, 'teacher-1', 'teacher');
    assert.deepEqual(
      Object.fromEntries(Object.entries(h.row('teacher-own')).filter(([key]) => ['owner', 'type', 'tag', 'title'].includes(key))),
      { owner: 'teacher-1', type: 'personal', tag: '개인일정', title: '내 수정' },
    );

    const otherBefore = h.row('teacher-other');
    expectHttpError(
      () => h.store.updateEvent('teacher-other', {
        title: '탈취', descr: '탈취', start: '2026-01-01', end: '2026-01-01', tag: '일정',
      }, 'teacher-1', 'teacher'),
      403,
      /본인/,
    );
    expectHttpError(() => h.store.deleteEvent('teacher-other', 'admin', 'lead'), 403, /본인/);
    expectHttpError(() => h.store.deleteEvent('lead-own', 'teacher-1', 'teacher'), 403, /다른 사용자/);
    expectHttpError(() => h.store.deleteEvent('team-delete', 'teacher-1', 'teacher'), 403, /팀 일정/);
    assert.deepEqual(h.row('teacher-other'), otherBefore);
    assert.ok(h.row('lead-own'));
    assert.ok(h.row('team-delete'));

    h.store.updateEvent('team-edit', {
      title: '팀 일정 수정', descr: '팀 메모', start: '2026-07-27', end: '2026-07-27', tag: '',
    }, 'admin', 'lead');
    assert.equal(h.row('team-edit').owner, 'team');
    assert.equal(h.row('team-edit').type, 'team_event');
    assert.equal(h.row('team-edit').tag, '일정');
    assert.equal(h.row('team-edit').title, '팀 일정 수정');

    h.store.deleteEvent('team-delete', 'admin', 'lead');
    h.store.deleteEvent('lead-own', 'admin', 'lead');
    assert.equal(h.row('team-delete'), undefined);
    assert.equal(h.row('lead-own'), undefined);
  } finally {
    h.close();
  }
});

test('teacher cannot create a team event through a forged event payload', () => {
  const h = createHarness();
  try {
    const before = h.db.db.prepare('SELECT COUNT(*) count FROM events').get().count;
    expectHttpError(
      () => h.store.createEvent({
        title: '위조 팀 일정', descr: '', start: '2026-07-23', end: '2026-07-23', mode: 'team',
      }, 'teacher-1', 'teacher'),
      403,
      /팀 일정/,
    );
    assert.equal(h.db.db.prepare('SELECT COUNT(*) count FROM events').get().count, before);
  } finally {
    h.close();
  }
});

function eventInput(title, mode = 'personal') {
  return {
    title,
    descr: `${title} memo`,
    start: '2026-07-23',
    end: '2026-07-23',
    mode,
    tag: '',
  };
}

function eventMap(state) {
  return Object.fromEntries(state.events.map((event) => [event.id, event]));
}

test('event creation rejects blank, invalid, impossible, and reversed dates without inserting rows', () => {
  const h = createHarness();
  try {
    const countBefore = h.db.db.prepare('SELECT COUNT(*) count FROM events').get().count;
    const invalidCases = [
      {
        label: 'blank',
        input: { ...eventInput('blank date'), start: '   ', end: '   ' },
        pattern: /날짜 형식/,
      },
      {
        label: 'invalid format',
        input: { ...eventInput('invalid format'), start: '2026-7-23', end: '2026-07-23' },
        pattern: /날짜 형식/,
      },
      {
        label: 'impossible date',
        input: { ...eventInput('impossible date'), start: '2026-02-30', end: '2026-02-30' },
        pattern: /날짜 형식/,
      },
      {
        label: 'reversed range',
        input: { ...eventInput('reversed range'), start: '2026-07-24', end: '2026-07-23' },
        pattern: /종료일/,
      },
    ];

    for (const { label, input, pattern } of invalidCases) {
      expectHttpError(
        () => h.store.createEvent(input, 'teacher-1', 'teacher'),
        400,
        pattern,
      );
      assert.equal(
        h.db.db.prepare('SELECT COUNT(*) count FROM events').get().count,
        countBefore,
        `${label} 입력은 부분 행을 만들지 않는다`,
      );
    }
  } finally {
    h.close();
  }
});

test('event update rejects blank, invalid, impossible, and reversed dates without changing the row', () => {
  const h = createHarness();
  try {
    const id = h.store.createEvent(eventInput('valid event'), 'teacher-1', 'teacher');
    const before = h.row(id);
    const invalidCases = [
      {
        label: 'blank',
        input: { ...eventInput('blank update'), start: '', end: '' },
        pattern: /날짜 형식/,
      },
      {
        label: 'invalid format',
        input: { ...eventInput('invalid update'), start: 'not-a-date', end: '2026-07-23' },
        pattern: /날짜 형식/,
      },
      {
        label: 'impossible date',
        input: { ...eventInput('impossible update'), start: '2026-02-29', end: '2026-02-29' },
        pattern: /날짜 형식/,
      },
      {
        label: 'reversed range',
        input: { ...eventInput('reversed update'), start: '2026-08-01', end: '2026-07-31' },
        pattern: /종료일/,
      },
    ];

    for (const { label, input, pattern } of invalidCases) {
      expectHttpError(
        () => h.store.updateEvent(id, input, 'teacher-1', 'teacher'),
        400,
        pattern,
      );
      assert.deepEqual(h.row(id), before, `${label} 입력은 기존 일정을 변경하지 않는다`);
    }
  } finally {
    h.close();
  }
});

test('master and promoted leads keep separate personal owners and exact state visibility', () => {
  const h = createHarness();
  try {
    h.insert('legacy-master', 'lead');
    const masterPersonal = h.store.createEvent(eventInput('master personal'), 'admin', 'lead');
    const leadAPersonal = h.store.createEvent(eventInput('A lead-mode personal'), 'lead-a', 'lead');
    const teacherAPersonal = h.store.createEvent(eventInput('A teacher-mode personal'), 'lead-a', 'teacher');
    const leadBPersonal = h.store.createEvent(eventInput('B personal'), 'lead-b', 'lead');
    const team = h.store.createEvent(eventInput('team', 'team'), 'lead-a', 'lead');

    assert.equal(h.row(masterPersonal).owner, 'lead', 'master events retain the legacy owner for compatibility');
    assert.equal(h.row(leadAPersonal).owner, 'lead-a');
    assert.equal(h.row(teacherAPersonal).owner, 'lead-a');
    assert.equal(h.row(leadBPersonal).owner, 'lead-b');
    assert.equal(h.row(team).owner, 'team');

    const masterEvents = eventMap(h.store.getState('lead', 'admin'));
    assert.deepEqual(Object.keys(masterEvents).sort(), ['legacy-master', masterPersonal, team].sort());
    assert.equal(masterEvents['legacy-master'].mine, true);
    assert.equal(masterEvents[masterPersonal].mine, true);
    assert.equal(masterEvents[team].mine, true);

    const aLeadEvents = eventMap(h.store.getState('lead', 'lead-a'));
    const aTeacherEvents = eventMap(h.store.getState('teacher', 'lead-a'));
    assert.deepEqual(Object.keys(aLeadEvents).sort(), [leadAPersonal, teacherAPersonal, team].sort());
    assert.deepEqual(Object.keys(aTeacherEvents).sort(), [leadAPersonal, teacherAPersonal, team].sort());
    assert.equal(aLeadEvents[leadAPersonal].mine, true);
    assert.equal(aTeacherEvents[leadAPersonal].mine, true);
    assert.equal(aLeadEvents[team].mine, true);
    assert.equal(aTeacherEvents[team].mine, false);

    const bLeadEvents = eventMap(h.store.getState('lead', 'lead-b'));
    assert.deepEqual(Object.keys(bLeadEvents).sort(), [leadBPersonal, team].sort());
    assert.equal(bLeadEvents[leadBPersonal].mine, true);
    assert.equal(bLeadEvents[team].mine, true);

    expectHttpError(() => h.store.getState('lead', 'teacher-1'), 400, /사용자/);
    expectHttpError(() => h.store.getState('lead', 'unknown-lead'), 400, /사용자/);
  } finally {
    h.close();
  }
});

test('a promoted lead owns the same personal event across teacher and lead modes while all cross-owner mutations fail', () => {
  const h = createHarness();
  try {
    h.insert('legacy-master', 'lead');
    const aFromLead = h.store.createEvent(eventInput('A from lead mode'), 'lead-a', 'lead');
    const aFromTeacher = h.store.createEvent(eventInput('A from teacher mode'), 'lead-a', 'teacher');
    const bFromLead = h.store.createEvent(eventInput('B from lead mode'), 'lead-b', 'lead');

    h.store.updateEventTodo(aFromLead, '[x] teacher mode checked', 'lead-a', 'teacher');
    h.store.updateEvent(aFromTeacher, {
      ...eventInput('A edited in lead mode'),
      start: '2026-07-24',
      end: '2026-07-25',
    }, 'lead-a', 'lead');
    assert.equal(h.row(aFromLead).descr, '[x] teacher mode checked');
    assert.equal(h.row(aFromTeacher).title, 'A edited in lead mode');
    assert.equal(h.row(aFromTeacher).owner, 'lead-a');

    const protectedBefore = {
      aFromLead: h.row(aFromLead),
      bFromLead: h.row(bFromLead),
      legacy: h.row('legacy-master'),
    };
    expectHttpError(
      () => h.store.updateEventTodo(bFromLead, '[x] A tried B', 'lead-a', 'lead'),
      403,
      /본인/,
    );
    expectHttpError(
      () => h.store.updateEvent(aFromLead, eventInput('B tried A'), 'lead-b', 'lead'),
      403,
      /본인/,
    );
    expectHttpError(() => h.store.deleteEvent(aFromLead, 'admin', 'lead'), 403, /본인/);
    expectHttpError(() => h.store.deleteEvent('legacy-master', 'lead-a', 'lead'), 403, /다른 사용자/);
    expectHttpError(() => h.store.updateEventTodo('legacy-master', '[x] no', 'lead-a', 'teacher'), 403, /다른 사용자/);
    assert.deepEqual(h.row(aFromLead), protectedBefore.aFromLead);
    assert.deepEqual(h.row(bFromLead), protectedBefore.bFromLead);
    assert.deepEqual(h.row('legacy-master'), protectedBefore.legacy);

    h.store.deleteEvent(aFromTeacher, 'lead-a', 'teacher');
    assert.equal(h.row(aFromTeacher), undefined);
  } finally {
    h.close();
  }
});

test('event mutations reject invalid role/tid pairs before creating or changing any row', () => {
  const h = createHarness();
  try {
    const owned = h.store.createEvent(eventInput('valid owner'), 'teacher-1', 'teacher');
    const before = h.row(owned);
    const countBefore = h.db.db.prepare('SELECT COUNT(*) count FROM events').get().count;

    for (const [tid, role, pattern] of [
      ['missing-teacher', 'teacher', /강사 계정/],
      ['teacher-1', 'lead', /팀장 계정/],
      ['missing-lead', 'lead', /팀장 계정/],
      ['', 'teacher', /로그인 정보/],
    ]) {
      expectHttpError(() => h.store.createEvent(eventInput('must not exist'), tid, role), 403, pattern);
    }
    expectHttpError(
      () => h.store.updateEvent(owned, eventInput('invalid update'), 'missing-teacher', 'teacher'),
      403,
      /강사 계정/,
    );
    expectHttpError(
      () => h.store.updateEventTodo(owned, '[x] invalid', 'teacher-1', 'lead'),
      403,
      /팀장 계정/,
    );
    expectHttpError(() => h.store.deleteEvent(owned, 'missing-lead', 'lead'), 403, /팀장 계정/);

    assert.equal(h.db.db.prepare('SELECT COUNT(*) count FROM events').get().count, countBefore);
    assert.deepEqual(h.row(owned), before);
  } finally {
    h.close();
  }
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

async function invokeApi(method, slug, body = {}) {
  const response = {
    statusCode: 0,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({
    method,
    query: { slug, role: 'teacher', tid: 'real-teacher' },
    body: { role: 'lead', tid: 'forged-teacher', ...body },
    headers: {},
  }, response);
  return response;
}

test('event routes pass query-bound request context and strictly persist todo changes', async () => {
  const calls = { create: [], edit: [], todo: [], del: [], strict: 0, loose: 0, state: [] };
  activeBackend = {
    store: {
      createEvent(...args) { calls.create.push(args); return 'created-event'; },
      updateEvent(...args) { calls.edit.push(args); },
      updateEventTodo(...args) { calls.todo.push(args); },
      deleteEvent(...args) { calls.del.push(args); },
      getState(...args) { calls.state.push(args); return { marker: 'fresh' }; },
    },
    ttt: {}, specialTtt: {},
    db: {
      syncStrict() { calls.strict += 1; },
      sync() { calls.loose += 1; },
    },
  };

  const created = await invokeApi('POST', ['events'], {
    title: '개인', descr: '', start: '2026-07-23', end: '2026-07-23', mode: 'personal',
  });
  const edited = await invokeApi('POST', ['events', 'event-1', 'edit'], {
    title: '수정', descr: '메모', start: '2026-07-23', end: '2026-07-24', mode: 'personal',
  });
  const todo = await invokeApi('POST', ['events', 'event-1', 'todo'], { descr: '[x] 완료' });
  const deleted = await invokeApi('DELETE', ['events', 'event-1']);

  assert.equal(created.statusCode, 201);
  assert.equal(edited.statusCode, 201);
  assert.equal(todo.statusCode, 201);
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(calls.create[0].slice(1), ['real-teacher', 'teacher']);
  assert.deepEqual(calls.edit[0].slice(2), ['real-teacher', 'teacher']);
  assert.deepEqual(calls.todo[0], ['event-1', '[x] 완료', 'real-teacher', 'teacher']);
  assert.deepEqual(calls.del[0], ['event-1', 'real-teacher', 'teacher']);
  assert.equal(calls.strict, 8, '각 변경은 원격 pull과 push를 엄격하게 완료해야 한다');
  assert.equal(calls.loose, 0);
  assert.deepEqual(calls.state, Array.from({ length: 3 }, () => ['teacher', 'real-teacher']));
  assert.deepEqual(todo.payload, { ok: true, event: { id: 'event-1', descr: '[x] 완료' } });
  assert.equal(Object.prototype.hasOwnProperty.call(todo.payload, 'state'), false, 'todo는 전체 state를 fold하지 않는다');
});
