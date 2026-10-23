const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

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

class MockTttCounselWriteIndeterminateError extends Error {}

function summarize(studentCodes, result) {
  const requested = new Set(studentCodes);
  const phones = result.phones.filter((row) => requested.has(row.studentCode));
  const failures = result.failures.filter((row) => requested.has(row.studentCode));
  return {
    requested: requested.size,
    received: phones.length,
    populated: phones.filter((row) => row.motherPhone).length,
    empty: phones.filter((row) => !row.motherPhone).length,
    failures: failures.length,
    failuresByReason: {},
    allFailed: requested.size > 0 && phones.length === 0,
  };
}

function loadHandler() {
  const source = fs.readFileSync(handlerPath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: handlerPath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
    },
  });
  const mocks = {
    '@/src/backend': { backend: () => activeBackend },
    // 라우트 규칙 테스트는 인증을 대신해 요청의 role·tid를 행위자로 쓴다. 실제 인증은 auth-session.test.cjs가 검증한다.
    '@/src/auth': { resolveActor: (req) => { const pick = (v) => String(Array.isArray(v) ? v[0] ?? '' : v ?? '').trim(); const q = req.query || {}; const b = req.body && typeof req.body === 'object' ? req.body : {}; const role = pick(q.role) || pick(b.role); const tid = pick(q.tid) || pick(b.tid); return ['lead', 'teacher', 'other'].includes(role) && tid ? { role, tid } : null; }, assertSameOrigin: () => {}, issueSessionCookie: () => 'npr_session=test', clearSessionCookie: () => 'npr_session=', loginThrottle: { key: () => 'test', assertAllowed() {}, recordFailure() {}, reset() {} } },
    '@/src/secret': { appSecret: () => 'test-only-secret' },
    '@/src/http-error': { HttpError: MockHttpError },
    '@/src/ttt/ttt.special': {
      createRegularClassProofScope: () => ({ fingerprint: '', slots: {}, testScope: Symbol('counsel-proof') }),
      summarizeSpecialMotherPhoneBatch: summarize,
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

function createHarness(options = {}) {
  const kind = options.kind || 'special';
  const calls = {
    accessible: 0,
    contactRead: 0,
    contactDetail: 0,
    contactWrite: 0,
    fold: 0,
    lease: 0,
    membershipRead: 0,
    nearest: 0,
    reconcile: 0,
    release: 0,
    regularSnapshot: 0,
    regularProofReads: [],
    replicaBestEffort: 0,
    specialSnapshot: 0,
    strict: 0,
  };
  let leaseHeld = false;
  const defaultClasses = options.classes || ['Class One'];
  const context = options.context || {
    kind,
    sourceMonth: kind === 'special' ? '2026-07' : '',
    classes: defaultClasses,
    ...(kind === 'regular' ? {
      regularClasses: options.regularClasses
        || defaultClasses.map((className) => ({ className, dayGroup: 'M' })),
    } : {}),
  };
  const reconcileResult = options.reconcileResult || {
    taskId: 'task-1',
    teacher: 'Bound Teacher',
    teacherTid: 'teacher-1',
    kind,
    sourceMonth: '2026-07',
    syncedAt: '2026-07-24T00:00:00.000Z',
    entries: [],
    classes: [],
    added: 0,
    updated: 0,
    inactivated: 0,
    reactivated: 0,
    counts: { active: 0, inactive: 0, total: 0, classes: 0 },
  };
  const store = {
    acquireTeacherClassMutationLease(purpose) {
      calls.lease++;
      assert.equal(purpose, 'POST:counsel/task-1/sync-roster');
      if (calls.lease === options.leaseConflictAt) {
        throw new MockHttpError(409, '다른 반 또는 강사 계정 변경 작업이 진행 중입니다.');
      }
      leaseHeld = true;
      return 'counsel-roster-lease';
    },
    releaseTeacherClassMutationLease(token) {
      assert.equal(token, 'counsel-roster-lease');
      assert.equal(leaseHeld, true);
      calls.release++;
      leaseHeld = false;
    },
    getCounselContext(taskId, teacher) {
      assert.equal(taskId, 'task-1');
      assert.equal(teacher, 'Bound Teacher');
      return context;
    },
    counselRosterMembershipSignature(rows) {
      const unique = new Map();
      for (const row of rows || []) {
        const tuple = [String(row.classCode || '').trim(), String(row.scode || '').trim()];
        unique.set(JSON.stringify(tuple), tuple);
      }
      return JSON.stringify([...unique.values()].sort((left, right) =>
        left[0].localeCompare(right[0]) || left[1].localeCompare(right[1])));
    },
    getActiveCounselRosterMembershipOnPrimary(input) {
      calls.membershipRead++;
      assert.deepEqual(input, {
        taskId: 'task-1', teacher: 'Bound Teacher', teacherTid: 'teacher-1', kind: 'regular',
      });
      return options.currentMembership || [];
    },
    getCounselSnapshotOnPrimary(taskId, teacher, cls) {
      calls.contactRead++;
      assert.equal(taskId, 'task-1');
      assert.equal(teacher, 'Bound Teacher');
      assert.equal(cls, 'Class One');
      return options.current || {
        ...context,
        sourceMonth: '2026-07',
        entries: [],
      };
    },
    getState() {
      calls.fold++;
      return { stale: true };
    },
    getTeacherTtt(tid) {
      assert.equal(tid, 'teacher-1');
      return options.credentials === null ? null : { id: 'erp-teacher', pw: 'secret' };
    },
    reconcileCounselRosterSnapshotOnPrimary(input) {
      assert.equal(leaseHeld, true, 'prepare must retain the mutation lease through primary reconcile');
      calls.reconcile++;
      calls.reconcileInput = input;
      return reconcileResult;
    },
    resolveTeacherName(tid) {
      return tid === 'teacher-1' ? 'Bound Teacher' : null;
    },
    updateCounselRosterContactsOnPrimary(input) {
      calls.contactWrite++;
      calls.contactInput = input;
      return options.contactResult || {
        entries: [], updated: 0, cleared: 0, preserved: 0, missing: 0,
        counts: { active: 0, total: 0, withPhone: 0, withoutPhone: 0 },
      };
    },
  };
  const specialTtt = {
    async getCurrentMonthClassSnapshot(date) {
      assert.equal(leaseHeld, true, 'prepare must hold the mutation lease during the ERP read');
      calls.specialSnapshot++;
      assert.equal(date, '2026-07-24');
      if (options.snapshotError) throw options.snapshotError;
      return options.snapshot;
    },
    async getCurrentMonthRegularClassSnapshot(date) {
      assert.equal(leaseHeld, true, 'prepare must hold the mutation lease during the ERP read');
      calls.regularSnapshot++;
      assert.equal(date, '2026-07-24');
      if (options.snapshotError) throw options.snapshotError;
      return options.snapshot;
    },
    async getNearestClassSnapshot() {
      calls.nearest++;
      throw new Error('nearest-month fallback must not run');
    },
    async getNearestRegularClassCatalog() {
      calls.nearest++;
      throw new Error('nearest-month fallback must not run');
    },
    async getStudentMotherPhones(codes) {
      calls.contactDetail++;
      calls.contactCodes = codes;
      return options.details || { phones: [], failures: [] };
    },
  };
  const ttt = {
    async getAccessibleClasses(credentials) {
      calls.accessible++;
      throw new Error('앱관리 picker는 담당반 판별에 사용하면 안 됩니다.');
    },
    async getCurrentMonthRegularClassSnapshotForTeacher(date, teacher, credentials, currentAssignments, proofRead) {
      assert.equal(leaseHeld, true, 'prepare must hold the mutation lease during the ERP read');
      const readIndex = calls.regularSnapshot++;
      assert.equal(date, '2026-07-24');
      assert.equal(teacher, 'Bound Teacher');
      assert.deepEqual(credentials, { id: 'erp-teacher', pw: 'secret' });
      assert.deepEqual(currentAssignments, context.regularClasses || []);
      assert.ok(proofRead?.scope);
      assert.equal(proofRead.lane, readIndex === 0 ? 'initial' : 'confirmation');
      if (readIndex > 0) assert.equal(proofRead.scope, calls.regularProofReads[0].scope);
      calls.regularProofReads.push(proofRead);
      if (options.snapshotError) throw options.snapshotError;
      const queued = options.regularSnapshots?.[readIndex];
      if (queued instanceof Error) throw queued;
      return queued || options.snapshot;
    },
    async getRoster() {
      throw new Error('attendance-based roster fallback must not run');
    },
  };
  return {
    calls,
    backend: {
      store,
      specialTtt,
      ttt,
      db: {
        sync() { calls.replicaBestEffort++; },
        syncStrict() { calls.strict++; },
      },
    },
  };
}

async function invoke(harness, body = {}) {
  activeBackend = harness.backend;
  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({
    method: 'POST',
    headers: {},
    query: { slug: ['counsel', 'task-1', 'sync-roster'] },
    body: {
      role: 'teacher',
      tid: 'teacher-1',
      teacher: 'Bound Teacher',
      date: '2026-07-24',
      ...body,
    },
  }, response);
  return response;
}

function specialSnapshot(classes, listedClassCount = classes.length) {
  return {
    targetMonth: '2026-07',
    sourceMonth: '2026-07',
    month: '2026-07',
    classes,
    unsupportedSchedules: [],
    listedClassCount,
    listedEnrollmentCount: classes.reduce((sum, cls) => sum + cls.students.length, 0),
    uniqueSupportedStudentCount: 0,
    searchedMonths: ['2026-07'],
  };
}

function cls(classCode, className, teacherName, students, dayGroup = 'M') {
  return { classCode, className, teacherName, students, dayGroup };
}

test('special prepare reads only the exact month, filters the exact teacher, and writes one primary snapshot', async () => {
  const snapshot = specialSnapshot([
    cls('C1', 'Class One', 'Bound Teacher', [
      { studentCode: 'S1', studentName: 'Student One' },
      { scode: 'S2', student: 'Student Two' },
    ]),
    cls('C2', 'Other Class', 'Other Teacher', [{ scode: 'S3', student: 'Other Student' }]),
  ]);
  const result = {
    taskId: 'task-1', teacher: 'Bound Teacher', teacherTid: 'teacher-1', kind: 'special',
    sourceMonth: '2026-07', syncedAt: 'now', entries: [{ scode: 'S1' }], classes: ['Class One'],
    added: 2, updated: 0, inactivated: 1, reactivated: 0,
    counts: { active: 2, inactive: 1, total: 3, classes: 1 },
  };
  const harness = createHarness({ snapshot, reconcileResult: result });
  const response = await invoke(harness, { prepare: true });

  assert.equal(response.statusCode, 201);
  assert.equal(harness.calls.specialSnapshot, 1);
  assert.equal(harness.calls.regularSnapshot, 0);
  assert.equal(harness.calls.nearest, 0);
  assert.equal(harness.calls.reconcile, 1);
  assert.deepEqual(harness.calls.reconcileInput.classes, [{
    classCode: 'C1',
    className: 'Class One',
    students: [
      { scode: 'S1', student: 'Student One' },
      { scode: 'S2', student: 'Student Two' },
    ],
  }]);
  assert.equal(harness.calls.reconcileInput.kind, 'special');
  assert.equal(harness.calls.reconcileInput.sourceMonth, '2026-07');
  assert.equal(response.payload.rosterCount, 2);
  assert.deepEqual(response.payload.classes, ['Class One']);
  assert.equal(response.payload.state, undefined, 'a stale embedded fold must not follow a primary write');
  assert.equal(harness.calls.strict, 2, 'prepare pulls once before and once after taking the mutation lease');
  assert.equal(harness.calls.lease, 1);
  assert.equal(harness.calls.release, 1);
  assert.equal(harness.calls.replicaBestEffort, 0, 'middleware must not sync after the primary store method');
  assert.equal(harness.calls.fold, 0);
});

test('regular prepare uses the exact ERP teacher-filtered snapshot and never reads the academy-wide picker', async () => {
  const snapshot = specialSnapshot([
    cls('R1', 'Regular One', '', [{ scode: 'S1', student: 'Student One' }]),
    cls('R2', 'Regular Two', '', [{ scode: 'S2', student: 'Student Two' }], 'T'),
    cls('R3', 'Secondary Extra', '', [{ scode: 'S3', student: 'Student Three' }]),
  ]);
  const result = {
    taskId: 'task-1', teacher: 'Bound Teacher', teacherTid: 'teacher-1', kind: 'regular',
    sourceMonth: '2026-07', syncedAt: 'now', entries: [{ scode: 'S2' }], classes: ['Regular Two'],
    added: 1, updated: 0, inactivated: 0, reactivated: 0,
    counts: { active: 1, inactive: 0, total: 1, classes: 1 },
  };
  const harness = createHarness({
    kind: 'regular', snapshot, reconcileResult: result,
    currentMembership: [
      { classCode: 'R1', className: 'Regular One', scode: 'S1' },
      { classCode: 'R2', className: 'Regular Two', scode: 'S2' },
    ],
    context: {
      kind: 'regular', sourceMonth: '', classes: ['Regular One', 'Regular Two'],
      regularClasses: [
        { className: 'Regular One', dayGroup: 'M' },
        { className: 'Regular Two', dayGroup: 'T' },
      ],
    },
  });
  const response = await invoke(harness, { prepare: true });

  assert.equal(response.statusCode, 201);
  assert.equal(harness.calls.regularSnapshot, 1);
  assert.equal(harness.calls.membershipRead, 1);
  assert.equal(harness.calls.accessible, 0);
  assert.deepEqual(harness.calls.reconcileInput.classes.map((row) => row.classCode), ['R1', 'R2']);
  assert.equal(harness.calls.reconcileInput.kind, 'regular');
  assert.equal(response.payload.snapshotCounts.selectedEnrollments, 2);
  assert.deepEqual(response.payload.excludedExtraClasses, ['Secondary Extra']);
  assert.match(response.payload.warnings[0], /1개 반을 제외/);
});

test('regular prepare fails without mutation when an assigned class is missing or changes day group', async () => {
  const context = {
    kind: 'regular', sourceMonth: '', classes: ['Regular One'],
    regularClasses: [{ className: 'Regular One', dayGroup: 'M' }],
  };
  const cases = [
    specialSnapshot([
      cls('R2', 'Secondary Extra', '', [{ scode: 'S2', student: 'Student Two' }]),
    ]),
    specialSnapshot([
      cls('R1', 'Regular One', '', [{ scode: 'S1', student: 'Student One' }], 'T'),
    ]),
  ];
  for (const snapshot of cases) {
    const harness = createHarness({ kind: 'regular', context, snapshot });
    const response = await invoke(harness, { prepare: true });
    assert.equal(response.statusCode, 502);
    assert.equal(harness.calls.reconcile, 0);
  }
});

test('regular prepare reconciles away a contaminated class only with explicit non-primary proof', async () => {
  const context = {
    kind: 'regular', sourceMonth: '', classes: ['Regular One'],
    regularClasses: [{ className: 'Regular One', dayGroup: 'M' }],
  };
  const snapshot = {
    ...specialSnapshot([], 0),
    nonPrimaryCurrentClasses: [{
      classCode: 'R1', className: 'Regular One', dayGroup: 'M', primaryStatus: 'other-teacher',
    }],
  };
  const harness = createHarness({
    kind: 'regular', context, snapshot,
    regularSnapshots: [snapshot, snapshot],
    currentMembership: [{ classCode: 'R1', className: 'Regular One', scode: 'S1' }],
  });
  const response = await invoke(harness, { prepare: true });

  assert.equal(response.statusCode, 201);
  assert.equal(harness.calls.regularSnapshot, 2);
  assert.equal(harness.calls.reconcile, 1);
  assert.deepEqual(harness.calls.reconcileInput.classes, []);
  assert.equal(harness.calls.reconcileInput.confirmedRemovalSignature, '[]');
  assert.deepEqual(response.payload.removedNonPrimaryClasses, ['Regular One']);
  assert.match(response.payload.warnings[0], /담임이 아님/);
});

test('regular prepare double-reads an active-student removal and applies only matching membership', async () => {
  const context = {
    kind: 'regular', sourceMonth: '', classes: ['Regular One'],
    regularClasses: [{ className: 'Regular One', dayGroup: 'M' }],
  };
  const first = specialSnapshot([
    cls('R1', 'Regular One', '', [
      { scode: 'S1', student: 'First Name' },
      { scode: 'S2', student: 'Second Name' },
    ]),
  ]);
  const confirmation = specialSnapshot([
    cls('R1', 'Regular One', '', [
      { scode: 'S2', student: 'Second Name Updated' },
      { scode: 'S1', student: 'First Name Updated' },
    ]),
  ]);
  const harness = createHarness({
    kind: 'regular', context, snapshot: first,
    regularSnapshots: [first, confirmation],
    currentMembership: [
      { classCode: 'R1', className: 'Regular One', scode: 'S1' },
      { classCode: 'R1', className: 'Regular One', scode: 'S2' },
      { classCode: 'R1', className: 'Regular One', scode: 'S3' },
    ],
  });
  const response = await invoke(harness, { prepare: true });

  assert.equal(response.statusCode, 201);
  assert.equal(harness.calls.regularSnapshot, 2);
  assert.equal(harness.calls.reconcile, 1);
  assert.deepEqual(harness.calls.reconcileInput.classes[0].students, [
    { scode: 'S2', student: 'Second Name Updated' },
    { scode: 'S1', student: 'First Name Updated' },
  ]);
  assert.match(harness.calls.reconcileInput.confirmedRemovalSignature, /R1/);
});

test('regular prepare preserves the primary roster when the destructive confirmation changes or fails', async () => {
  const context = {
    kind: 'regular', sourceMonth: '', classes: ['Regular One'],
    regularClasses: [{ className: 'Regular One', dayGroup: 'M' }],
  };
  const destructive = specialSnapshot([
    cls('R1', 'Regular One', '', [{ scode: 'S1', student: 'One' }]),
  ]);
  const changed = specialSnapshot([
    cls('R1', 'Regular One', '', [
      { scode: 'S1', student: 'One' }, { scode: 'S2', student: 'Two' },
    ]),
  ]);
  for (const second of [changed, new Error('confirmation unavailable')]) {
    const harness = createHarness({
      kind: 'regular', context, snapshot: destructive,
      regularSnapshots: [destructive, second],
      currentMembership: [
        { classCode: 'R1', className: 'Regular One', scode: 'S1' },
        { classCode: 'R1', className: 'Regular One', scode: 'S2' },
      ],
    });
    const response = await invoke(harness, { prepare: true });
    assert.equal(response.statusCode, 502);
    assert.equal(harness.calls.regularSnapshot, 2);
    assert.equal(harness.calls.reconcile, 0);
  }
});

test('regular destructive confirmation rejects non-primary and primary-zero state changes with identical empty membership', async () => {
  const context = {
    kind: 'regular', sourceMonth: '', classes: ['Regular One'],
    regularClasses: [{ className: 'Regular One', dayGroup: 'M' }],
  };
  const nonPrimary = {
    ...specialSnapshot([], 0),
    nonPrimaryCurrentClasses: [{
      classCode: 'R1', className: 'Regular One', dayGroup: 'M', primaryStatus: 'other-teacher',
    }],
  };
  const primaryZero = specialSnapshot([
    { ...cls('R1', 'Regular One', '', []), scheduleCode: '1010100' },
  ]);
  for (const regularSnapshots of [
    [nonPrimary, primaryZero],
    [primaryZero, nonPrimary],
  ]) {
    const harness = createHarness({
      kind: 'regular', context, snapshot: regularSnapshots[0], regularSnapshots,
      currentMembership: [{ classCode: 'R1', className: 'Regular One', scode: 'S1' }],
    });
    const response = await invoke(harness, { prepare: true });
    assert.equal(response.statusCode, 502);
    assert.match(response.payload.message, /두 번의 확인에서 일치하지 않아/);
    assert.equal(harness.calls.regularSnapshot, 2);
    assert.equal(harness.calls.reconcile, 0);
  }
});

test('regular prepare uses natural class-name membership for legacy or monthly class-code replacement', async () => {
  const context = {
    kind: 'regular', sourceMonth: '', classes: ['Regular One'],
    regularClasses: [{ className: 'Regular One', dayGroup: 'M' }],
  };
  const snapshot = specialSnapshot([
    cls('NEW-R1', 'Regular One', '', [{ scode: 'S1', student: 'One' }]),
  ]);
  for (const classCode of ['', 'OLD-R1']) {
    const harness = createHarness({
      kind: 'regular', context, snapshot,
      currentMembership: [{ classCode, className: 'Regular One', scode: 'S1' }],
    });
    const response = await invoke(harness, { prepare: true });
    assert.equal(response.statusCode, 201);
    assert.equal(harness.calls.regularSnapshot, 1);
    assert.equal(harness.calls.reconcile, 1);
    assert.equal(harness.calls.reconcileInput.confirmedRemovalSignature, undefined);
  }
});

test('a second prepare lease conflict stops before every ERP read and reconcile while the first lease is released', async () => {
  const snapshot = specialSnapshot([
    cls('C1', 'Class One', 'Bound Teacher', [{ scode: 'S1', student: 'Student One' }]),
  ]);
  const harness = createHarness({ snapshot, leaseConflictAt: 2 });

  const first = await invoke(harness, { prepare: true });
  assert.equal(first.statusCode, 201);
  assert.equal(harness.calls.release, 1, 'the successful prepare must release its whole-request lease');

  const second = await invoke(harness, { prepare: true });
  assert.equal(second.statusCode, 409);
  assert.match(second.payload.message, /진행 중/);
  assert.equal(harness.calls.lease, 2);
  assert.equal(harness.calls.release, 1, 'a rejected acquisition has no token to release');
  assert.equal(harness.calls.specialSnapshot, 1, 'the conflicting request must not reach ERP');
  assert.equal(harness.calls.regularSnapshot, 0);
  assert.equal(harness.calls.accessible, 0);
  assert.equal(harness.calls.reconcile, 1, 'the conflicting request must not reconcile a stale snapshot');
});

test('a valid full snapshot with no classes for this teacher reconciles an explicit empty target', async () => {
  const snapshot = specialSnapshot([
    cls('C2', 'Other Class', 'Other Teacher', [{ scode: 'S3', student: 'Other Student' }]),
  ]);
  const harness = createHarness({ snapshot });
  const response = await invoke(harness, { prepare: true });

  assert.equal(response.statusCode, 201);
  assert.equal(harness.calls.reconcile, 1);
  assert.deepEqual(harness.calls.reconcileInput.classes, []);
});

test('a current-teacher special unsupported schedule blocks mixed and unsupported-only snapshots without mutation', async () => {
  const mixedSnapshot = {
    ...specialSnapshot([
      cls('C1', 'Class One', 'Bound Teacher', [{ scode: 'S1', student: 'Student One' }]),
    ]),
    unsupportedSchedules: [{ classCode: 'U1', className: 'Unsupported', teacherName: ' Bound Teacher ' }],
    listedClassCount: 2,
  };
  const mixed = createHarness({ snapshot: mixedSnapshot });
  const mixedResponse = await invoke(mixed, { prepare: true });
  assert.equal(mixedResponse.statusCode, 502);
  assert.match(mixedResponse.payload.message, /지원하지 않는 요일표/);
  assert.equal(mixed.calls.reconcile, 0);

  const onlySnapshot = {
    ...specialSnapshot([], 1),
    unsupportedSchedules: [{ classCode: 'U1', className: 'Unsupported', teacherName: 'Bound Teacher' }],
    listedClassCount: 1,
  };
  const only = createHarness({ snapshot: onlySnapshot });
  const onlyResponse = await invoke(only, { prepare: true });
  assert.equal(onlyResponse.statusCode, 502);
  assert.equal(only.calls.reconcile, 0, 'unsupported-only must not be mistaken for a valid empty teacher roster');
});

test('another teacher special unsupported schedule does not block an exact empty target reconcile', async () => {
  const snapshot = {
    ...specialSnapshot([], 1),
    unsupportedSchedules: [{ classCode: 'U1', className: 'Other Unsupported', teacherName: 'Other Teacher' }],
    listedClassCount: 1,
  };
  const harness = createHarness({ snapshot });
  const response = await invoke(harness, { prepare: true });

  assert.equal(response.statusCode, 201);
  assert.equal(harness.calls.reconcile, 1);
  assert.deepEqual(harness.calls.reconcileInput.classes, []);
});

test('regular prepare ignores unsupported extra classes but blocks an assigned unsupported class', async () => {
  const snapshot = {
    ...specialSnapshot([
      cls('R1', 'Regular One', '', [{ scode: 'S1', student: 'Student One' }]),
    ]),
    unsupportedSchedules: [{ classCode: 'U1', className: 'Unsupported Regular' }],
    listedClassCount: 2,
  };
  const allowed = createHarness({
    kind: 'regular', snapshot,
    context: {
      kind: 'regular', sourceMonth: '', classes: ['Regular One'],
      regularClasses: [{ className: 'Regular One', dayGroup: 'M' }],
    },
    reconcileResult: {
      taskId: 'task-1', teacher: 'Bound Teacher', teacherTid: 'teacher-1', kind: 'regular',
      sourceMonth: '2026-07', syncedAt: 'now', entries: [{ scode: 'S1' }], classes: ['Regular One'],
      added: 1, updated: 0, inactivated: 0, reactivated: 0,
      counts: { active: 1, inactive: 0, total: 1, classes: 1 },
    },
  });
  const allowedResponse = await invoke(allowed, { prepare: true });
  assert.equal(allowedResponse.statusCode, 201);
  assert.equal(allowed.calls.reconcile, 1);
  assert.deepEqual(allowed.calls.reconcileInput.classes.map((row) => row.classCode), ['R1']);
  assert.deepEqual(allowedResponse.payload.excludedExtraClasses, ['Unsupported Regular']);

  const assignedUnsupported = {
    ...snapshot,
    classes: [],
    listedClassCount: 1,
  };
  const blocked = createHarness({
    kind: 'regular', snapshot: assignedUnsupported,
    context: {
      kind: 'regular', sourceMonth: '', classes: ['Unsupported Regular'],
      regularClasses: [{ className: 'Unsupported Regular', dayGroup: 'M' }],
    },
  });
  const blockedResponse = await invoke(blocked, { prepare: true });
  assert.equal(blockedResponse.statusCode, 502);
  assert.match(blockedResponse.payload.message, /지원하지 않아/);
  assert.equal(blocked.calls.reconcile, 0);
});

test('an exact empty teacher-filtered roster is valid only when the teacher had no existing regular classes', async () => {
  const empty = specialSnapshot([], 0);
  const safe = createHarness({
    kind: 'regular', snapshot: empty,
    context: { kind: 'regular', sourceMonth: '', classes: [], regularClasses: [] },
  });
  const safeResponse = await invoke(safe, { prepare: true });
  assert.equal(safeResponse.statusCode, 201);
  assert.equal(safe.calls.reconcile, 1);
  assert.deepEqual(safe.calls.reconcileInput.classes, []);

  const guarded = createHarness({
    kind: 'regular', snapshot: empty,
    context: {
      kind: 'regular', sourceMonth: '', classes: ['Existing'],
      regularClasses: [{ className: 'Existing', dayGroup: 'M' }],
    },
  });
  const guardedResponse = await invoke(guarded, { prepare: true });
  assert.equal(guardedResponse.statusCode, 502);
  assert.match(guardedResponse.payload.message, /정확히 확인하지 못해/);
  assert.equal(guarded.calls.reconcile, 0);
});

test('an empty or wrong-month central snapshot never reaches the primary reconcile method', async () => {
  const empty = createHarness({ snapshot: specialSnapshot([], 0) });
  const emptyResponse = await invoke(empty, { prepare: true });
  assert.equal(emptyResponse.statusCode, 502);
  assert.match(emptyResponse.payload.message, /비어/);
  assert.equal(empty.calls.reconcile, 0);

  const wrongMonthSnapshot = { ...specialSnapshot([cls('C1', 'Class One', 'Bound Teacher', [])]), sourceMonth: '2026-06' };
  const wrong = createHarness({ snapshot: wrongMonthSnapshot });
  const wrongResponse = await invoke(wrong, { prepare: true });
  assert.equal(wrongResponse.statusCode, 502);
  assert.match(wrongResponse.payload.message, /다른 명단/);
  assert.equal(wrong.calls.reconcile, 0);
});

test('an incomplete authoritative ERP response releases the lease without a partial reconcile', async () => {
  const harness = createHarness({
    snapshotError: new MockTttSpecialError('LIST_PARSE_FAILED', '통통통 특강 반 응답의 totalnm 건수가 일치하지 않습니다.'),
  });
  const response = await invoke(harness, { prepare: true });

  assert.equal(response.statusCode, 502);
  assert.match(response.payload.message, /totalnm/);
  assert.equal(harness.calls.specialSnapshot, 1);
  assert.equal(harness.calls.reconcile, 0);
  assert.equal(harness.calls.lease, 1);
  assert.equal(harness.calls.release, 1);
});

test('contact refresh force-reads every active student, clears confirmed blanks, and preserves failed codes', async () => {
  const current = {
    kind: 'special',
    sourceMonth: '2026-07',
    classes: ['Class One'],
    entries: [
      { cls: 'Class One', classCode: 'C1', scode: 'S1', phone: '010-old-1', rosterActive: true, rosterSourceMonth: '2026-07' },
      { cls: 'Class One', classCode: 'C1', scode: 'S2', phone: '010-old-2', rosterActive: true, rosterSourceMonth: '2026-07' },
      { cls: 'Class One', classCode: 'C1', scode: 'S3', phone: '010-old-3', rosterActive: true, rosterSourceMonth: '2026-07' },
    ],
  };
  const contactResult = {
    entries: [
      { cls: 'Class One', scode: 'S1', phone: '010-new-1' },
      { cls: 'Class One', scode: 'S2', phone: '' },
      { cls: 'Class One', scode: 'S3', phone: '010-old-3' },
    ],
    updated: 1, cleared: 1, preserved: 1, missing: 1,
    counts: { active: 3, total: 3, withPhone: 2, withoutPhone: 1 },
  };
  const harness = createHarness({
    current,
    contactResult,
    details: {
      phones: [
        { studentCode: 'S1', motherPhone: '010-new-1' },
        { studentCode: 'S2', motherPhone: '' },
      ],
      failures: [{ studentCode: 'S3', reason: 'request-failed' }],
    },
  });
  const response = await invoke(harness, { cls: 'Class One', contactsOnly: true });

  assert.equal(response.statusCode, 201);
  assert.deepEqual(harness.calls.contactCodes, ['S1', 'S2', 'S3']);
  assert.deepEqual(harness.calls.contactInput.contacts, [
    { classCode: 'C1', scode: 'S1', motherPhone: '010-new-1', success: true },
    { classCode: 'C1', scode: 'S2', motherPhone: '', success: true },
    { classCode: 'C1', scode: 'S3', motherPhone: '', success: false },
  ]);
  assert.equal(harness.calls.contactInput.sourceMonth, '2026-07');
  assert.equal(response.payload.contactSync.received, 2);
  assert.equal(response.payload.contactSync.empty, 1);
  assert.match(response.payload.warnings[0], /기존 번호 유지/);
  assert.equal(response.payload.missingPhoneCount, 1);
  assert.equal(harness.calls.strict, 1);
  assert.equal(harness.calls.lease, 0, 'contact refreshes must not take the teacher/class mutation lease');
  assert.equal(harness.calls.release, 0);
  assert.equal(harness.calls.replicaBestEffort, 0, 'middleware must not sync after the primary store method');
  assert.equal(harness.calls.fold, 0);
});

test('an all-failed contact batch preserves every existing phone and returns an error', async () => {
  const current = {
    kind: 'regular', sourceMonth: '2026-07', classes: ['Class One'],
    entries: [{
      cls: 'Class One', classCode: 'R1', scode: 'S1', phone: '010-old',
      rosterActive: true, rosterSourceMonth: '2026-07',
    }],
  };
  const harness = createHarness({
    kind: 'regular', current,
    details: { phones: [], failures: [{ studentCode: 'S1', reason: 'request-failed' }] },
  });
  const response = await invoke(harness, { cls: 'Class One' });

  assert.equal(response.statusCode, 502);
  assert.match(response.payload.message, /기존 연락처/);
  assert.equal(harness.calls.contactWrite, 0);
});

test('regular contacts use the active entry roster month instead of the empty regular task context month', async () => {
  const current = {
    kind: 'regular', sourceMonth: '', classes: ['Class One'],
    entries: [{
      cls: 'Class One', classCode: 'R1', scode: 'S1', phone: '010-old',
      rosterActive: true, rosterSourceMonth: '2026-07',
    }],
  };
  const harness = createHarness({
    kind: 'regular', current,
    details: { phones: [{ studentCode: 'S1', motherPhone: '010-new' }], failures: [] },
    contactResult: {
      entries: [{ cls: 'Class One', scode: 'S1', phone: '010-new' }],
      updated: 1, cleared: 0, preserved: 0, missing: 0,
      counts: { active: 1, total: 1, withPhone: 1, withoutPhone: 0 },
    },
  });
  const response = await invoke(harness, { cls: 'Class One', contactsOnly: true });

  assert.equal(response.statusCode, 201);
  assert.equal(harness.calls.contactInput.kind, 'regular');
  assert.equal(harness.calls.contactInput.sourceMonth, '2026-07');
  assert.equal(response.payload.sourceMonth, '2026-07');
});

test('a legacy contact call without stable class codes requires prepare before any student-detail request', async () => {
  const current = {
    kind: 'special', sourceMonth: '2026-07', classes: ['Class One'],
    entries: [{
      cls: 'Class One', classCode: '', scode: 'S1', phone: '010-old',
      rosterActive: true, rosterSourceMonth: '2026-07',
    }],
  };
  const harness = createHarness({ current });
  const response = await invoke(harness, { cls: 'Class One' });

  assert.equal(response.statusCode, 409);
  assert.match(response.payload.message, /명단을 먼저 다시 동기화/);
  assert.equal(harness.calls.contactDetail, 0);
  assert.equal(harness.calls.contactWrite, 0);
});

test('special prepare can restore a legacy class code before the contact phase in the same refresh flow', async () => {
  const current = {
    kind: 'special', sourceMonth: '2026-07', classes: ['Class One'],
    entries: [{
      cls: 'Class One', classCode: 'C1', scode: 'S1', phone: '010-old',
      rosterActive: true, rosterSourceMonth: '2026-07',
    }],
  };
  const harness = createHarness({
    snapshot: specialSnapshot([
      cls('C1', 'Class One', 'Bound Teacher', [{ scode: 'S1', student: 'Student One' }]),
    ]),
    reconcileResult: {
      taskId: 'task-1', teacher: 'Bound Teacher', teacherTid: 'teacher-1', kind: 'special',
      sourceMonth: '2026-07', syncedAt: 'now', entries: current.entries, classes: ['Class One'],
      added: 0, updated: 1, inactivated: 0, reactivated: 0,
      counts: { active: 1, inactive: 0, total: 1, classes: 1 },
    },
    current,
    details: { phones: [{ studentCode: 'S1', motherPhone: '010-new' }], failures: [] },
    contactResult: {
      entries: [{ cls: 'Class One', classCode: 'C1', scode: 'S1', phone: '010-new' }],
      updated: 1, cleared: 0, preserved: 0, missing: 0,
      counts: { active: 1, total: 1, withPhone: 1, withoutPhone: 0 },
    },
  });

  const prepared = await invoke(harness, { prepare: true });
  const contacts = await invoke(harness, { cls: 'Class One', contactsOnly: true });

  assert.equal(prepared.statusCode, 201);
  assert.equal(prepared.payload.updated, 1);
  assert.equal(contacts.statusCode, 201);
  assert.equal(harness.calls.contactDetail, 1);
  assert.equal(harness.calls.contactWrite, 1);
  assert.deepEqual(harness.calls.contactInput.contacts, [
    { classCode: 'C1', scode: 'S1', motherPhone: '010-new', success: true },
  ]);
});

test('a lead cannot prepare or refresh a teacher roster', async () => {
  const harness = createHarness({ snapshot: specialSnapshot([]) });
  activeBackend = harness.backend;
  const response = {
    statusCode: null, payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({
    method: 'POST', headers: {}, query: { slug: ['counsel', 'task-1', 'sync-roster'] },
    body: { role: 'lead', tid: 'admin', teacher: 'Bound Teacher', prepare: true, date: '2026-07-24' },
  }, response);

  assert.equal(response.statusCode, 403);
  assert.match(response.payload.message, /읽기 전용/);
  assert.equal(harness.calls.specialSnapshot, 0);
  assert.equal(harness.calls.reconcile, 0);
});
