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

class MockTttCounselWriteIndeterminateError extends Error {
  constructor(message, beforeCount = 0, afterCount = beforeCount, writeDate = '') {
    super(message);
    this.beforeCount = beforeCount;
    this.afterCount = afterCount;
    this.writeDate = writeDate;
  }
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
        try {
          sync();
          return 'synced';
        } catch {
          return 'pending';
        }
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

function counselEntry(overrides = {}) {
  return {
    id: 'entry-current',
    taskId: 'task-special',
    teacher: 'Bound Teacher',
    teacherTid: 'teacher-1',
    cls: 'Special Class',
    scode: 'S1',
    student: 'Student One',
    subject: 'Special greeting',
    content: 'Private counsel body',
    synced: false,
    deliveryState: 'pending',
    deliveryStage: 'posting',
    deliveryFingerprint: 'a'.repeat(64),
    deliveryDate: '2026-07-23',
    deliveryBeforeCount: 2,
    deliveryMessage: '',
    ...overrides,
  };
}

function requestBody(entry) {
  return {
    role: 'teacher',
    tid: 'teacher-1',
    taskId: entry.taskId,
    teacher: entry.teacher,
    cls: entry.cls,
    scode: entry.scode,
  };
}

function createBackend(entry, reconcileResult, claimRecovery = 'waiting', options = {}) {
  const calls = {
    confirm: 0,
    markIndeterminate: 0,
    reconcile: 0,
    recover: 0,
    reset: 0,
    resolveStuck: 0,
    diagnose: 0,
    sync: 0,
    write: 0,
  };
  let current = entry;
  const store = {
    confirmCounselDelivery(id, fingerprint, syncedAt, detail) {
      calls.confirm++;
      assert.equal(id, current.id);
      assert.equal(fingerprint, current.deliveryFingerprint);
      current = {
        ...current,
        synced: true,
        syncedAt,
        deliveryState: 'confirmed',
        deliveryStage: 'confirmed',
        deliveryBeforeCount: detail.beforeCount,
      };
      return current;
    },
    getState() {
      return { marker: 'folded-state' };
    },
    getTeacherTtt() {
      return null;
    },
    resolveTeacherName(tid) {
      return tid === 'teacher-1' ? current.teacher : null;
    },
    markCounselDeliveryIndeterminate(id, fingerprint, detail) {
      calls.markIndeterminate++;
      assert.equal(id, current.id);
      assert.equal(fingerprint, current.deliveryFingerprint);
      current = { ...current, deliveryMessage: detail.message };
      return current;
    },
    recoverStaleCounselDeliveryClaim(id, fingerprint) {
      calls.recover++;
      assert.equal(id, current.id);
      assert.equal(fingerprint, current.deliveryFingerprint);
      if (claimRecovery !== 'reset') return { action: 'waiting', entry: current };
      current = {
        ...current,
        deliveryState: 'idle',
        deliveryStage: '',
        deliveryFingerprint: '',
        deliveryDate: '',
        deliveryBeforeCount: null,
        deliveryMessage: '중단된 전송 준비를 안전하게 초기화했습니다. 다시 전송할 수 있습니다.',
      };
      return { action: 'reset', entry: current };
    },
    resetCounselDeliveryBeforePost(id, fingerprint, message) {
      calls.reset++;
      assert.equal(id, current.id);
      assert.equal(fingerprint, current.deliveryFingerprint);
      current = {
        ...current,
        deliveryState: 'idle',
        deliveryStage: '',
        deliveryFingerprint: '',
        deliveryDate: '',
        deliveryBeforeCount: null,
        deliveryMessage: message,
      };
      return current;
    },
    resolveStuckCounselDelivery(id, fingerprint, resolution, actor, at) {
      calls.resolveStuck++;
      assert.equal(id, current.id);
      assert.equal(fingerprint, current.deliveryFingerprint);
      current = resolution === 'sent'
        ? {
          ...current,
          synced: true,
          syncedAt: at,
          deliveryState: 'confirmed',
          deliveryStage: 'confirmed',
          deliveryPending: false,
          deliveryMessage: `${actor}가 통통통에서 저장을 직접 확인해 전송 완료로 표시했습니다.`,
        }
        : {
          ...current,
          synced: false,
          deliveryState: 'idle',
          deliveryStage: '',
          deliveryFingerprint: '',
          deliveryDate: '',
          deliveryBeforeCount: null,
          deliveryPending: false,
          deliveryMessage: `${actor}가 통통통에 저장되지 않은 것을 직접 확인해 재전송을 허용했습니다.`,
        };
      return current;
    },
    resolveCounselEntry(id, naturalKey) {
      assert.equal(id, 'stale-screen-id');
      assert.deepEqual(naturalKey, {
        taskId: current.taskId,
        teacher: current.teacher,
        cls: current.cls,
        scode: current.scode,
      });
      return current;
    },
  };
  const ttt = {
    async reconcileCounselWrite(payload, beforeCount, writeDate) {
      calls.reconcile++;
      assert.equal(payload.scode, current.scode);
      assert.equal(beforeCount, current.deliveryBeforeCount);
      assert.equal(writeDate, current.deliveryDate);
      return reconcileResult;
    },
    async writeCounsel() {
      calls.write++;
      throw new Error('reconcile must never POST a counsel record');
    },
    async diagnoseCounselWrite(payload, writeDate) {
      calls.diagnose++;
      assert.equal(payload.scode, current.scode);
      assert.equal(writeDate, current.deliveryDate);
      return options.diagnosis === undefined ? null : options.diagnosis;
    },
  };
  return {
    backend: {
      store,
      ttt,
      specialTtt: {},
      db: {
        sync() { calls.sync++; },
        syncStrict() { calls.sync++; },
      },
    },
    calls,
  };
}

async function invokeReconcile(entry, reconcileResult, claimRecovery, options) {
  const harness = createBackend(entry, reconcileResult, claimRecovery, options);
  activeBackend = harness.backend;
  const response = {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await handler({
    method: 'POST',
    query: { slug: ['counsel', 'entry', 'stale-screen-id', 'reconcile'] },
    body: requestBody(entry),
  }, response);
  return { ...harness, response };
}

test('a fresh claimed counsel remains pending during its owner lease and never touches ERP', async () => {
  const entry = counselEntry({
    deliveryStage: 'claimed',
    deliveryBeforeCount: null,
  });
  const { calls, response } = await invokeReconcile(entry, {
    confirmed: false,
    beforeCount: 0,
    afterCount: 0,
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.payload.delivery.erp, 'unconfirmed');
  assert.equal(response.payload.delivery.state, 'pending');
  assert.equal(response.payload.delivery.doNotRetransmit, true);
  assert.equal(response.payload.entry.deliveryState, 'pending');
  assert.equal(response.payload.entry.deliveryStage, 'claimed');
  assert.equal(calls.recover, 1);
  assert.equal(calls.reset, 0);
  assert.equal(calls.reconcile, 0);
  assert.equal(calls.write, 0);
});

test('a same-name counsel entry with a blank or different teacher tid is rejected before ERP reconciliation', async () => {
  for (const teacherTid of ['', 'teacher-other']) {
    const entry = counselEntry({ teacherTid });
    const { calls, response } = await invokeReconcile(entry, {
      confirmed: true,
      beforeCount: 2,
      afterCount: 3,
    });

    assert.equal(response.statusCode, 403);
    assert.match(response.payload.message, /다른 강사/);
    assert.equal(calls.reconcile, 0);
    assert.equal(calls.confirm, 0);
    assert.equal(calls.markIndeterminate, 0);
    assert.equal(calls.write, 0);
  }
});

test('a stale claimed counsel resets to retryable without ERP access', async () => {
  const entry = counselEntry({
    deliveryStage: 'claimed',
    deliveryBeforeCount: null,
  });
  const { calls, response } = await invokeReconcile(entry, {
    confirmed: false,
    beforeCount: 0,
    afterCount: 0,
  }, 'reset');

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.delivery.erp, 'not-sent');
  assert.equal(response.payload.delivery.state, 'retryable');
  assert.equal(response.payload.delivery.doNotRetransmit, false);
  assert.equal(response.payload.entry.deliveryState, 'idle');
  assert.equal(response.payload.entry.deliveryStage, '');
  assert.equal(calls.recover, 1);
  assert.equal(calls.reset, 0);
  assert.equal(calls.reconcile, 0, 'claimed means the ERP POST callback never completed');
  assert.equal(calls.write, 0, 'reconcile is always read-only');
});

test('posting counsel reconcile stays pending when read-back has not increased and never retransmits', async () => {
  const entry = counselEntry();
  const { calls, response } = await invokeReconcile(entry, {
    confirmed: false,
    beforeCount: 2,
    afterCount: 2,
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.payload.delivery.erp, 'unconfirmed');
  assert.equal(response.payload.delivery.state, 'pending');
  assert.equal(response.payload.delivery.doNotRetransmit, true);
  assert.equal(response.payload.entry.deliveryStage, 'posting');
  assert.equal(calls.reconcile, 1);
  assert.equal(calls.markIndeterminate, 1);
  assert.equal(calls.confirm, 0);
  assert.equal(calls.reset, 0);
  assert.equal(calls.write, 0, 'a pending check must not call the ERP write method');
});

test('posting counsel reconcile may confirm by read-back without performing another ERP POST', async () => {
  const entry = counselEntry();
  const { calls, response } = await invokeReconcile(entry, {
    confirmed: true,
    beforeCount: 2,
    afterCount: 3,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.delivery.erp, 'confirmed');
  assert.equal(response.payload.delivery.persistence, 'synced');
  assert.equal(response.payload.delivery.doNotRetransmit, true);
  assert.equal(response.payload.entry.synced, true);
  assert.equal(response.payload.entry.deliveryStage, 'confirmed');
  assert.equal(calls.reconcile, 1);
  assert.equal(calls.confirm, 1);
  assert.equal(calls.reset, 0);
  assert.equal(calls.write, 0, 'confirmation is based only on the read-back count increase');
});

test('lead cannot reconcile or mutate a teacher counsel delivery', async () => {
  const entry = counselEntry();
  const harness = createBackend(entry, { confirmed: true, beforeCount: 2, afterCount: 3 });
  activeBackend = harness.backend;
  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({
    method: 'POST',
    query: { slug: ['counsel', 'entry', 'stale-screen-id', 'reconcile'] },
    body: { ...requestBody(entry), role: 'lead', tid: 'admin' },
  }, response);

  assert.equal(response.statusCode, 403);
  assert.match(response.payload.message, /읽기 전용/);
  assert.equal(harness.calls.reconcile, 0);
  assert.equal(harness.calls.confirm, 0);
});

test('legacy direct counsel-write endpoint is disabled before any ERP write', async () => {
  const entry = counselEntry();
  const harness = createBackend(entry, null);
  activeBackend = harness.backend;
  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({
    method: 'POST',
    query: { slug: ['ttt', 'counsel-write'] },
    body: { role: 'lead', tid: 'admin' },
  }, response);

  assert.equal(response.statusCode, 410);
  assert.match(response.payload.message, /비활성화/);
  assert.equal(harness.calls.write, 0);
});

test('an unconfirmed reconcile explains why the counsel is missing and offers the manual verdict', async () => {
  const entry = counselEntry();
  const { calls, response } = await invokeReconcile(entry, {
    confirmed: false,
    beforeCount: 2,
    afterCount: 2,
  }, 'waiting', {
    diagnosis: { classCode: 'C1', rosterHasStudent: false, teacherScopeMatch: false },
  });

  assert.equal(response.statusCode, 202);
  assert.equal(calls.diagnose, 1, 'the failure path reads the ERP once more to name the cause');
  assert.equal(calls.write, 0, 'diagnosis is read-only');
  assert.match(response.payload.delivery.message, /반 명단에/);
  assert.match(response.payload.delivery.message, /통통통에 없음/);
  assert.equal(response.payload.entry.deliveryMessage, response.payload.delivery.message);
});

test('an unconfirmed reconcile reports a counsel that the ERP filed outside this class', async () => {
  const entry = counselEntry();
  const { response } = await invokeReconcile(entry, {
    confirmed: false,
    beforeCount: 2,
    afterCount: 2,
  }, 'waiting', {
    diagnosis: { classCode: 'C1', rosterHasStudent: true, teacherScopeMatch: true },
  });

  assert.equal(response.statusCode, 202);
  assert.match(response.payload.delivery.message, /강사별 상담 목록에는 같은 상담이 보입니다/);
});

async function invokeResolve(entry, body) {
  const harness = createBackend(entry, null);
  activeBackend = harness.backend;
  const response = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({
    method: 'POST',
    query: { slug: ['counsel', 'entry', 'stale-screen-id', 'resolve'] },
    body: { ...requestBody(entry), ...body },
  }, response);
  return { ...harness, response };
}

test('a teacher who verified the ERP can release a stuck delivery for one explicit resend', async () => {
  const entry = counselEntry();
  const { calls, response } = await invokeResolve(entry, {
    resolution: 'not-sent',
    fingerprint: entry.deliveryFingerprint,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.delivery.erp, 'not-sent');
  assert.equal(response.payload.delivery.state, 'retryable');
  assert.equal(response.payload.delivery.doNotRetransmit, false);
  assert.equal(response.payload.entry.deliveryState, 'idle');
  assert.equal(calls.resolveStuck, 1);
  assert.equal(calls.write, 0, 'releasing a claim never sends the counsel itself');
  assert.equal(calls.reconcile, 0);
});

test('a teacher who found the counsel in the ERP closes it as sent', async () => {
  const entry = counselEntry();
  const { calls, response } = await invokeResolve(entry, {
    resolution: 'sent',
    fingerprint: entry.deliveryFingerprint,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.delivery.erp, 'confirmed');
  assert.equal(response.payload.entry.synced, true);
  assert.equal(calls.resolveStuck, 1);
  assert.equal(calls.write, 0);
});

test('a manual verdict is refused without a matching attempt fingerprint or a valid resolution', async () => {
  const stale = await invokeResolve(counselEntry(), {
    resolution: 'not-sent',
    fingerprint: 'b'.repeat(64),
  });
  assert.equal(stale.response.statusCode, 409);
  assert.equal(stale.calls.resolveStuck, 0);

  const invalid = await invokeResolve(counselEntry(), { resolution: 'whatever' });
  assert.equal(invalid.response.statusCode, 400);
  assert.equal(invalid.calls.resolveStuck, 0);
});

test('a lead cannot close a teacher counsel delivery by hand', async () => {
  const { calls, response } = await invokeResolve(counselEntry(), {
    role: 'lead',
    tid: 'admin',
    resolution: 'sent',
    fingerprint: 'a'.repeat(64),
  });

  assert.equal(response.statusCode, 403);
  assert.equal(calls.resolveStuck, 0);
});
