const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
process.env.APP_TODAY = '2026-07-24';
process.env.LEAD_ID = 'admin';
process.env.LEAD_PW = 'test-only';
process.env.LEAD_NAME = 'Test Lead';

const { DbService } = require('../src/db/db.service.ts');
const { StoreService } = require('../src/api/store.service.ts');

function createHarness({ beforeInit } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npr-counsel-roster-'));
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

function addTeacherAndTask(db) {
  db.run(
    `INSERT INTO teachers(tid,name,pw,classes,sort) VALUES(?,?,?,?,?)`,
    'alice', 'Alice', 'pw', JSON.stringify({
      월수금반: ['Regular Class'], 화목토반: [], '특강 월수금반': ['Old Class'], '특강 화목토반': [],
    }), 1,
  );
  db.run(
    `INSERT INTO tasks(
       id,title,descr,tag,start_date,due_date,scope,report_req,attach_req,mt,counsel,special_counsel,
       special_source_month,special_assignees,links,created_at,sort
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'[]',?,1)`,
    'task-special', 'Special counsel', '', '특강 상담', '2026-07-24', '2026-07-31',
    JSON.stringify(['Alice']), 0, 0, 0, 0, 1, '2026-06', JSON.stringify(['Alice']), '2026-07-24',
  );
}

function addRegularTeacherAndTask(db) {
  db.run(
    `INSERT INTO teachers(tid,name,pw,classes,sort) VALUES(?,?,?,?,?)`,
    'alice', 'Alice', 'pw', JSON.stringify({
      월수금반: ['Regular Class'], 화목토반: [], '특강 월수금반': [], '특강 화목토반': [],
    }), 1,
  );
  db.run(
    `INSERT INTO tasks(
       id,title,descr,tag,start_date,due_date,scope,report_req,attach_req,mt,counsel,special_counsel,
       special_source_month,special_assignees,links,created_at,sort
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'[]',?,1)`,
    'task-regular', 'Regular counsel', '', '상담', '2026-07-24', '2026-07-31',
    JSON.stringify(['Alice']), 0, 0, 0, 1, 0, '', '[]', '2026-07-24',
  );
}

function insertEntry(db, row) {
  db.run(
    `INSERT INTO counsel_entries(
       id,task_id,teacher,teacher_tid,cls,class_code,scode,student,phone,subject,content,synced,synced_at,
       delivery_state,delivery_stage,delivery_claim_token,delivery_fingerprint,delivery_date,
       roster_active,roster_source_month,roster_seen_at,roster_removed_at
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    row.id, row.taskId || 'task-special', 'Alice', row.teacherTid ?? 'alice', row.cls, row.classCode ?? 'C1',
    row.scode, row.student, row.phone || '', row.subject || '', row.content || '', row.synced || 0,
    row.syncedAt || '', row.deliveryState || 'idle', row.deliveryStage || '',
    row.claimToken || '', row.fingerprint || '', row.deliveryDate || '', row.active === false ? 0 : 1,
    row.sourceMonth || '2026-06', row.seenAt || '2026-06-01T00:00:00.000Z',
    row.active === false ? '2026-06-20T00:00:00.000Z' : '',
  );
}

test('legacy counsel roster receives stable identity and lifecycle columns without changing its history', () => {
  withHarness(({ db }) => {
    const columns = new Set(db.all('PRAGMA table_info(counsel_entries)').map((column) => column.name));
    for (const column of [
      'teacher_tid', 'class_code', 'roster_active', 'roster_source_month', 'roster_seen_at', 'roster_removed_at',
    ]) assert.ok(columns.has(column), `missing ${column}`);
    const row = db.get('SELECT * FROM counsel_entries WHERE id=?', 'legacy-entry');
    assert.equal(row.subject, 'Keep subject');
    assert.equal(row.content, 'Keep content');
    assert.equal(row.roster_active, 1);
    assert.equal(row.class_code, '');
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
          UNIQUE(task_id,teacher,cls,scode)
        );
        INSERT INTO counsel_entries(
          id,task_id,teacher,cls,scode,student,subject,content,synced,synced_at,done
        ) VALUES(
          'legacy-entry','legacy-task','Legacy Teacher','Legacy Class','S1','Legacy Student',
          'Keep subject','Keep content',1,'2026-06-01',1
        );
      `);
    },
  });
});

