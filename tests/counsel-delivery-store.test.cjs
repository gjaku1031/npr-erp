const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

// 앱은 별도 테스트 컴파일 산출물을 만들지 않으므로 필요한 TypeScript만 현재 고정 버전으로 변환한다.
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
const {
  StoreService,
  counselDeliveryFingerprint,
} = require('../src/api/store.service.ts');

delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;
process.env.SEED_MODE = 'clean';
process.env.APP_TODAY = '2026-07-23';
process.env.LEAD_ID = 'admin';
process.env.LEAD_PW = 'test-only';
process.env.LEAD_NAME = 'Test Lead';

function createHarness({ beforeInit } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npr-counsel-delivery-'));
  const previousCwd = process.cwd();
  let db;
  try {
    process.chdir(root);
    db = new DbService();
    if (beforeInit) beforeInit(db);
    db.init();
  } finally {
    process.chdir(previousCwd);
  }
  return {
    db,
    store: new StoreService(db),
    close() {
      try { db.db.close(); } catch {}
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function withHarness(fn, options) {
  const harness = createHarness(options);
  try {
    return fn(harness);
  } finally {
    harness.close();
  }
}

function insertEntry(db, overrides = {}) {
  const entry = {
    id: 'ce-current',
    taskId: 'task-special',
    teacher: 'Bound Teacher',
    cls: 'Special Class',
    scode: 'S1',
    student: 'Student One',
    ...overrides,
  };
  db.run(
    `INSERT INTO counsel_entries(
      id,task_id,teacher,cls,scode,student,phone,subject,content,synced,synced_at
    ) VALUES(?,?,?,?,?,?,?,?,?,0,'')`,
    entry.id, entry.taskId, entry.teacher, entry.cls, entry.scode, entry.student,
    entry.phone || '', entry.subject || '', entry.content || '',
  );
  return entry;
}

function naturalKey(entry, patch = {}) {
  return {
    taskId: entry.taskId,
    teacher: entry.teacher,
    cls: entry.cls,
    scode: entry.scode,
    ...patch,
  };
}

test('legacy counsel_entries receives delivery columns and completed rows backfill to confirmed', () => {
  withHarness(({ db, store }) => {
    const columns = db.all('PRAGMA table_info(counsel_entries)').map((column) => column.name);
    for (const column of [
      'delivery_state',
      'delivery_stage',
      'delivery_claim_token',
      'delivery_fingerprint',
      'delivery_date',
      'delivery_before_count',
      'delivery_attempted_at',
      'delivery_message',
    ]) assert.ok(columns.includes(column), `missing migration column ${column}`);

    const migrated = store.getCounselEntry('legacy-synced');
    assert.equal(migrated.synced, true);
    assert.equal(migrated.deliveryState, 'confirmed');
    assert.equal(migrated.deliveryStage, 'confirmed');
    assert.equal(migrated.deliveryConfirmed, true);
    assert.equal(migrated.deliveryBeforeCount, null);
    assert.deepEqual(migrated.delivery, {
      state: 'confirmed',
      stage: 'confirmed',
      fingerprint: '',
      date: '',
      beforeCount: null,
      attemptedAt: '',
      message: '',
      doNotRetransmit: false,
      safeToResetBeforePost: false,
    });

    const migratedPending = store.getCounselEntry('legacy-pending');
    assert.equal(migratedPending.deliveryState, 'pending');
    assert.equal(migratedPending.deliveryStage, 'posting', 'old pending rows may already have posted and must not become resettable');
    assert.equal(migratedPending.delivery.safeToResetBeforePost, false);
  }, {
    beforeInit(db) {
      db.db.exec(`
        CREATE TABLE counsel_entries (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          teacher TEXT NOT NULL,
          cls TEXT NOT NULL,
          scode TEXT NOT NULL,
          student TEXT NOT NULL,
          phone TEXT NOT NULL DEFAULT '',
          subject TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          synced INTEGER NOT NULL DEFAULT 0,
          synced_at TEXT NOT NULL DEFAULT '',
          done INTEGER NOT NULL DEFAULT 0,
          delivery_state TEXT NOT NULL DEFAULT 'idle',
          delivery_stage TEXT NOT NULL DEFAULT '',
          delivery_fingerprint TEXT NOT NULL DEFAULT '',
          delivery_date TEXT NOT NULL DEFAULT '',
          delivery_before_count INTEGER NOT NULL DEFAULT -1,
          delivery_attempted_at TEXT NOT NULL DEFAULT '',
          delivery_message TEXT NOT NULL DEFAULT '',
          UNIQUE (task_id, teacher, cls, scode)
        );
        INSERT INTO counsel_entries(
          id,task_id,teacher,cls,scode,student,subject,content,synced,synced_at
        ) VALUES(
          'legacy-synced','legacy-task','Bound Teacher','Legacy Class','LS1','Legacy Student',
          'Legacy subject','Legacy content',1,'2026-07-22 12:00'
        );
        INSERT INTO counsel_entries(
          id,task_id,teacher,cls,scode,student,subject,content,synced,synced_at,
          delivery_state,delivery_stage,delivery_fingerprint,delivery_date
        ) VALUES(
          'legacy-pending','legacy-task','Bound Teacher','Legacy Class','LS2','Pending Student',
          'Pending subject','Pending content',0,'','pending','claimed','legacy-fingerprint','2026-07-22'
        );
      `);
    },
  });
});

test('stale ids resolve only through the complete bound natural key and reject mismatches', () => withHarness(({ db, store }) => {
  const current = insertEntry(db);
  const other = insertEntry(db, {
    id: 'ce-other',
    scode: 'S2',
    student: 'Student Two',
  });

  const resolved = store.resolveCounselEntry('ce-stale-from-old-screen', naturalKey(current));
  assert.equal(resolved.id, current.id);
  assert.equal(resolved.scode, current.scode);
  assert.equal(store.resolveCounselEntry('ce-missing-without-key'), null);
  assert.throws(
    () => store.resolveCounselEntry(current.id, naturalKey(other)),
    /상담 대상 정보가 변경되었습니다/,
  );
  assert.throws(
    () => store.resolveCounselEntry('ce-stale', { taskId: current.taskId, teacher: current.teacher }),
    /확인 정보가 불완전합니다/,
  );
  assert.equal(
    store.resolveCounselEntry('ce-stale', naturalKey(current, { teacher: 'Another Teacher' })),
    null,
  );
}));

test('delivery state machine claims once, deduplicates same content, and blocks changed pending content', () => withHarness(({ db, store }) => {
  const current = insertEntry(db);
  const draft = {
    subject: 'Special greeting',
    content: 'Private counsel body',
    date: '2026-07-23',
    attemptedAt: '2026-07-23T01:02:03.000Z',
  };
  const expectedFingerprint = counselDeliveryFingerprint(draft);
  assert.match(expectedFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(expectedFingerprint.includes(draft.subject), false);
  assert.equal(expectedFingerprint.includes(draft.content), false);

  const first = store.beginCounselDelivery('stale-ui-id', naturalKey(current), draft);
  assert.equal(first.action, 'send');
  assert.match(first.claimToken, /^[0-9a-f-]{36}$/);
  assert.equal(first.entry.deliveryClaimToken, undefined, 'owner token is never exposed through mapped entries');
  assert.equal(db.get('SELECT delivery_claim_token token FROM counsel_entries WHERE id=?', current.id).token, first.claimToken);
  assert.equal(first.entry.id, current.id, 'the current id is returned after natural-key recovery');
  assert.equal(first.fingerprint, expectedFingerprint);
  assert.equal(first.entry.subject, draft.subject);
  assert.equal(first.entry.content, draft.content);
  assert.equal(first.entry.synced, false);
  assert.equal(first.entry.deliveryState, 'pending');
  assert.equal(first.entry.deliveryStage, 'claimed');
  assert.equal(first.entry.deliveryPending, true);
  assert.equal(first.entry.delivery.safeToResetBeforePost, true);
  assert.equal(first.entry.deliveryDate, draft.date);
  assert.equal(first.entry.deliveryAttemptedAt, draft.attemptedAt);

  const duplicate = store.beginCounselDelivery(current.id, naturalKey(current), draft);
  assert.equal(duplicate.action, 'pending');
  assert.equal(duplicate.claimToken, '', 'a duplicate requester never receives the owner token');
  assert.equal(duplicate.fingerprint, first.fingerprint);
  assert.throws(
    () => store.beginCounselDelivery(current.id, naturalKey(current), {
      ...draft,
      content: 'Changed while the first result is unknown',
    }),
    /내용 변경과 재전송을 할 수 없습니다/,
  );
  assert.throws(
    () => store.saveCounselDraft(current.id, draft.subject, 'Legacy mutation attempt'),
    /같은 상담을 다시 전송하거나 내용을 바꾸지 마세요/,
  );

  const posting = store.recordCounselDeliveryBeforePost(current.id, first.fingerprint, first.claimToken, {
    beforeCount: 3,
    message: 'ERP POST 직전 증거 저장',
  });
  assert.equal(posting.deliveryState, 'pending');
  assert.equal(posting.deliveryStage, 'posting');
  assert.equal(posting.deliveryBeforeCount, 3);
  assert.equal(posting.delivery.safeToResetBeforePost, false);
  assert.throws(
    () => store.resetCounselDeliveryBeforePost(current.id, first.fingerprint, first.claimToken),
    /전송이 시작되었을 수 있어 초기화하지 않았습니다/,
  );

  const indeterminate = store.markCounselDeliveryIndeterminate(current.id, first.fingerprint, {
    beforeCount: 3,
    message: 'ERP POST 후 조회 대기',
  });
  assert.equal(indeterminate.deliveryState, 'pending');
  assert.equal(indeterminate.deliveryStage, 'posting');
  assert.equal(indeterminate.deliveryBeforeCount, 3);
  assert.equal(indeterminate.deliveryMessage, 'ERP POST 후 조회 대기');

  const confirmed = store.confirmCounselDelivery(
    current.id,
    first.fingerprint,
    '07. 23. 10:05',
    { beforeCount: 3 },
  );
  assert.equal(confirmed.synced, true);
  assert.equal(confirmed.syncedAt, '07. 23. 10:05');
  assert.equal(confirmed.deliveryState, 'confirmed');
  assert.equal(confirmed.deliveryStage, 'confirmed');
  assert.equal(confirmed.deliveryConfirmed, true);
  assert.equal(confirmed.deliveryPending, false);
  assert.equal(confirmed.deliveryBeforeCount, 3);
  assert.equal(db.get('SELECT delivery_claim_token token FROM counsel_entries WHERE id=?', current.id).token, '');

  const confirmedDuplicate = store.beginCounselDelivery(current.id, naturalKey(current), draft);
  assert.equal(confirmedDuplicate.action, 'confirmed');
  assert.equal(confirmedDuplicate.claimToken, '');
  assert.equal(confirmedDuplicate.entry.synced, true);

  const changed = store.beginCounselDelivery(current.id, naturalKey(current), {
    ...draft,
    content: 'A deliberate corrected follow-up',
    attemptedAt: '2026-07-23T02:00:00.000Z',
  });
  assert.equal(changed.action, 'send');
  assert.notEqual(changed.fingerprint, first.fingerprint);
  assert.equal(changed.entry.synced, false);
  assert.equal(changed.entry.syncedAt, '');
  assert.equal(changed.entry.deliveryState, 'pending');
  assert.equal(changed.entry.deliveryStage, 'claimed');

  assert.throws(
    () => store.resetCounselDeliveryBeforePost(current.id, first.fingerprint, first.claimToken),
    /전송 상태가 변경되어 초기화하지 않았습니다/,
  );
  const reset = store.resetCounselDeliveryBeforePost(
    current.id,
    changed.fingerprint,
    changed.claimToken,
    'ERP POST 전에 폼을 열지 못했습니다.',
  );
  assert.equal(reset.deliveryState, 'idle');
  assert.equal(reset.deliveryStage, '');
  assert.equal(reset.deliveryFingerprint, '');
  assert.equal(reset.deliveryDate, '');
  assert.equal(reset.deliveryBeforeCount, null);
  assert.equal(reset.deliveryMessage, 'ERP POST 전에 폼을 열지 못했습니다.');
  assert.equal(reset.content, 'A deliberate corrected follow-up', 'the draft survives an explicit pre-POST reset');

  const retry = store.beginCounselDelivery(current.id, naturalKey(current), {
    ...draft,
    content: 'A deliberate corrected follow-up',
  });
  assert.equal(retry.action, 'send');
}));

test('normal roster reconciliation preserves a pending delivery row while removing other departed rows', () => withHarness(({ db, store }) => {
  const pending = insertEntry(db);
  insertEntry(db, { id: 'ce-departed-idle', scode: 'S2', student: 'Departed Student' });
  const attempt = store.beginCounselDelivery(pending.id, naturalKey(pending), {
    subject: 'Pending subject',
    content: 'May already be in ERP',
    date: '2026-07-23',
    attemptedAt: '2026-07-23T03:00:00.000Z',
  });
  assert.equal(attempt.action, 'send');
  store.recordCounselDeliveryBeforePost(pending.id, attempt.fingerprint, attempt.claimToken, { beforeCount: 0 });

  const rows = store.upsertCounselRoster(pending.taskId, pending.teacher, pending.cls, [
    { scode: 'S3', name: 'Current Student', phone: '010-0000-0000' },
  ]);
  assert.deepEqual(rows.map((entry) => entry.scode), ['S3', 'S1']);
  const preserved = rows.find((entry) => entry.scode === pending.scode);
  assert.equal(preserved.id, pending.id);
  assert.equal(preserved.deliveryState, 'pending');
  assert.equal(preserved.deliveryStage, 'posting');
  assert.equal(preserved.deliveryFingerprint, attempt.fingerprint);
  assert.equal(
    db.get('SELECT COUNT(*) count FROM counsel_entries WHERE id=?', 'ce-departed-idle').count,
    0,
  );
}));

test('normal roster reconciliation rolls back the whole class when one row update fails', () => withHarness(({ db, store }) => {
  const originalRun = db.run.bind(db);
  let inserts = 0;
  db.run = function failSecondInsert(sql, ...params) {
    if (String(sql).startsWith('INSERT INTO counsel_entries')) {
      inserts += 1;
      if (inserts === 2) throw new Error('simulated roster write failure');
    }
    return originalRun(sql, ...params);
  };
  try {
    assert.throws(
      () => store.upsertCounselRoster('task-atomic', 'Bound Teacher', 'Class Atomic', [
        { scode: 'S1', name: 'First', phone: '' },
        { scode: 'S2', name: 'Second', phone: '' },
      ]),
      /simulated roster write failure/,
    );
  } finally {
    db.run = originalRun;
  }
  assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries WHERE task_id=?', 'task-atomic').count, 0);
}));

test('two StoreService connections sharing one primary grant exactly one delivery claim', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npr-counsel-shared-primary-'));
  const previousCwd = process.cwd();
  let firstDb;
  let secondDb;
  try {
    process.chdir(root);
    firstDb = new DbService();
    firstDb.init();
    secondDb = new DbService();
    secondDb.init();
  } finally {
    process.chdir(previousCwd);
  }

  try {
    const current = insertEntry(firstDb);
    const firstStore = new StoreService(firstDb);
    const secondStore = new StoreService(secondDb);
    const draft = {
      subject: 'One primary claim',
      content: 'Only one Vercel replica may POST this body',
      date: '2026-07-23',
      attemptedAt: '2026-07-23T04:00:00.000Z',
    };

    const attempts = [
      firstStore.beginCounselDelivery(current.id, naturalKey(current), draft),
      secondStore.beginCounselDelivery(current.id, naturalKey(current), draft),
    ];
    assert.equal(attempts.filter((attempt) => attempt.action === 'send').length, 1);
    assert.equal(attempts.filter((attempt) => attempt.action === 'pending').length, 1);
    assert.equal(attempts[0].fingerprint, attempts[1].fingerprint);
    assert.equal(attempts[0].entry.deliveryStage, 'claimed');
    assert.equal(attempts[1].entry.deliveryStage, 'claimed');
    const winner = attempts.find((attempt) => attempt.action === 'send');
    const observer = attempts.find((attempt) => attempt.action === 'pending');
    assert.ok(winner.claimToken);
    assert.equal(observer.claimToken, '');
    assert.equal(
      firstDb.get('SELECT delivery_claim_token token FROM counsel_entries WHERE id=?', current.id).token,
      winner.claimToken,
    );
  } finally {
    try { secondDb.db.close(); } catch {}
    try { firstDb.db.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('claim lease blocks fresh recovery and rejects a zombie owner after stale CAS recovery', () => withHarness(({ db, store }) => {
  const current = insertEntry(db);
  const draftA = {
    subject: 'Lease protected claim',
    content: 'Same fingerprint across request A and B',
    date: '2026-07-23',
    attemptedAt: '2026-07-23T00:00:00.000Z',
  };

  const ownerA = store.beginCounselDelivery(current.id, naturalKey(current), draftA);
  assert.equal(ownerA.action, 'send');
  const observerB = store.beginCounselDelivery(current.id, naturalKey(current), draftA);
  assert.equal(observerB.action, 'pending');
  assert.equal(observerB.claimToken, '');

  const fresh = store.recoverStaleCounselDeliveryClaim(
    current.id,
    ownerA.fingerprint,
    '2026-07-23T00:02:59.999Z',
  );
  assert.equal(fresh.action, 'waiting');
  assert.equal(fresh.entry.deliveryStage, 'claimed');
  assert.equal(
    db.get('SELECT delivery_claim_token token FROM counsel_entries WHERE id=?', current.id).token,
    ownerA.claimToken,
  );

  const stale = store.recoverStaleCounselDeliveryClaim(
    current.id,
    ownerA.fingerprint,
    '2026-07-23T00:03:00.000Z',
  );
  assert.equal(stale.action, 'reset');
  assert.equal(stale.entry.deliveryState, 'idle');
  assert.equal(stale.entry.deliveryStage, '');
  const cleared = db.get(
    'SELECT delivery_claim_token token, delivery_attempted_at attemptedAt FROM counsel_entries WHERE id=?',
    current.id,
  );
  assert.deepEqual(cleared, { token: '', attemptedAt: '' });

  const ownerB = store.beginCounselDelivery(current.id, naturalKey(current), {
    ...draftA,
    attemptedAt: '2026-07-23T00:03:01.000Z',
  });
  assert.equal(ownerB.action, 'send');
  assert.notEqual(ownerB.claimToken, ownerA.claimToken);

  assert.throws(
    () => store.recordCounselDeliveryBeforePost(current.id, ownerA.fingerprint, ownerA.claimToken, { beforeCount: 0 }),
    /다른 요청이 이 상담 전송을 처리 중입니다/,
  );
  assert.throws(
    () => store.markCounselDeliveryIndeterminate(current.id, ownerA.fingerprint, {
      beforeCount: 0,
      claimToken: ownerA.claimToken,
    }),
    /다른 요청이 이 상담 전송을 처리 중입니다/,
  );
  assert.throws(
    () => store.markCounselDeliveryIndeterminate(current.id, ownerA.fingerprint, { beforeCount: 0 }),
    /다른 요청이 이 상담 전송을 처리 중입니다/,
  );
  assert.throws(
    () => store.resetCounselDeliveryBeforePost(current.id, ownerA.fingerprint, ownerA.claimToken),
    /전송이 시작되었을 수 있어 초기화하지 않았습니다/,
  );

  const posting = store.recordCounselDeliveryBeforePost(
    current.id,
    ownerB.fingerprint,
    ownerB.claimToken,
    { beforeCount: 0 },
  );
  assert.equal(posting.deliveryStage, 'posting');
  const idempotentOwner = store.recordCounselDeliveryBeforePost(
    current.id,
    ownerB.fingerprint,
    ownerB.claimToken,
    { beforeCount: 0 },
  );
  assert.equal(idempotentOwner.deliveryStage, 'posting');
  assert.throws(
    () => store.recordCounselDeliveryBeforePost(current.id, ownerA.fingerprint, ownerA.claimToken),
    /다른 요청이 이 상담 전송을 처리 중입니다/,
  );

  const reconciler = store.markCounselDeliveryIndeterminate(current.id, ownerB.fingerprint, {
    beforeCount: 0,
    message: 'token-less read-only reconcile may update posting evidence',
  });
  assert.equal(reconciler.deliveryStage, 'posting');
  const confirmed = store.confirmCounselDelivery(current.id, ownerB.fingerprint, '07. 23. 09:04', { beforeCount: 0 });
  assert.equal(confirmed.deliveryStage, 'confirmed');
  assert.equal(db.get('SELECT delivery_claim_token token FROM counsel_entries WHERE id=?', current.id).token, '');
}));

test('absence/text attempts are repeatable per student, idempotent per request, and counted after the ERP boundary', () => withHarness(({ db, store }) => {
  const entry = insertEntry(db);
  const draft = {
    content: '전화 연결이 되지 않아 문자로 안내했습니다.',
    date: '2026-07-23',
    requestId: 'absence-request-0001',
    attemptedAt: '2026-07-23T00:00:00.000Z',
  };
  const first = store.beginCounselAbsenceDelivery(entry.id, naturalKey(entry), draft, 'teacher:bound');
  assert.equal(first.action, 'send');
  assert.equal(first.attempt.kind, '부재/문자');
  assert.equal(first.attempt.deliveryStage, 'claimed');
  assert.equal(store.getCounselEntries(entry.taskId, entry.teacher)[0].absenceCount, 0);

  const same = store.beginCounselAbsenceDelivery(entry.id, naturalKey(entry), draft, 'teacher:bound');
  assert.equal(same.action, 'pending');
  assert.equal(same.attempt.id, first.attempt.id);
  assert.throws(
    () => store.beginCounselAbsenceDelivery(entry.id, naturalKey(entry), { ...draft, content: '다른 내용' }, 'teacher:bound'),
    /같은 부재 상담 요청 ID에 다른 내용을 사용할 수 없습니다/,
  );

  const posting = store.recordCounselAbsenceBeforePost(first.attempt.id, first.fingerprint, first.claimToken, { beforeCount: 2 });
  assert.equal(posting.deliveryStage, 'posting');
  let enriched = store.getCounselEntries(entry.taskId, entry.teacher)[0];
  assert.equal(enriched.absenceCount, 1);
  assert.equal(enriched.absencePendingCount, 1);

  const confirmed = store.confirmCounselAbsenceDelivery(first.attempt.id, first.fingerprint, '07. 23. 09:00', { beforeCount: 2 });
  assert.equal(confirmed.deliveryConfirmed, true);
  enriched = store.getCounselEntries(entry.taskId, entry.teacher)[0];
  assert.equal(enriched.absenceCount, 1);
  assert.equal(enriched.absencePendingCount, 0);
  assert.equal(enriched.absenceAttempts.length, 1);

  const second = store.beginCounselAbsenceDelivery(entry.id, naturalKey(entry), {
    ...draft,
    content: '두 번째 전화도 부재하여 다시 문자 안내했습니다.',
    requestId: 'absence-request-0002',
    attemptedAt: '2026-07-23T01:00:00.000Z',
  }, 'teacher:bound');
  store.recordCounselAbsenceBeforePost(second.attempt.id, second.fingerprint, second.claimToken, { beforeCount: 0 });
  store.confirmCounselAbsenceDelivery(second.attempt.id, second.fingerprint, '07. 23. 10:00', { beforeCount: 0 });
  enriched = store.getCounselEntries(entry.taskId, entry.teacher)[0];
  assert.equal(enriched.absenceCount, 2);
  assert.equal(enriched.absenceAttempts.length, 2);
}));

test('a second absence request id cannot claim the same student while a previous attempt is pending', () => withHarness(({ db, store }) => {
  const entry = insertEntry(db);
  const first = store.beginCounselAbsenceDelivery(entry.id, naturalKey(entry), {
    content: '첫 번째 부재 문자 안내',
    date: '2026-07-23',
    requestId: 'absence-request-race-0001',
    attemptedAt: '2026-07-23T00:00:00.000Z',
  }, 'teacher:bound');
  assert.equal(first.action, 'send');

  assert.throws(
    () => store.beginCounselAbsenceDelivery(entry.id, naturalKey(entry), {
      content: '다른 탭에서 만든 두 번째 부재 문자 안내',
      date: '2026-07-23',
      requestId: 'absence-request-race-0002',
      attemptedAt: '2026-07-23T00:00:01.000Z',
    }, 'teacher:bound'),
    /이 학생의 부재\/문자 전송 결과를 확인 중입니다/,
  );
  assert.equal(
    db.get("SELECT COUNT(*) count FROM counsel_absence_attempts WHERE entry_id=? AND delivery_state='pending'", entry.id).count,
    1,
    'only the first request may own the non-idempotent ERP POST boundary',
  );
}));

test('roster reconciliation preserves a departed student row while its absence delivery is pending', () => withHarness(({ db, store }) => {
  const entry = insertEntry(db);
  const attempt = store.beginCounselAbsenceDelivery(entry.id, naturalKey(entry), {
    content: '부재 문자 전송 결과 확인 중',
    date: '2026-07-23',
    requestId: 'absence-roster-pending-0001',
    attemptedAt: '2026-07-23T00:00:00.000Z',
  }, 'teacher:bound');
  store.recordCounselAbsenceBeforePost(attempt.attempt.id, attempt.fingerprint, attempt.claimToken, { beforeCount: 0 });

  const rows = store.upsertCounselRoster(entry.taskId, entry.teacher, entry.cls, [
    { scode: 'S2', name: 'Current Student', phone: '010-0000-0000' },
  ]);
  const preserved = rows.find((row) => row.id === entry.id);
  assert.ok(preserved, 'the counsel entry must remain reachable for absence reconciliation');
  assert.equal(preserved.absencePendingCount, 1);
  assert.equal(preserved.absenceAttempts[0].id, attempt.attempt.id);
  assert.equal(
    db.get(
      `SELECT COUNT(*) count
       FROM counsel_absence_attempts a
       LEFT JOIN counsel_entries e ON e.id=a.entry_id
       WHERE a.delivery_state='pending' AND e.id IS NULL`,
    ).count,
    0,
    'roster pruning must not orphan a pending absence attempt',
  );
}));

test('a pre-post absence failure is safely removed and a stale claim can be retried', () => withHarness(({ db, store }) => {
  const entry = insertEntry(db);
  const draft = {
    content: '부재 문자 안내',
    date: '2026-07-23',
    requestId: 'absence-request-0003',
    attemptedAt: '2026-07-23T00:00:00.000Z',
  };
  const first = store.beginCounselAbsenceDelivery(entry.id, naturalKey(entry), draft, 'teacher:bound');
  store.resetCounselAbsenceBeforePost(first.attempt.id, first.fingerprint, first.claimToken);
  assert.equal(db.get('SELECT COUNT(*) count FROM counsel_absence_attempts').count, 0);
  const retry = store.beginCounselAbsenceDelivery(entry.id, naturalKey(entry), draft, 'teacher:bound');
  assert.equal(retry.action, 'send');

  const fresh = store.recoverStaleCounselAbsenceClaim(retry.attempt.id, '2026-07-23T00:02:59.999Z');
  assert.equal(fresh.action, 'waiting');
  const stale = store.recoverStaleCounselAbsenceClaim(retry.attempt.id, '2026-07-23T00:03:00.000Z');
  assert.equal(stale.action, 'reset');
  assert.equal(db.get('SELECT COUNT(*) count FROM counsel_absence_attempts').count, 0);
}));

test('a stuck posting delivery can only be closed by an explicit human verdict', () => withHarness(({ db, store }) => {
  const current = insertEntry(db);
  const draft = {
    subject: '반배치고사',
    content: '반배치고사 결과 상담 내용',
    date: '2026-07-23',
    attemptedAt: '2026-07-23T01:02:03.000Z',
  };

  const claimed = store.beginCounselDelivery(current.id, naturalKey(current), draft);
  assert.equal(claimed.entry.deliveryStage, 'claimed');
  assert.throws(
    () => store.resolveStuckCounselDelivery(current.id, claimed.fingerprint, 'not-sent', 'Bound Teacher'),
    /「전송 결과 확인」을 먼저 눌러 주세요/,
    'a claim that never crossed the ERP POST boundary belongs to the lease recovery path',
  );

  store.recordCounselDeliveryBeforePost(current.id, claimed.fingerprint, claimed.claimToken, { beforeCount: 0 });
  assert.throws(
    () => store.resolveStuckCounselDelivery(current.id, 'f'.repeat(64), 'not-sent', 'Bound Teacher'),
    /상담 전송 상태가 변경되었습니다/,
    'a verdict from a different attempt must never release the current one',
  );
  assert.throws(
    () => store.resolveStuckCounselDelivery(current.id, claimed.fingerprint, 'maybe', 'Bound Teacher'),
    /전송 상태 처리 방식을 확인할 수 없습니다/,
  );

  const released = store.resolveStuckCounselDelivery(current.id, claimed.fingerprint, 'not-sent', 'Bound Teacher');
  assert.equal(released.deliveryState, 'idle');
  assert.equal(released.deliveryStage, '');
  assert.equal(released.deliveryPending, false);
  assert.equal(released.synced, false);
  assert.equal(released.subject, draft.subject, 'the draft survives so the teacher can resend the same counsel');
  assert.equal(released.content, draft.content);
  assert.match(released.deliveryMessage, /Bound Teacher가 통통통에 저장되지 않은 것을 직접 확인/);
  assert.equal(store.beginCounselDelivery(current.id, naturalKey(current), draft).action, 'send');
}));

test('a human who finds the counsel in the ERP closes it as sent without another POST', () => withHarness(({ db, store }) => {
  const current = insertEntry(db);
  const draft = {
    subject: '반배치고사',
    content: '반배치고사 결과 상담 내용',
    date: '2026-07-23',
    attemptedAt: '2026-07-23T01:02:03.000Z',
  };
  const claimed = store.beginCounselDelivery(current.id, naturalKey(current), draft);
  store.recordCounselDeliveryBeforePost(current.id, claimed.fingerprint, claimed.claimToken, { beforeCount: 1 });

  const confirmed = store.resolveStuckCounselDelivery(
    current.id, claimed.fingerprint, 'sent', 'Bound Teacher', '07-23 10:30',
  );
  assert.equal(confirmed.deliveryState, 'confirmed');
  assert.equal(confirmed.deliveryStage, 'confirmed');
  assert.equal(confirmed.synced, true);
  assert.equal(confirmed.syncedAt, '07-23 10:30');
  assert.match(confirmed.deliveryMessage, /직접 확인해 전송 완료로 표시/);
  assert.throws(
    () => store.resolveStuckCounselDelivery(current.id, claimed.fingerprint, 'not-sent', 'Bound Teacher'),
    /상담 전송 상태가 변경되었습니다/,
    'a closed delivery is never reopened by a second verdict',
  );
}));
