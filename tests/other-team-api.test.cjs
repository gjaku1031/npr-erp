const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

process.env.APP_TODAY = '2026-09-05';

const handlerPath = path.resolve(__dirname, '../pages/api/[[...slug]].ts');
let activeBackend;

class MockHttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
class MockTttSpecialError extends Error {
  constructor(code, message) { super(message); this.code = code; }
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
      createOwnedClassProofScope: () => ({ fingerprint: '', slots: {}, marker: Symbol('owned-proof') }),
      createRegularClassProofScope: () => ({ fingerprint: '', slots: {}, marker: Symbol('other-proof') }),
      summarizeSpecialMotherPhoneBatch: () => ({}),
      TttSpecialError: MockTttSpecialError,
    },
    '@/src/ttt/ttt.records': { TttCounselWriteIndeterminateError: class extends Error {} },
    '@/src/api/external-write-sync': { persistConfirmedExternalWrite: (sync) => { sync(); return 'synced'; } },
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

function snapshot(overrides = {}) {
  return {
    targetMonth: '2026-09', sourceMonth: '2026-09', searchedMonths: ['2026-09'],
    listedClassCount: 2, listedEnrollmentCount: 2,
    classes: [{
      classCode: 'C1', className: '본인 M반', topName: '정규', middleName: '중등',
      dayGroup: 'M', scheduleCode: '1010100', studentCount: 1,
      students: [{ scode: 'S1', student: '학생 하나', grade: '초5', status: '수강' }],
    }],
    unsupportedSchedules: [{
      classCode: 'C2', className: '본인 기타반', topName: '내신', middleName: '중등 내신',
      scheduleCodes: ['1101100'], studentCount: 1,
      students: [{ scode: 'S2', student: '학생 둘', grade: '초5', status: '수강' }],
    }],
    excludedExtensions: [{ classCode: 'EXT', className: '[연장] 본인반', studentCount: 1 }],
    ...overrides,
  };
}