test('primary roster reconcile adds, inactivates, reactivates and renames without losing counsel history', () => {
  withHarness(({ db, store }) => {
    addTeacherAndTask(db);
    insertEntry(db, {
      id: 'confirmed', cls: 'Old Class', scode: 'S1', student: 'Old Name', phone: '111',
      subject: 'Confirmed subject', content: 'Confirmed content', synced: 1, syncedAt: '2026-06-12',
      deliveryState: 'confirmed', deliveryStage: 'confirmed', fingerprint: 'confirmed-fingerprint', deliveryDate: '2026-06-12',
    });
    insertEntry(db, {
      id: 'pending', cls: 'Old Class', scode: 'S2', student: 'Pending Student', phone: '222',
      subject: 'Pending subject', content: 'Pending content', deliveryState: 'pending', deliveryStage: 'posting',
      claimToken: 'pending-owner', fingerprint: 'pending-fingerprint', deliveryDate: '2026-06-13',
    });
    insertEntry(db, {
      id: 'departed', cls: 'Old Class', scode: 'S3', student: 'Departed Student', phone: '333',
      subject: 'Departed draft', content: 'Never delete this',
    });
    insertEntry(db, {
      id: 'returning', cls: 'New Class', scode: 'S4', student: 'Returning Student', phone: '444',
      active: false,
    });
    insertEntry(db, {
      id: 'legacy', teacherTid: '', cls: 'New Class', classCode: '', scode: 'S5', student: 'Legacy Student',
      subject: 'Legacy draft', content: 'Legacy content',
    });
    db.run(
      `INSERT INTO counsel_absence_attempts(
         id,entry_id,task_id,teacher,cls,scode,student,content,attempted_date,synced,synced_at,
         delivery_state,delivery_stage,delivery_fingerprint,created_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      'absence-confirmed', 'confirmed', 'task-special', 'Alice', 'Old Class', 'S1', 'Old Name',
      'No answer', '2026-06-12', 1, '2026-06-12', 'confirmed', 'confirmed', 'absence-fingerprint', '2026-06-12',
    );

    for (const [scode, phone] of [['S1', '111'], ['S4', '444'], ['S5', '']]) {
      db.run(
        `INSERT INTO special_class_roster(
           source_month,class_code,class_name,teacher_tid,teacher_name,day_group,scode,student,mother_phone,synced_at
         ) VALUES(?,?,?,?,?,'M',?,?,?,?)`,
        '2026-07', 'C1', 'New Class', 'alice', 'Alice', scode, `Cache ${scode}`, phone, '2026-07-24T09:00:00.000Z',
      );
    }

    let primaryCalls = 0;
    let refreshCalls = 0;
    const originalPrimary = db.withCounselRosterPrimary.bind(db);
    db.withCounselRosterPrimary = (operation) => {
      primaryCalls += 1;
      return originalPrimary(operation);
    };
    db.refreshCounselRosterReplica = () => { refreshCalls += 1; };

    const input = {
      taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special',
      sourceMonth: '2026-07', syncedAt: '2026-07-24T10:00:00.000Z',
      classes: [{
        classCode: 'C1', className: 'New Class', students: [
          { scode: 'S1', student: 'Current Name' },
          { scode: 'S4', student: 'Returning Student' },
          { scode: 'S5', student: 'Legacy Student' },
          { scode: 'S6', student: 'New Student' },
        ],
      }],
    };
    const first = store.reconcileCounselRosterSnapshotOnPrimary(input);
    assert.deepEqual({
      added: first.added, updated: first.updated, inactivated: first.inactivated, reactivated: first.reactivated,
      counts: first.counts,
    }, {
      added: 1, updated: 2, inactivated: 1, reactivated: 1,
      counts: { active: 5, inactive: 1, total: 6, classes: 1 },
    });
    assert.deepEqual(first.classes, ['New Class']);
    assert.deepEqual(first.entries.map((entry) => [entry.id, entry.classCode, entry.student, entry.rosterActive]), [
      ['confirmed', 'C1', 'Current Name', true],
      ['legacy', 'C1', 'Legacy Student', true],
      ['ce' + first.entries.find((entry) => entry.scode === 'S6').id.slice(2), 'C1', 'New Student', true],
      ['returning', 'C1', 'Returning Student', true],
      ['pending', 'C1', 'Pending Student', true],
    ]);

    const confirmed = db.get('SELECT * FROM counsel_entries WHERE id=?', 'confirmed');
    assert.equal(confirmed.subject, 'Confirmed subject');
    assert.equal(confirmed.content, 'Confirmed content');
    assert.equal(confirmed.phone, '111');
    assert.equal(confirmed.synced, 1);
    assert.equal(confirmed.delivery_state, 'confirmed');
    assert.equal(confirmed.delivery_fingerprint, 'confirmed-fingerprint');
    assert.deepEqual(
      db.get('SELECT teacher,cls,student,content,delivery_state FROM counsel_absence_attempts WHERE id=?', 'absence-confirmed'),
      { teacher: 'Alice', cls: 'New Class', student: 'Current Name', content: 'No answer', delivery_state: 'confirmed' },
    );
    const pending = db.get('SELECT * FROM counsel_entries WHERE id=?', 'pending');
    assert.equal(pending.roster_active, 1);
    assert.equal(pending.subject, 'Pending subject');
    assert.equal(pending.content, 'Pending content');
    assert.equal(pending.delivery_state, 'pending');
    assert.equal(pending.delivery_stage, 'posting');
    assert.equal(db.get('SELECT roster_active,content FROM counsel_entries WHERE id=?', 'departed').content, 'Never delete this');
    assert.equal(db.get('SELECT special_source_month FROM tasks WHERE id=?', 'task-special').special_source_month, '2026-07');
    assert.deepEqual(store.getCounselEntries('task-special', 'Alice').map((entry) => entry.scode).sort(), ['S1', 'S2', 'S4', 'S5', 'S6']);

    const stateTask = store.getState('lead', 'admin').tasks.find((task) => task.id === 'task-special');
    assert.deepEqual(stateTask.counselProg.Alice, {
      synced: 1, total: 5, absenceCount: 1, absencePendingCount: 0, noTarget: false,
    });

    db.run(
      `UPDATE counsel_entries SET delivery_state='confirmed',delivery_stage='confirmed'
       WHERE id='pending'`,
    );
    const second = store.reconcileCounselRosterSnapshotOnPrimary(input);
    assert.deepEqual(
      { added: second.added, updated: second.updated, inactivated: second.inactivated, reactivated: second.reactivated },
      { added: 0, updated: 0, inactivated: 1, reactivated: 0 },
      'a later snapshot may inactivate the unmatched row once its delivery is resolved',
    );
    const third = store.reconcileCounselRosterSnapshotOnPrimary(input);
    assert.deepEqual(
      { added: third.added, updated: third.updated, inactivated: third.inactivated, reactivated: third.reactivated },
      { added: 0, updated: 0, inactivated: 0, reactivated: 0 },
      'the resolved snapshot is idempotent',
    );

    const contacts = store.updateCounselRosterContactsOnPrimary({
      taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special', sourceMonth: '2026-07',
      syncedAt: '2026-07-24T10:05:00.000Z',
      contacts: [
        { classCode: 'C1', scode: 'S1', motherPhone: '', success: true },
        { classCode: 'C1', scode: 'S4', motherPhone: '999', success: false },
        { classCode: 'C1', scode: 'S5', motherPhone: '555', success: true },
        { classCode: 'C1', scode: 'missing', motherPhone: '000', success: true },
      ],
    });
    assert.deepEqual(
      { updated: contacts.updated, cleared: contacts.cleared, preserved: contacts.preserved, missing: contacts.missing },
      { updated: 2, cleared: 1, preserved: 1, missing: 1 },
    );
    assert.deepEqual(contacts.counts, { active: 4, total: 6, withPhone: 2, withoutPhone: 2 });
    assert.equal(db.get('SELECT phone FROM counsel_entries WHERE id=?', 'confirmed').phone, '');
    assert.equal(db.get('SELECT phone FROM counsel_entries WHERE id=?', 'returning').phone, '444');
    assert.equal(db.get('SELECT phone FROM counsel_entries WHERE id=?', 'legacy').phone, '555');
    assert.equal(db.get('SELECT mother_phone FROM special_class_roster WHERE source_month=? AND class_code=? AND scode=?', '2026-07', 'C1', 'S1').mother_phone, '');
    assert.equal(db.get('SELECT mother_phone FROM special_class_roster WHERE source_month=? AND class_code=? AND scode=?', '2026-07', 'C1', 'S4').mother_phone, '444');
    assert.equal(db.get('SELECT mother_phone FROM special_class_roster WHERE source_month=? AND class_code=? AND scode=?', '2026-07', 'C1', 'S5').mother_phone, '555');
    assert.equal(primaryCalls, 4);
    assert.equal(refreshCalls, 4);
  });
});

test('matched counsel-pending rows update only roster lifecycle, then apply deferred identity after resolution', () => withHarness(({ db, store }) => {
  addTeacherAndTask(db);
  insertEntry(db, {
    id: 'locked-stable', cls: 'Old Class', classCode: 'C1', scode: 'S1', student: 'Old Student',
    deliveryState: 'pending', deliveryStage: 'posting', claimToken: 'pending-owner-1',
    fingerprint: 'locked-stable-fingerprint', deliveryDate: '2026-07-24',
  });
  insertEntry(db, {
    id: 'locked-legacy', teacherTid: '', cls: 'Legacy Class', classCode: '', scode: 'S2', student: 'Old Legacy',
    deliveryState: 'pending', deliveryStage: 'posting', claimToken: 'pending-owner-2',
    fingerprint: 'locked-legacy-fingerprint', deliveryDate: '2026-07-24',
  });
  db.run(
    `INSERT INTO counsel_absence_attempts(
       id,entry_id,task_id,teacher,cls,scode,student,content,attempted_date,synced,synced_at,
       delivery_state,delivery_stage,delivery_fingerprint,created_at
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    'locked-confirmed-history', 'locked-stable', 'task-special', 'Alice', 'Old Class', 'S1', 'Old Student',
    'Historical absence', '2026-07-20', 1, '2026-07-20', 'confirmed', 'confirmed',
    'locked-confirmed-history-fingerprint', '2026-07-20',
  );
  const input = {
    taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special',
    sourceMonth: '2026-07', syncedAt: '2026-07-24T14:00:00.000Z',
    classes: [
      { classCode: 'C1', className: 'New Class', students: [{ scode: 'S1', student: 'New Student' }] },
      { classCode: 'C2', className: 'Legacy Class', students: [{ scode: 'S2', student: 'New Legacy' }] },
    ],
  };

  const locked = store.reconcileCounselRosterSnapshotOnPrimary(input);
  assert.equal(locked.updated, 0);
  assert.deepEqual(
    db.get(`SELECT teacher,teacher_tid,cls,class_code,student,roster_active,roster_source_month,roster_seen_at
            FROM counsel_entries WHERE id='locked-stable'`),
    {
      teacher: 'Alice', teacher_tid: 'alice', cls: 'Old Class', class_code: 'C1', student: 'Old Student',
      roster_active: 1, roster_source_month: '2026-07', roster_seen_at: '2026-07-24T14:00:00.000Z',
    },
  );
  assert.deepEqual(
    db.get(`SELECT teacher,teacher_tid,cls,class_code,student,roster_active,roster_source_month,roster_seen_at
            FROM counsel_entries WHERE id='locked-legacy'`),
    {
      teacher: 'Alice', teacher_tid: '', cls: 'Legacy Class', class_code: '', student: 'Old Legacy',
      roster_active: 1, roster_source_month: '2026-07', roster_seen_at: '2026-07-24T14:00:00.000Z',
    },
  );
  assert.deepEqual(
    db.get(`SELECT teacher,cls,student FROM counsel_absence_attempts WHERE id='locked-confirmed-history'`),
    { teacher: 'Alice', cls: 'Old Class', student: 'Old Student' },
  );

  db.run(
    `UPDATE counsel_entries SET delivery_state='confirmed',delivery_stage='confirmed',synced=1
     WHERE id IN ('locked-stable','locked-legacy')`,
  );
  const resolved = store.reconcileCounselRosterSnapshotOnPrimary({
    ...input,
    syncedAt: '2026-07-24T15:00:00.000Z',
  });
  assert.equal(resolved.updated, 2);
  assert.deepEqual(
    db.get(`SELECT cls,class_code,student FROM counsel_entries WHERE id='locked-stable'`),
    { cls: 'New Class', class_code: 'C1', student: 'New Student' },
  );
  assert.deepEqual(
    db.get(`SELECT teacher_tid,cls,class_code,student FROM counsel_entries WHERE id='locked-legacy'`),
    { teacher_tid: 'alice', cls: 'Legacy Class', class_code: 'C2', student: 'New Legacy' },
  );
  assert.deepEqual(
    db.get(`SELECT teacher,cls,student FROM counsel_absence_attempts WHERE id='locked-confirmed-history'`),
    { teacher: 'Alice', cls: 'New Class', student: 'New Student' },
  );
}));

test('special counsel pending restores only its missing contact class code and stays idempotent', () => withHarness(({ db, store }) => {
  addTeacherAndTask(db);
  insertEntry(db, {
    id: 'pending-missing-class-code', cls: 'Current Class', classCode: '', scode: 'S1', student: 'Old Student',
    subject: 'Keep subject', content: 'Keep content', deliveryState: 'pending', deliveryStage: 'posting',
    claimToken: 'pending-owner', fingerprint: 'pending-fingerprint', deliveryDate: '2026-07-24',
  });
  const input = {
    taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special',
    sourceMonth: '2026-07', syncedAt: '2026-07-24T14:00:00.000Z',
    classes: [{ classCode: 'C9', className: 'Current Class', students: [{ scode: 'S1', student: 'Renamed Student' }] }],
  };

  const first = store.reconcileCounselRosterSnapshotOnPrimary(input);
  assert.equal(first.updated, 1);
  assert.deepEqual(
    db.get(`SELECT teacher,teacher_tid,cls,class_code,scode,student,subject,content,delivery_state,delivery_stage,
                   delivery_claim_token,delivery_fingerprint,delivery_date,roster_source_month,roster_seen_at
            FROM counsel_entries WHERE id='pending-missing-class-code'`),
    {
      teacher: 'Alice', teacher_tid: 'alice', cls: 'Current Class', class_code: 'C9', scode: 'S1',
      student: 'Old Student', subject: 'Keep subject', content: 'Keep content', delivery_state: 'pending',
      delivery_stage: 'posting', delivery_claim_token: 'pending-owner', delivery_fingerprint: 'pending-fingerprint',
      delivery_date: '2026-07-24', roster_source_month: '2026-07', roster_seen_at: '2026-07-24T14:00:00.000Z',
    },
  );

  const repeated = store.reconcileCounselRosterSnapshotOnPrimary({
    ...input,
    syncedAt: '2026-07-24T14:05:00.000Z',
  });
  assert.equal(repeated.updated, 0);
  assert.equal(db.get('SELECT student FROM counsel_entries WHERE id=?', 'pending-missing-class-code').student, 'Old Student');

  db.run(
    `UPDATE counsel_entries SET delivery_state='confirmed',delivery_stage='confirmed',synced=1
     WHERE id='pending-missing-class-code'`,
  );
  const resolved = store.reconcileCounselRosterSnapshotOnPrimary({
    ...input,
    syncedAt: '2026-07-24T15:00:00.000Z',
  });
  assert.equal(resolved.updated, 1);
  assert.deepEqual(
    db.get('SELECT class_code,student,subject,content,delivery_fingerprint FROM counsel_entries WHERE id=?', 'pending-missing-class-code'),
    {
      class_code: 'C9', student: 'Renamed Student', subject: 'Keep subject', content: 'Keep content',
      delivery_fingerprint: 'pending-fingerprint',
    },
  );
}));

test('special absence pending restores only its missing contact class code', () => withHarness(({ db, store }) => {
  addTeacherAndTask(db);
  insertEntry(db, {
    id: 'absence-missing-class-code', cls: 'Current Class', classCode: '', scode: 'S1', student: 'Old Student',
  });
  db.run(
    `INSERT INTO counsel_absence_attempts(
       id,entry_id,task_id,teacher,cls,scode,student,content,attempted_date,
       delivery_state,delivery_stage,delivery_fingerprint,created_at
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    'absence-missing-class-code-pending', 'absence-missing-class-code', 'task-special', 'Alice',
    'Current Class', 'S1', 'Old Student', 'Keep absence', '2026-07-24', 'pending', 'posting',
    'absence-pending-fingerprint', '2026-07-24T14:00:00.000Z',
  );
  const input = {
    taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special',
    sourceMonth: '2026-07', syncedAt: '2026-07-24T14:30:00.000Z',
    classes: [{ classCode: 'C8', className: 'Current Class', students: [{ scode: 'S1', student: 'Renamed Student' }] }],
  };

  const first = store.reconcileCounselRosterSnapshotOnPrimary(input);
  assert.equal(first.updated, 1);
  assert.deepEqual(
    db.get('SELECT cls,class_code,student FROM counsel_entries WHERE id=?', 'absence-missing-class-code'),
    { cls: 'Current Class', class_code: 'C8', student: 'Old Student' },
  );
  assert.deepEqual(
    db.get('SELECT cls,scode,student,content,delivery_state,delivery_fingerprint FROM counsel_absence_attempts WHERE id=?', 'absence-missing-class-code-pending'),
    {
      cls: 'Current Class', scode: 'S1', student: 'Old Student', content: 'Keep absence',
      delivery_state: 'pending', delivery_fingerprint: 'absence-pending-fingerprint',
    },
  );

  const repeated = store.reconcileCounselRosterSnapshotOnPrimary({
    ...input,
    syncedAt: '2026-07-24T14:35:00.000Z',
  });
  assert.equal(repeated.updated, 0);

  db.run(
    `UPDATE counsel_absence_attempts SET delivery_state='confirmed',delivery_stage='confirmed',synced=1
     WHERE id='absence-missing-class-code-pending'`,
  );
  const resolved = store.reconcileCounselRosterSnapshotOnPrimary({
    ...input,
    syncedAt: '2026-07-24T15:30:00.000Z',
  });
  assert.equal(resolved.updated, 1);
  assert.equal(db.get('SELECT student FROM counsel_entries WHERE id=?', 'absence-missing-class-code').student, 'Renamed Student');
  assert.deepEqual(
    db.get('SELECT student,content,delivery_fingerprint FROM counsel_absence_attempts WHERE id=?', 'absence-missing-class-code-pending'),
    { student: 'Renamed Student', content: 'Keep absence', delivery_fingerprint: 'absence-pending-fingerprint' },
  );
}));

test('matched absence-pending rows defer entry and attempt identity until the absence resolves', () => withHarness(({ db, store }) => {
  addTeacherAndTask(db);
  insertEntry(db, {
    id: 'absence-identity-lock', cls: 'Old Class', classCode: 'C1', scode: 'S1', student: 'Old Student',
  });
  db.run(
    `INSERT INTO counsel_absence_attempts(
       id,entry_id,task_id,teacher,cls,scode,student,content,attempted_date,
       delivery_state,delivery_stage,delivery_fingerprint,created_at
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    'absence-identity-pending', 'absence-identity-lock', 'task-special', 'Alice', 'Old Class', 'S1', 'Old Student',
    'Pending absence', '2026-07-24', 'pending', 'posting', 'absence-identity-fingerprint', '2026-07-24T14:00:00.000Z',
  );
  const input = {
    taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special',
    sourceMonth: '2026-07', syncedAt: '2026-07-24T14:30:00.000Z',
    classes: [{ classCode: 'C1', className: 'New Class', students: [{ scode: 'S1', student: 'New Student' }] }],
  };

  const locked = store.reconcileCounselRosterSnapshotOnPrimary(input);
  assert.equal(locked.updated, 0);
  assert.deepEqual(
    db.get(`SELECT cls,class_code,student,roster_source_month,roster_seen_at
            FROM counsel_entries WHERE id='absence-identity-lock'`),
    {
      cls: 'Old Class', class_code: 'C1', student: 'Old Student',
      roster_source_month: '2026-07', roster_seen_at: '2026-07-24T14:30:00.000Z',
    },
  );
  assert.deepEqual(
    db.get(`SELECT cls,student FROM counsel_absence_attempts WHERE id='absence-identity-pending'`),
    { cls: 'Old Class', student: 'Old Student' },
  );

  db.run(
    `UPDATE counsel_absence_attempts SET delivery_state='confirmed',delivery_stage='confirmed',synced=1
     WHERE id='absence-identity-pending'`,
  );
  const resolved = store.reconcileCounselRosterSnapshotOnPrimary({
    ...input,
    syncedAt: '2026-07-24T15:30:00.000Z',
  });
  assert.equal(resolved.updated, 1);
  assert.deepEqual(
    db.get(`SELECT cls,class_code,student FROM counsel_entries WHERE id='absence-identity-lock'`),
    { cls: 'New Class', class_code: 'C1', student: 'New Student' },
  );
  assert.deepEqual(
    db.get(`SELECT cls,student FROM counsel_absence_attempts WHERE id='absence-identity-pending'`),
    { cls: 'New Class', student: 'New Student' },
  );
}));

test('invalid contact month rolls back without clearing a known phone', () => withHarness(({ db, store }) => {
  addTeacherAndTask(db);
  insertEntry(db, {
    id: 'known-phone', cls: 'Current Class', classCode: 'C1', scode: 'S1', student: 'Student', phone: '01012345678',
    sourceMonth: '2026-06',
  });
  assert.throws(() => store.updateCounselRosterContactsOnPrimary({
    taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special', sourceMonth: '2026-07',
    contacts: [{ classCode: 'C1', scode: 'S1', motherPhone: '', success: true }],
  }), /수강년월이 변경/);
  assert.equal(db.get('SELECT phone FROM counsel_entries WHERE id=?', 'known-phone').phone, '01012345678');
}));

test('regular primary snapshot exposes its one active roster month and rejects mixed active months', () => withHarness(({ db, store }) => {
  db.run(
    `INSERT INTO teachers(tid,name,pw,classes,sort) VALUES(?,?,?,?,?)`,
    'alice', 'Alice', 'pw', JSON.stringify({
      월수금반: ['Old Manual Class'], 화목토반: [], '특강 월수금반': [], '특강 화목토반': [],
    }), 1,
  );
  db.run(
    `INSERT INTO tasks(
       id,title,descr,tag,start_date,due_date,scope,report_req,attach_req,mt,counsel,special_counsel,
       special_source_month,special_assignees,links,created_at,sort
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'[]',?,1)`,
    'task-regular', 'Regular counsel', '', '상담', '2026-07-24', '2026-07-31',
    JSON.stringify(['Alice']), 0, 0, 0, 1, 0, '', '[]', '2026-07-24',
  );
  store.reconcileCounselRosterSnapshotOnPrimary({
    taskId: 'task-regular', teacher: 'Alice', teacherTid: 'alice', kind: 'regular',
    sourceMonth: '2026-07', syncedAt: '2026-07-24T12:00:00.000Z',
    classes: [{
      classCode: 'R1', className: 'Current ERP Class',
      students: [{ scode: 'S1', student: 'One' }, { scode: 'S2', student: 'Two' }],
    }],
  });
  const snapshot = store.getCounselSnapshotOnPrimary('task-regular', 'Alice');
  assert.equal(snapshot.kind, 'regular');
  assert.equal(snapshot.sourceMonth, '2026-07');
  assert.deepEqual(snapshot.classes, ['Current ERP Class']);
  assert.equal(snapshot.entries.length, 2);
  const contacts = store.updateCounselRosterContactsOnPrimary({
    taskId: 'task-regular', teacher: 'Alice', teacherTid: 'alice', kind: 'regular', sourceMonth: snapshot.sourceMonth,
    contacts: [{ classCode: 'R1', scode: 'S1', motherPhone: '01011112222', success: true }],
  });
  assert.equal(contacts.updated, 1);
  assert.equal(db.get(`SELECT phone FROM counsel_entries WHERE task_id='task-regular' AND scode='S1'`).phone, '01011112222');

  db.run(
    `UPDATE counsel_entries SET roster_source_month='2026-06'
     WHERE task_id='task-regular' AND scode='S2'`,
  );
  assert.throws(
    () => store.getCounselSnapshotOnPrimary('task-regular', 'Alice'),
    /수강년월이 서로 다릅니다/,
  );
}));

test('regular primary reconcile requires a verified membership signature only for rows it will actually inactivate', () => withHarness(({ db, store }) => {
  addRegularTeacherAndTask(db);
  insertEntry(db, {
    taskId: 'task-regular', id: 'kept-by-natural', cls: 'Regular Class',
    classCode: 'OLD-CODE', scode: 'S1', student: 'One', sourceMonth: '2026-07',
  });
  insertEntry(db, {
    taskId: 'task-regular', id: 'removed', cls: 'Regular Class',
    classCode: 'OLD-CODE', scode: 'S2', student: 'Two', sourceMonth: '2026-07',
  });

  const membership = store.getActiveCounselRosterMembershipOnPrimary({
    taskId: 'task-regular', teacher: 'Alice', teacherTid: 'alice', kind: 'regular',
  });
  assert.deepEqual(membership, [
    { classCode: 'OLD-CODE', className: 'Regular Class', scode: 'S1' },
    { classCode: 'OLD-CODE', className: 'Regular Class', scode: 'S2' },
  ]);

  const input = {
    taskId: 'task-regular', teacher: 'Alice', teacherTid: 'alice', kind: 'regular',
    sourceMonth: '2026-07', syncedAt: '2026-07-24T17:00:00.000Z',
    classes: [{
      classCode: 'NEW-CODE', className: 'Regular Class',
      students: [{ scode: 'S1', student: 'One Updated' }],
    }],
  };
  for (const confirmedRemovalSignature of [undefined, 'wrong-signature']) {
    assert.throws(
      () => store.reconcileCounselRosterSnapshotOnPrimary({ ...input, confirmedRemovalSignature }),
      (error) => error.status === 409 && /2회 확인/.test(error.message),
    );
    assert.deepEqual(
      db.all(`SELECT id,class_code,student,roster_active FROM counsel_entries WHERE task_id='task-regular' ORDER BY id`),
      [
        { id: 'kept-by-natural', class_code: 'OLD-CODE', student: 'One', roster_active: 1 },
        { id: 'removed', class_code: 'OLD-CODE', student: 'Two', roster_active: 1 },
      ],
    );
  }

  const confirmedRemovalSignature = store.counselRosterMembershipSignature([
    { classCode: 'NEW-CODE', scode: 'S1' },
  ]);
  const result = store.reconcileCounselRosterSnapshotOnPrimary({ ...input, confirmedRemovalSignature });
  assert.equal(result.inactivated, 1);
  assert.deepEqual(
    db.all(`SELECT id,class_code,student,roster_active FROM counsel_entries WHERE task_id='task-regular' ORDER BY id`),
    [
      { id: 'kept-by-natural', class_code: 'NEW-CODE', student: 'One Updated', roster_active: 1 },
      { id: 'removed', class_code: 'OLD-CODE', student: 'Two', roster_active: 0 },
    ],
  );
}));

test('a monthly class-code replacement reuses the unique class-name and student history', () => withHarness(({ db, store }) => {
  addTeacherAndTask(db);
  insertEntry(db, {
    id: 'renewed-class', cls: 'Same Class', classCode: 'OLD-CODE', scode: 'S1', student: 'Student',
    phone: '01012345678', subject: 'Keep subject', content: 'Keep content',
  });

  const result = store.reconcileCounselRosterSnapshotOnPrimary({
    taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special',
    sourceMonth: '2026-07', syncedAt: '2026-07-24T16:00:00.000Z',
    classes: [{ classCode: 'NEW-CODE', className: 'Same Class', students: [{ scode: 'S1', student: 'Student' }] }],
  });

  assert.deepEqual(
    { added: result.added, updated: result.updated, inactivated: result.inactivated, total: result.counts.total },
    { added: 0, updated: 1, inactivated: 0, total: 1 },
  );
  assert.deepEqual(
    db.get(`SELECT id,class_code,phone,subject,content FROM counsel_entries WHERE task_id='task-special'`),
    {
      id: 'renewed-class', class_code: 'NEW-CODE', phone: '01012345678',
      subject: 'Keep subject', content: 'Keep content',
    },
  );
}));

test('natural-key fallback fails closed when historical candidates are ambiguous', () => withHarness(({ db, store }) => {
  addTeacherAndTask(db);
  insertEntry(db, {
    id: 'ambiguous-current-name', cls: 'Same Class', classCode: 'OLD-A', scode: 'S1', student: 'Student',
    content: 'First history',
  });
  db.run(
    `INSERT INTO counsel_entries(
       id,task_id,teacher,teacher_tid,cls,class_code,scode,student,content,roster_active,roster_source_month
     ) VALUES(?,?,?,?,?,?,?,?,?,1,?)`,
    'ambiguous-former-name', 'task-special', 'Former Alice', 'alice', 'Same Class', 'OLD-B', 'S1', 'Student',
    'Second history', '2026-06',
  );

  assert.throws(
    () => store.reconcileCounselRosterSnapshotOnPrimary({
      taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special',
      sourceMonth: '2026-07', syncedAt: '2026-07-24T16:00:00.000Z',
      classes: [{ classCode: 'NEW-CODE', className: 'Same Class', students: [{ scode: 'S1', student: 'Student' }] }],
    }),
    (error) => error.status === 409 && /유일하게/.test(error.message),
  );
  assert.deepEqual(
    db.all(`SELECT id,class_code,content,roster_source_month FROM counsel_entries WHERE task_id='task-special' ORDER BY id`),
    [
      { id: 'ambiguous-current-name', class_code: 'OLD-A', content: 'First history', roster_source_month: '2026-06' },
      { id: 'ambiguous-former-name', class_code: 'OLD-B', content: 'Second history', roster_source_month: '2026-06' },
    ],
  );
  assert.equal(db.get(`SELECT special_source_month FROM tasks WHERE id='task-special'`).special_source_month, '2026-06');
}));

test('stable-key matching fails closed when historical candidates are ambiguous', () => withHarness(({ db, store }) => {
  addTeacherAndTask(db);
  insertEntry(db, {
    id: 'stable-first', cls: 'Old Name A', classCode: 'SAME-CODE', scode: 'S1', student: 'Student',
    content: 'First history',
  });
  db.run(
    `INSERT INTO counsel_entries(
       id,task_id,teacher,teacher_tid,cls,class_code,scode,student,content,roster_active,roster_source_month
     ) VALUES(?,?,?,?,?,?,?,?,?,1,?)`,
    'stable-second', 'task-special', 'Alice', 'alice', 'Old Name B', 'SAME-CODE', 'S1', 'Student',
    'Second history', '2026-06',
  );

  assert.throws(
    () => store.reconcileCounselRosterSnapshotOnPrimary({
      taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special',
      sourceMonth: '2026-07', syncedAt: '2026-07-24T16:00:00.000Z',
      classes: [{ classCode: 'SAME-CODE', className: 'Current Name', students: [{ scode: 'S1', student: 'Student' }] }],
    }),
    (error) => error.status === 409 && /반 코드·학생을 유일하게/.test(error.message),
  );
  assert.deepEqual(
    db.all(`SELECT id,cls,content,roster_source_month FROM counsel_entries WHERE task_id='task-special' ORDER BY id`),
    [
      { id: 'stable-first', cls: 'Old Name A', content: 'First history', roster_source_month: '2026-06' },
      { id: 'stable-second', cls: 'Old Name B', content: 'Second history', roster_source_month: '2026-06' },
    ],
  );
}));

test('incoming duplicate class names with different codes fail before any roster mutation', () => withHarness(({ db, store }) => {
  addTeacherAndTask(db);
  assert.throws(
    () => store.reconcileCounselRosterSnapshotOnPrimary({
      taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special',
      sourceMonth: '2026-07', syncedAt: '2026-07-24T16:00:00.000Z',
      classes: [
        { classCode: 'C1', className: 'Duplicate Name', students: [{ scode: 'S1', student: 'One' }] },
        { classCode: 'C2', className: 'Duplicate Name', students: [{ scode: 'S2', student: 'Two' }] },
      ],
    }),
    (error) => error.status === 409 && /서로 다른 반 코드/.test(error.message),
  );
  assert.equal(db.get(`SELECT COUNT(*) count FROM counsel_entries WHERE task_id='task-special'`).count, 0);
  assert.equal(db.get(`SELECT special_source_month FROM tasks WHERE id='task-special'`).special_source_month, '2026-06');
}));

test('an explicitly validated zero-target snapshot inactivates rows but keeps their stored history', () => withHarness(({ db, store }) => {
  addTeacherAndTask(db);
  insertEntry(db, {
    id: 'only-student', cls: 'Old Class', classCode: 'C1', scode: 'S1', student: 'Student',
    phone: '01000000000', subject: 'Draft subject', content: 'Draft content',
  });
  const result = store.reconcileCounselRosterSnapshotOnPrimary({
    taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special',
    sourceMonth: '2026-07', syncedAt: '2026-07-24T13:00:00.000Z', classes: [],
  });
  assert.deepEqual(result.counts, { active: 0, inactive: 1, total: 1, classes: 0 });
  assert.equal(result.inactivated, 1);
  assert.deepEqual(result.entries, []);
  assert.deepEqual(
    db.get('SELECT roster_active,phone,subject,content FROM counsel_entries WHERE id=?', 'only-student'),
    { roster_active: 0, phone: '01000000000', subject: 'Draft subject', content: 'Draft content' },
  );
  const stateTask = store.getState('lead', 'admin').tasks.find((task) => task.id === 'task-special');
  assert.deepEqual(stateTask.counselProg.Alice, {
    synced: 0, total: 0, absenceCount: 0, absencePendingCount: 0, noTarget: true,
  });
  assert.equal(stateTask.doneCount, 1);
}));

test('an unmatched pending counsel delivery stays active until a resolved snapshot can inactivate it', () => withHarness(({ db, store }) => {
  addTeacherAndTask(db);
  insertEntry(db, {
    id: 'counsel-pending-entry', cls: 'Old Class', classCode: 'C1', scode: 'S1', student: 'Student',
    deliveryState: 'pending', deliveryStage: 'posting', claimToken: 'pending-owner',
    fingerprint: 'counsel-pending-fingerprint', deliveryDate: '2026-07-24',
  });
  const input = {
    taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special',
    sourceMonth: '2026-07', syncedAt: '2026-07-24T11:00:00.000Z', classes: [],
  };

  const pending = store.reconcileCounselRosterSnapshotOnPrimary(input);
  assert.equal(pending.inactivated, 0);
  assert.deepEqual(pending.counts, { active: 1, inactive: 0, total: 1, classes: 0 });
  assert.equal(pending.entries[0].deliveryState, 'pending');
  const pendingTask = store.getState('lead', 'admin').tasks.find((task) => task.id === 'task-special');
  assert.equal(pendingTask.counselProg.Alice.noTarget, false);

  db.run(
    `UPDATE counsel_entries
     SET delivery_state='confirmed',delivery_stage='confirmed',synced=1
     WHERE id='counsel-pending-entry'`,
  );
  const resolved = store.reconcileCounselRosterSnapshotOnPrimary({
    ...input,
    syncedAt: '2026-07-24T12:00:00.000Z',
  });
  assert.equal(resolved.inactivated, 1);
  assert.deepEqual(resolved.counts, { active: 0, inactive: 1, total: 1, classes: 0 });
  assert.deepEqual(resolved.entries, []);
}));

test('an unmatched pending absence attempt keeps its entry active until a resolved snapshot can inactivate it', () => withHarness(({ db, store }) => {
  addTeacherAndTask(db);
  insertEntry(db, {
    id: 'absence-pending-entry', cls: 'Old Class', classCode: 'C1', scode: 'S1', student: 'Student',
  });
  db.run(
    `INSERT INTO counsel_absence_attempts(
       id,entry_id,task_id,teacher,cls,scode,student,content,attempted_date,
       delivery_state,delivery_stage,delivery_fingerprint,created_at
     ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    'absence-pending', 'absence-pending-entry', 'task-special', 'Alice', 'Old Class', 'S1', 'Student',
    'No answer', '2026-07-24', 'pending', 'posting', 'absence-pending-fingerprint', '2026-07-24T10:00:00.000Z',
  );
  const input = {
    taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special',
    sourceMonth: '2026-07', syncedAt: '2026-07-24T11:00:00.000Z', classes: [],
  };

  const pending = store.reconcileCounselRosterSnapshotOnPrimary(input);
  assert.equal(pending.inactivated, 0);
  assert.deepEqual(pending.counts, { active: 1, inactive: 0, total: 1, classes: 0 });
  assert.equal(pending.entries[0].id, 'absence-pending-entry');
  assert.equal(pending.entries[0].absencePendingCount, 1);
  const pendingTask = store.getState('lead', 'admin').tasks.find((task) => task.id === 'task-special');
  assert.equal(pendingTask.counselProg.Alice.noTarget, false);

  db.run(
    `UPDATE counsel_absence_attempts
     SET delivery_state='confirmed',delivery_stage='confirmed',synced=1
     WHERE id='absence-pending'`,
  );
  const resolved = store.reconcileCounselRosterSnapshotOnPrimary({
    ...input,
    syncedAt: '2026-07-24T12:00:00.000Z',
  });
  assert.equal(resolved.inactivated, 1);
  assert.deepEqual(resolved.counts, { active: 0, inactive: 1, total: 1, classes: 0 });
  assert.deepEqual(resolved.entries, []);
}));

test('roster reconcile refuses to claim legacy rows when an exact teacher name is not unique', () => withHarness(({ db, store }) => {
  addTeacherAndTask(db);
  db.run(
    `INSERT INTO teachers(tid,name,pw,classes,sort) VALUES(?,?,?,?,?)`,
    'alice-duplicate', 'Alice', 'pw', JSON.stringify({}), 2,
  );
  insertEntry(db, {
    id: 'ambiguous-legacy', teacherTid: '', cls: 'Old Class', classCode: '', scode: 'S1', student: 'Student',
  });

  assert.throws(
    () => store.reconcileCounselRosterSnapshotOnPrimary({
      taskId: 'task-special', teacher: 'Alice', teacherTid: 'alice', kind: 'special',
      sourceMonth: '2026-07', syncedAt: '2026-07-24T13:00:00.000Z',
      classes: [{ classCode: 'C1', className: 'New Class', students: [{ scode: 'S1', student: 'Student' }] }],
    }),
    (error) => error.status === 409 && /같은 이름/.test(error.message),
  );
  assert.deepEqual(
    db.get('SELECT teacher_tid,cls,class_code,roster_source_month FROM counsel_entries WHERE id=?', 'ambiguous-legacy'),
    { teacher_tid: '', cls: 'Old Class', class_code: '', roster_source_month: '2026-06' },
  );
  assert.equal(db.get('SELECT special_source_month FROM tasks WHERE id=?', 'task-special').special_source_month, '2026-06');
}));