function createBackend(options = {}) {
  const calls = {
    strict: 0, sync: 0, lease: 0, release: 0, reads: [], apply: [],
    genericApply: [], creds: [], notebooks: [], counselSnapshots: 0, permissionWrites: [], details: [],
  };
  const snapshots = options.snapshots || [snapshot()];
  const store = {
    isOtherTeamTeacher(tid) { return options.allowed !== false && tid === 'partner-1'; },
    isRegularTeacher(tid) { return tid === 'teacher-1'; },
    isOwnedOtherTeamCounselTask(taskId, tid) {
      return options.ownedCounsel !== false && taskId === 'own-task' && tid === 'partner-1';
    },
    isOtherTeamRosterClass(tid, cls) {
      return options.allowedClass !== false && tid === 'partner-1' && cls === '본인 M반';
    },
    resolveTeacherName(tid) { return tid === 'partner-1' ? '협업 인원' : tid === 'teacher-1' ? '일반 강사' : null; },
    getTeacherTtt(tid) {
      calls.creds.push(tid);
      return tid === 'partner-1' ? { id: 'erp-partner', pw: 'private' }
        : tid === 'teacher-1' ? { id: 'erp-teacher', pw: 'private' } : null;
    },
    acquireTeacherClassMutationLease() { calls.lease += 1; return 'lease-token'; },
    releaseTeacherClassMutationLease(token) { assert.equal(token, 'lease-token'); calls.release += 1; },
    getOtherTeamRoster() {
      return options.currentRoster || { sourceMonth: '', classes: [] };
    },
    getTeacherRoster() {
      return options.currentRoster || {
        sourceMonth: '', classes: [], classCount: 0, studentCount: 0,
        selectionRevision: 'a'.repeat(64),
      };
    },
    getTeacherLegacyClassNames() { return ['본인 M반']; },
    applyTeacherRosterSnapshotOnPrimary(input) {
      calls.genericApply.push(input);
      return {
        sourceMonth: input.sourceMonth, syncedAt: input.syncedAt,
        classCount: input.classes.length,
        studentCount: input.classes.reduce((sum, cls) => sum + cls.students.length, 0),
        warnings: input.warnings, classes: input.classes, selectionRevision: 'b'.repeat(64),
      };
    },
    getSpecialPeriodSettings() {
      return { enabled: !!options.specialPeriodEnabled };
    },
    applyOtherTeamRosterSnapshotOnPrimary(input) {
      calls.apply.push(input);
      return {
        sourceMonth: input.sourceMonth, syncedAt: input.syncedAt,
        classCount: input.classes.length,
        studentCount: input.classes.reduce((sum, cls) => sum + cls.students.length, 0),
        warnings: input.warnings, classes: input.classes,
      };
    },
    getCounselSnapshotOnPrimary() { calls.counselSnapshots += 1; return { entries: [] }; },
    setTeacherOtherTeam(tid, enabled) { calls.permissionWrites.push({ tid, enabled }); },
    getState(role, tid) { return { role, me: { tid }, marker: 'folded' }; },
  };
  return {
    calls,
    backend: {
      store,
      ttt: {
        async getClassStudentDetails(...args) {
          calls.details.push(args);
          return { students: args[0].map((scode) => ({ scode, motherPhone: '010-0000-0000', phoneState: 'ok', lastCounselDate: '2026-09-01', counselState: 'ok' })), warnings: [] };
        },
        async getCurrentMonthOwnedClassSnapshotForTeacher(...args) {
          const index = calls.reads.length;
          calls.reads.push(args);
          return snapshots[Math.min(index, snapshots.length - 1)];
        },
        async getNotebook(cls, date, credentials) {
          calls.notebooks.push({ method: 'GET', cls, date, credentials });
          return { written: false };
        },
        async postNotebook(cls, date, title, body, files, cmtId, attach, credentials) {
          calls.notebooks.push({ method: 'POST', cls, date, title, body, files, cmtId, attach, credentials });
          return { written: true, title, body };
        },
      },
      specialTtt: {},
      db: {
        sync() { calls.sync += 1; },
        syncStrict() { calls.strict += 1; },
      },
    },
  };
}

async function invoke({ method = 'GET', slug, role = 'other', tid = 'partner-1', query = {}, body = {} }) {
  const response = {
    statusCode: 0, payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({ method, query: { slug, role, tid, ...query }, body }, response);
  return response;
}

test('the retired other-team auto-sync cannot bypass explicit cart selection', async () => {
  const harness = createBackend();
  activeBackend = harness.backend;
  const response = await invoke({
    method: 'POST', slug: ['other-team', 'classes', 'sync'],
    body: { targetDate: '2026-09-01', expectedClassCount: 4 },
  });

  assert.equal(response.statusCode, 410);
  assert.match(response.payload.message, /기존 자동 반 동기화는 종료/);
  assert.equal(harness.calls.reads.length, 0);
  assert.equal(harness.calls.apply.length, 0);
  assert.equal(harness.calls.lease, 0);
});

test('other-team counseling and notebook routes reject foreign task or class scope before data access', async () => {
  const harness = createBackend({ ownedCounsel: false, allowedClass: false });
  activeBackend = harness.backend;

  const counsel = await invoke({ method: 'GET', slug: ['counsel', 'foreign-task'], query: { teacher: '협업 인원' } });
  assert.equal(counsel.statusCode, 403);
  assert.equal(harness.calls.counselSnapshots, 0);

  const notebook = await invoke({
    method: 'GET', slug: ['ttt', 'notebook'], query: { cls: '다른 반', date: '2026-09-01' },
  });
  assert.equal(notebook.statusCode, 403);
  assert.equal(harness.calls.notebooks.length, 0);
});

test('other-team notebook uses only the logged-in TTT credentials and refuses a forged tid', async () => {
  const harness = createBackend();
  activeBackend = harness.backend;
  const ok = await invoke({
    method: 'GET', slug: ['ttt', 'notebook'], query: { cls: '본인 M반', date: '2026-09-01', tid: 'partner-1' },
  });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(harness.calls.notebooks[0], {
    method: 'GET', cls: '본인 M반', date: '2026-09-01', credentials: { id: 'erp-partner', pw: 'private' },
  });

  const forged = await invoke({
    method: 'GET', slug: ['ttt', 'notebook'], query: { cls: '본인 M반', date: '2026-09-01', tid: 'teacher-2' },
  });
  assert.equal(forged.statusCode, 403);
  assert.equal(harness.calls.notebooks.length, 1);
});

test('admin other-team checkbox route is serialized and persists the independent permission', async () => {
  const harness = createBackend();
  activeBackend = harness.backend;
  const response = await invoke({
    method: 'POST', slug: ['teachers', 'partner-1', 'other-team'],
    role: 'lead', tid: 'admin', body: { isOtherTeam: true },
  });
  assert.equal(response.statusCode, 201);
  assert.deepEqual(harness.calls.permissionWrites, [{ tid: 'partner-1', enabled: true }]);
  assert.equal(harness.calls.lease, 1);
  assert.equal(harness.calls.release, 1);
  assert.equal(response.payload.state.marker, 'folded');
});

test('a regular teacher can load every exact-owned class as a read-only cart catalog', async () => {
  const harness = createBackend();
  activeBackend = harness.backend;
  const response = await invoke({
    method: 'POST', slug: ['class-management', 'catalog'],
    role: 'teacher', tid: 'teacher-1', body: { teacherTid: 'teacher-1', targetDate: '2026-09-05' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(harness.calls.genericApply.length, 0, 'catalog loading must never change the selection');
  assert.deepEqual([...new Set(harness.calls.creds)], ['teacher-1']);
  assert.equal(harness.calls.reads[0][1], '일반 강사');
  assert.deepEqual(harness.calls.reads[0][4], {
    includeUnsupportedStudents: true,
    includeSpecialClasses: true,
    cacheCatalog: true,
    forceRefresh: false,
  });
  assert.deepEqual(response.payload.selectedClassCodes, ['C1'], 'legacy assignments are preselected once');
  assert.deepEqual(
    response.payload.classes.map((cls) => [cls.classCode, cls.topName, cls.middleName, cls.dayGroup]),
    [['C1', '정규', '중등', 'M'], ['C2', '내신', '중등 내신', 'OTHER']],
  );
  assert.match(response.payload.catalogFingerprint, /^[a-f0-9]{64}$/);
  const proof = JSON.parse(Buffer.from(response.payload.catalogProof.split('.')[0], 'base64url').toString('utf8'));
  assert.match(proof.credentialBinding, /^[a-f0-9]{64}$/);
  const { createHash } = require('node:crypto');
  const credentials = harness.backend.store.getTeacherTtt('teacher-1');
  assert.notEqual(proof.credentialBinding, createHash('sha256').update(JSON.stringify(credentials)).digest('hex'),
    'the client-visible proof must not expose a password hash usable for offline guesses');
  assert.equal(response.payload.selectionRevision, 'a'.repeat(64));
  assert.equal(harness.calls.lease, 0);
});

test('a new month preselects only uniquely matching current candidates and never keeps invisible stale codes', async () => {
  const harness = createBackend({
    currentRoster: {
      sourceMonth: '2026-08',
      selectionRevision: 'a'.repeat(64),
      classes: [
        { classCode: 'OLD-CODE', className: '본인 M반', students: [] },
        { classCode: 'REMOVED-CODE', className: '지난달 종료반', students: [] },
      ],
    },
  });
  activeBackend = harness.backend;
  const response = await invoke({
    method: 'POST', slug: ['class-management', 'catalog'],
    role: 'teacher', tid: 'teacher-1', body: { teacherTid: 'teacher-1', targetDate: '2026-09-05' },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload.selectedClassCodes, ['C1']);
  assert.equal(response.payload.selectedClassCodes.includes('OLD-CODE'), false);
  assert.equal(response.payload.selectedClassCodes.includes('REMOVED-CODE'), false);
});

test('a teacher cannot load or apply another teacher account catalog', async () => {
  const harness = createBackend();
  activeBackend = harness.backend;
  const response = await invoke({
    method: 'POST', slug: ['class-management', 'catalog'],
    role: 'teacher', tid: 'teacher-1', body: { teacherTid: 'partner-1', targetDate: '2026-09-05' },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(harness.calls.reads.length, 0);
  assert.equal(harness.calls.genericApply.length, 0);
});

test('an admin can inspect another-team catalog without changing its daily-report role', async () => {
  const harness = createBackend();
  activeBackend = harness.backend;
  const response = await invoke({
    method: 'POST', slug: ['class-management', 'catalog'],
    role: 'lead', tid: 'admin', body: { teacherTid: 'partner-1', targetDate: '2026-09-05' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.teacherTid, 'partner-1');
  assert.equal(harness.calls.reads[0][1], '협업 인원');
});

test('explicit cart apply persists only selected codes with categories and the catalog CAS revision', async () => {
  const harness = createBackend();
  activeBackend = harness.backend;
  const catalog = await invoke({
    method: 'POST', slug: ['class-management', 'catalog'],
    role: 'teacher', tid: 'teacher-1', body: { teacherTid: 'teacher-1', targetDate: '2026-09-05' },
  });
  const applied = await invoke({
    method: 'POST', slug: ['class-management', 'apply'],
    role: 'teacher', tid: 'teacher-1',
    body: {
      teacherTid: 'teacher-1', targetDate: '2026-09-05',
      catalogFingerprint: catalog.payload.catalogFingerprint,
      catalogProof: catalog.payload.catalogProof,
      selectionRevision: catalog.payload.selectionRevision,
      selectedClassCodes: ['C2'],
    },
  });

  assert.equal(applied.statusCode, 201);
  assert.equal(harness.calls.genericApply.length, 1);
  assert.equal(harness.calls.genericApply[0].teacherTid, 'teacher-1');
  assert.equal(harness.calls.genericApply[0].expectedRevision, 'a'.repeat(64));
  assert.deepEqual(
    harness.calls.genericApply[0].classes.map((cls) => [cls.classCode, cls.topName, cls.middleName, cls.dayGroup]),
    [['C2', '내신', '중등 내신', 'OTHER']],
  );
  assert.match(harness.calls.genericApply[0].warnings.join(' '), /일일보고에서는 제외/);
  assert.equal(harness.calls.lease, 1);
  assert.equal(harness.calls.release, 1);
  assert.deepEqual(harness.calls.reads[1][4].selectedClassCodes, ['C2']);
});

test('apply rejects unsigned or tampered proof before another ERP read', async () => {
  const harness = createBackend(); activeBackend = harness.backend;
  const catalog = await invoke({ method: 'POST', slug: ['class-management', 'catalog'], body: { targetDate: '2026-09-05' } });
  const result = await invoke({ method: 'POST', slug: ['class-management', 'apply'], body: {
    targetDate: '2026-09-05', catalogFingerprint: catalog.payload.catalogFingerprint,
    catalogProof: catalog.payload.catalogProof.replace(/^./, catalog.payload.catalogProof[0] === 'a' ? 'b' : 'a'),
    selectionRevision: 'a'.repeat(64), selectedClassCodes: ['C1'],
  } });
  assert.equal(result.statusCode, 409);
  assert.equal(harness.calls.reads.length, 1);
  assert.equal(harness.calls.genericApply.length, 0);
});

test('deselecting a class does not trigger another complete student-removal scan', async () => {
  const harness = createBackend({ currentRoster: {
    sourceMonth: '2026-09', selectionRevision: 'a'.repeat(64),
    classes: [{ classCode: 'C1', students: [{ scode: 'S1' }] }, { classCode: 'C2', students: [{ scode: 'S2' }] }],
  } }); activeBackend = harness.backend;
  const catalog = await invoke({ method: 'POST', slug: ['class-management', 'catalog'], body: { targetDate: '2026-09-05' } });
  const result = await invoke({ method: 'POST', slug: ['class-management', 'apply'], body: {
    targetDate: '2026-09-05', ...catalog.payload, selectedClassCodes: ['C1'],
  } });
  assert.equal(result.statusCode, 201);
  assert.equal(harness.calls.reads.length, 2);
});

test('removal inside a retained class still requires a fresh confirmation read', async () => {
  const harness = createBackend({ currentRoster: {
    sourceMonth: '2026-09', selectionRevision: 'a'.repeat(64),
    classes: [{ classCode: 'C1', students: [{ scode: 'S1' }, { scode: 'OLD' }] }],
  } }); activeBackend = harness.backend;
  const catalog = await invoke({ method: 'POST', slug: ['class-management', 'catalog'], body: { targetDate: '2026-09-05' } });
  const result = await invoke({ method: 'POST', slug: ['class-management', 'apply'], body: {
    targetDate: '2026-09-05', ...catalog.payload, selectedClassCodes: ['C1'],
  } });
  assert.equal(result.statusCode, 201);
  assert.equal(harness.calls.reads.length, 3);
  assert.equal(harness.calls.reads[2][3].lane, 'confirmation');
  assert.deepEqual(harness.calls.reads[2][4].selectedClassCodes, ['C1']);
});

test('student details use only the current authorized class and reject stale or forged selections', async () => {
  const harness = createBackend({ currentRoster: {
    sourceMonth: '2026-09', selectionRevision: 'a'.repeat(64),
    classes: [{ classCode: 'C1', students: [{ scode: 'S1' }] }],
  } }); activeBackend = harness.backend;
  const good = await invoke({ slug: ['class-management', 'student-details'], query: { classCode: 'C1', selectionRevision: 'a'.repeat(64) } });
  assert.equal(good.statusCode, 200);
  assert.deepEqual(harness.calls.details[0][0], ['S1']);
  assert.equal(good.payload.students[0].counselState, 'ok');
  const foreign = await invoke({ slug: ['class-management', 'student-details'], query: { classCode: 'FOREIGN', selectionRevision: 'a'.repeat(64) } });
  assert.equal(foreign.statusCode, 403);
  const stale = await invoke({ slug: ['class-management', 'student-details'], query: { classCode: 'C1', selectionRevision: 'b'.repeat(64) } });
  assert.equal(stale.statusCode, 409);
  assert.equal(harness.calls.details.length, 1);
  assert.equal(harness.calls.lease, 0);
});

test('apply rejects a stale catalog and a non-current month before changing the roster', async () => {
  const harness = createBackend();
  activeBackend = harness.backend;
  const stale = await invoke({
    method: 'POST', slug: ['class-management', 'apply'],
    role: 'teacher', tid: 'teacher-1',
    body: {
      teacherTid: 'teacher-1', targetDate: '2026-09-05',
      catalogFingerprint: 'f'.repeat(64), selectionRevision: 'a'.repeat(64), selectedClassCodes: ['C1'],
    },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(harness.calls.genericApply.length, 0);

  const priorMonth = await invoke({
    method: 'POST', slug: ['class-management', 'catalog'],
    role: 'teacher', tid: 'teacher-1', body: { teacherTid: 'teacher-1', targetDate: '2026-08-31' },
  });
  assert.equal(priorMonth.statusCode, 400);
  assert.match(priorMonth.payload.message, /현재 수강년월만/);
  assert.equal(harness.calls.genericApply.length, 0);
});
