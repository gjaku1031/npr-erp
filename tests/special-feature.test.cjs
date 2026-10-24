const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

// The application is TypeScript but intentionally has no separate test compiler.
// Transpile only files loaded by these Node tests; CI uses the project's pinned
// TypeScript version and never needs a network-installed runner.
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
  normalizeTeacherClasses,
} = require('../src/api/store.service.ts');
const { classesForDate } = require('../lib/helpers.ts');
const {
  summarizeSpecialMotherPhoneBatch,
} = require('../src/ttt/ttt.special.ts');
const {
  persistConfirmedExternalWrite,
} = require('../src/api/external-write-sync.ts');

delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.VERCEL;
process.env.SEED_MODE = 'clean';
process.env.APP_TODAY = '2026-07-22';
process.env.LEAD_ID = 'admin';
process.env.LEAD_PW = 'test-only';
process.env.LEAD_NAME = 'Test Lead';

function createHarness({ legacyTeacher } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npr-special-test-'));
  const previousCwd = process.cwd();
  let db;
  try {
    process.chdir(root);
    db = new DbService();
    if (legacyTeacher) {
      db.db.exec(`
        CREATE TABLE teachers (
          tid TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          pw TEXT NOT NULL DEFAULT '1234',
          classes TEXT NOT NULL DEFAULT '{"월수금반":[],"화목토반":[]}',
          sort INTEGER NOT NULL DEFAULT 0
        );
      `);
      db.db.prepare('INSERT INTO teachers(tid,name,classes,sort) VALUES(?,?,?,?)').run(
        legacyTeacher.tid,
        legacyTeacher.name,
        JSON.stringify(legacyTeacher.classes),
        1,
      );
    }
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

test('migration recovers when another Turso cold start adds the same column first', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npr-migration-race-'));
  const previousCwd = process.cwd();
  let db;
  try {
    process.chdir(root);
    db = new DbService();
    db.db.exec(`
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL DEFAULT '"all"',
        special_counsel INTEGER NOT NULL DEFAULT 0
      );
    `);

    const originalExec = db.db.exec.bind(db.db);
    let competingMigrationWon = false;
    let syncCount = 0;
    db.turso = true;
    db.db.sync = () => {
      syncCount += 1;
      if (competingMigrationWon) {
        const columns = db.db.prepare('PRAGMA table_info(tasks)').all().map((column) => column.name);
        if (!columns.includes('special_source_month')) {
          originalExec(`ALTER TABLE tasks ADD COLUMN special_source_month TEXT NOT NULL DEFAULT ''`);
        }
      }
    };
    db.db.exec = (sql) => {
      if (!competingMigrationWon && /ALTER TABLE tasks ADD COLUMN special_source_month\b/.test(sql)) {
        competingMigrationWon = true;
        throw new Error('Hrana(Api("SQLite error: duplicate column name: special_source_month"))');
      }
      return originalExec(sql);
    };

    db.init();
    const columns = db.db.prepare('PRAGMA table_info(tasks)').all().map((column) => column.name);
    assert.equal(competingMigrationWon, true);
    assert.ok(syncCount >= 2);
    assert.ok(columns.includes('special_source_month'));
    assert.ok(columns.includes('special_assignees'));
  } finally {
    try { db?.db.close(); } catch {}
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('special assignee backfill resumes when the column-adding cold start exits early', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npr-assignee-migration-race-'));
  const previousCwd = process.cwd();
  let db;
  try {
    process.chdir(root);
    db = new DbService();
    db.db.exec(`
      CREATE TABLE teachers (
        tid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        pw TEXT NOT NULL DEFAULT '1234',
        classes TEXT NOT NULL DEFAULT '{"월수금반":[],"화목토반":[]}',
        sort INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO teachers(tid,name,classes,sort)
      VALUES('legacy-teacher','Legacy Teacher','{"월수금반":[],"화목토반":[]}',1);
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL DEFAULT '"all"',
        special_counsel INTEGER NOT NULL DEFAULT 0,
        special_source_month TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO tasks(id,scope,special_counsel,special_source_month)
      VALUES('legacy-special','"all"',1,'2026-07');
    `);

    const originalExec = db.db.exec.bind(db.db);
    let competingMigrationWon = false;
    db.turso = true;
    db.db.sync = () => {
      if (competingMigrationWon) {
        const columns = db.db.prepare('PRAGMA table_info(tasks)').all().map((column) => column.name);
        if (!columns.includes('special_assignees')) {
          originalExec(`ALTER TABLE tasks ADD COLUMN special_assignees TEXT NOT NULL DEFAULT '[]'`);
        }
      }
    };
    db.db.exec = (sql) => {
      if (!competingMigrationWon && /ALTER TABLE tasks ADD COLUMN special_assignees\b/.test(sql)) {
        competingMigrationWon = true;
        throw new Error('SQLite error: duplicate column name: special_assignees');
      }
      return originalExec(sql);
    };

    db.init();
    assert.equal(competingMigrationWon, true);
    assert.deepEqual(
      JSON.parse(db.db.prepare('SELECT special_assignees FROM tasks WHERE id=?').get('legacy-special').special_assignees),
      ['Legacy Teacher'],
    );
    assert.equal(
      db.db.prepare('SELECT v FROM settings WHERE k=?').get('db_migration_special_assignees_v1').v,
      '1',
    );

    // 완료 이후 실제 빈 스냅샷은 재마이그레이션 대상으로 오인하지 않는다.
    db.db.prepare('UPDATE tasks SET special_assignees=? WHERE id=?').run('[]', 'legacy-special');
    db.init();
    assert.equal(
      db.db.prepare('SELECT special_assignees FROM tasks WHERE id=?').get('legacy-special').special_assignees,
      '[]',
    );
  } finally {
    try { db?.db.close(); } catch {}
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('special assignee migration marker preserves an existing non-empty snapshot', () => withHarness(({ db }) => {
  db.run('DELETE FROM settings WHERE k=?', 'db_migration_special_assignees_v1');
  db.run(
    `INSERT INTO tasks(
      id,title,start_date,due_date,special_counsel,special_source_month,special_assignees,created_at
    ) VALUES(?,?,?,?,?,?,?,?)`,
    'existing-special',
    'Existing special counsel',
    '2026-07-22',
    '2026-07-23',
    1,
    '2026-07',
    JSON.stringify(['Frozen Teacher']),
    '2026-07-22',
  );

  db.init();
  assert.deepEqual(
    JSON.parse(db.get('SELECT special_assignees FROM tasks WHERE id=?', 'existing-special').special_assignees),
    ['Frozen Teacher'],
  );
  assert.equal(db.get('SELECT v FROM settings WHERE k=?', 'db_migration_special_assignees_v1').v, '1');
}));

test('system counsel tag migration removes report gates and snapshots an existing special roster', () => withHarness(({ db }) => {
  addTeacher(db, 'teacher-one', 'Teacher One');
  db.run(`INSERT INTO settings(k,v) VALUES('special_sync_month','2026-07') ON CONFLICT(k) DO UPDATE SET v='2026-07'`);
  db.run(
    `INSERT INTO special_class_roster(
      source_month,class_code,class_name,teacher_tid,teacher_name,day_group,scode,student,mother_phone,synced_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    '2026-07', 'C1', 'Special One', 'teacher-one', 'Teacher One', 'M', 'S1', 'Student One', '010-0000-0000', '2026-07-22',
  );
  db.run(
    `INSERT INTO tasks(
      id,title,tag,start_date,due_date,scope,report_req,attach_req,mt,counsel,special_counsel,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    'legacy-regular', 'Legacy regular', '상담', '2026-07-23', '2026-07-31', '"all"', 1, 1, 1, 0, 0, '2026-07-23',
  );
  db.run(
    `INSERT INTO tasks(
      id,title,tag,start_date,due_date,scope,report_req,attach_req,mt,counsel,special_counsel,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    'legacy-special-tag', 'Legacy special', '특강 상담', '2026-07-23', '2026-07-31', '"all"', 1, 1, 1, 0, 0, '2026-07-23',
  );
  db.run('DELETE FROM settings WHERE k=?', 'db_migration_system_counsel_tasks_v1');

  db.init();

  assert.deepEqual(
    db.get('SELECT counsel,special_counsel,report_req,attach_req,mt FROM tasks WHERE id=?', 'legacy-regular'),
    { counsel: 1, special_counsel: 0, report_req: 0, attach_req: 0, mt: 0 },
  );
  assert.deepEqual(
    db.get('SELECT counsel,special_counsel,report_req,attach_req,mt,special_source_month FROM tasks WHERE id=?', 'legacy-special-tag'),
    { counsel: 0, special_counsel: 1, report_req: 0, attach_req: 0, mt: 0, special_source_month: '2026-07' },
  );
  assert.deepEqual(
    db.get('SELECT task_id,teacher,cls,scode,student,phone FROM counsel_entries WHERE task_id=?', 'legacy-special-tag'),
    {
      task_id: 'legacy-special-tag', teacher: 'Teacher One', cls: 'Special One', scode: 'S1',
      student: 'Student One', phone: '010-0000-0000',
    },
  );
  assert.equal(db.get('SELECT v FROM settings WHERE k=?', 'db_migration_system_counsel_tasks_v1').v, '1');
}));

function addTeacher(db, tid, name, classes = {}) {
  db.run(
    'INSERT INTO teachers(tid,name,pw,classes,sort) VALUES(?,?,?,?,?)',
    tid,
    name,
    'test-only',
    JSON.stringify(normalizeTeacherClasses(classes)),
    db.get('SELECT COUNT(*) count FROM teachers').count + 1,
  );
}

function specialClass(classCode, className, teacherName, dayGroup, students) {
  return { classCode, className, teacherName, dayGroup, students };
}

function syncInput(classes, overrides = {}) {
  return {
    targetDate: '2026-07-22',
    sourceMonth: '2026-07',
    syncedAt: '2026-07-22T03:00:00.000Z',
    classes,
    ...overrides,
  };
}

function taskInput(overrides = {}) {
  const input = {
    title: '상담 업무',
    descr: '',
    tag: '상담',
    start: '2026-07-22',
    due: '2026-07-31',
    all: false,
    pick: ['Alice'],
    reportReq: false,
    attachReq: false,
    mt: false,
    counsel: false,
    specialCounsel: false,
    links: [],
    ...overrides,
  };
  // 새 계약에서는 시스템 태그가 상담 종류의 단일 진실이다. 기존 테스트 호출부의
  // 의미는 유지하되 실제 서버 입력은 새 UI와 같은 태그 기반 형태로 만든다.
  if (overrides.tag === undefined) {
    if (overrides.specialCounsel) input.tag = '특강 상담';
    else if (overrides.counsel) input.tag = '상담';
  }
  return input;
}

function enableSpecialCounsel(store) {
  store.setSpecialPeriod(true, '2026-07-22');
}

function persistedSpecialState(db) {
  return {
    teachers: db.all('SELECT tid,classes FROM teachers ORDER BY tid'),
    roster: db.all(`
      SELECT source_month,class_code,class_name,teacher_tid,teacher_name,day_group,scode,student,mother_phone,synced_at
      FROM special_class_roster ORDER BY source_month,class_code,scode
    `),
    settings: db.all("SELECT k,v FROM settings WHERE k LIKE 'special_%' ORDER BY k"),
  };
}

test('teacher classes default to four groups and legacy two-group JSON is normalized', () => {
  const normalized = normalizeTeacherClasses({
    월수금반: [' A ', 'A', 42],
    화목토반: ['B'],
    알수없는반: ['ignored'],
  });
  assert.deepEqual(normalized, {
    월수금반: ['A'],
    화목토반: ['B'],
    '특강 월수금반': [],
    '특강 화목토반': [],
  });

  withHarness(({ db }) => {
    db.run('INSERT INTO teachers(tid,name,pw,sort) VALUES(?,?,?,?)', 'new', 'New Teacher', 'x', 1);
    assert.deepEqual(JSON.parse(db.get('SELECT classes FROM teachers WHERE tid=?', 'new').classes), {
      월수금반: [],
      화목토반: [],
      '특강 월수금반': [],
      '특강 화목토반': [],
    });
  });

  withHarness(({ db }) => {
    assert.deepEqual(JSON.parse(db.get('SELECT classes FROM teachers WHERE tid=?', 'legacy').classes), {
      월수금반: ['Old-M'],
      화목토반: ['Old-T'],
      '특강 월수금반': [],
      '특강 화목토반': [],
    });
  }, {
    legacyTeacher: {
      tid: 'legacy',
      name: 'Legacy Teacher',
      classes: { 월수금반: ['Old-M'], 화목토반: ['Old-T'] },
    },
  });
});

test('special-period toggle is saved atomically and each journal keeps its creation snapshot', () => {
  withHarness(({ db, store }) => {
    assert.deepEqual(store.setSpecialPeriod(true, '2026-07-23'), {
      enabled: true,
      targetDate: '2026-07-23',
    });
    store.createJournal('2026-07-23');

    store.setSpecialPeriod(false, '2026-07-24');
    store.createJournal('2026-07-24');
    store.createJournal('2026-07-23');

    assert.deepEqual(store.getSpecialPeriodSettings(), {
      enabled: false,
      targetDate: '2026-07-24',
      sourceMonth: '',
      syncedAt: '',
      summary: null,
    });
    assert.deepEqual(
      db.all('SELECT date,special_period FROM journals ORDER BY date'),
      [
        { date: '2026-07-23', special_period: 1 },
        { date: '2026-07-24', special_period: 0 },
      ],
    );
    assert.deepEqual(
      store.getState('lead', 'admin').journals.map((journal) => [journal.date, journal.specialPeriod]),
      [['2026-07-24', false], ['2026-07-23', true]],
    );
  });
});

test('turning special period on promotes an existing journal one-way and preserves report snapshots', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'started', 'Started Teacher', { 화목토반: ['Regular-T'] });
    store.createJournal('2026-07-22');
    store.setSpecialPeriod(true, '2026-07-22');
    assert.equal(db.get('SELECT special_period FROM journals WHERE date=?', '2026-07-22').special_period, 1);
    store.setSpecialPeriod(false, '2026-07-22');
    assert.equal(db.get('SELECT special_period FROM journals WHERE date=?', '2026-07-22').special_period, 1);

    store.createJournal('2026-07-23');
    store.saveDraft('Started Teacher', '2026-07-23', {
      specialPeriod: false,
      classSnapshot: ['Regular-T'],
      marker: 'preserve-byte-for-byte',
    });
    const reportBefore = db.get('SELECT status,confirmed,payload,submitted_at FROM daily_reports WHERE teacher=? AND date=?', 'Started Teacher', '2026-07-23');
    db.run(
      'INSERT INTO daily_reports(id,teacher,date,status,confirmed,payload,submitted_at) VALUES(?,?,?,?,?,?,?)',
      'legacy-report',
      'Legacy Teacher',
      '2026-07-23',
      'draft',
      0,
      JSON.stringify({ marker: 'legacy-without-special-flag' }),
      null,
    );
    store.setSpecialPeriod(true, '2026-07-23');
    assert.equal(db.get('SELECT special_period FROM journals WHERE date=?', '2026-07-23').special_period, 1);
    assert.deepEqual(
      db.get('SELECT status,confirmed,payload,submitted_at FROM daily_reports WHERE teacher=? AND date=?', 'Started Teacher', '2026-07-23'),
      reportBefore,
    );
    assert.deepEqual(
      JSON.parse(db.get('SELECT payload FROM daily_reports WHERE id=?', 'legacy-report').payload),
      { marker: 'legacy-without-special-flag', specialPeriod: false },
    );

    store.setSpecialPeriod(false, '2026-07-23');
    store.createJournal('2026-07-24');
    store.setSpecialPeriod(true, '2026-07-24');
    assert.deepEqual(
      db.all('SELECT date,special_period FROM journals ORDER BY date'),
      [
        { date: '2026-07-22', special_period: 1 },
        { date: '2026-07-23', special_period: 1 },
        { date: '2026-07-24', special_period: 1 },
      ],
    );
  });
});

test('a stale regular-only wizard cannot create a report after its journal becomes special', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'fresh', 'Fresh Teacher', {
      월수금반: ['Regular-M'],
      '특강 월수금반': ['Special-M'],
    });
    store.createJournal('2026-07-22');
    store.setSpecialPeriod(true, '2026-07-22');

    assert.throws(
      () => store.saveDraft('Stale Teacher', '2026-07-22', {
        specialPeriod: false,
        classSnapshot: ['Regular-M'],
      }),
      (error) => error && error.status === 409 && /새로고침/.test(error.message),
    );
    assert.equal(db.get('SELECT id FROM daily_reports WHERE teacher=? AND date=?', 'Stale Teacher', '2026-07-22'), undefined);

    assert.throws(
      () => store.submitReport('Fresh Teacher', '2026-07-22', {
        specialPeriod: true,
        classSnapshot: ['Regular-M'],
      }),
      (error) => error && error.status === 409 && /새로고침/.test(error.message),
    );

    store.saveDraft('Fresh Teacher', '2026-07-22', {
      specialPeriod: true,
      classSnapshot: ['Regular-M', 'Special-M'],
    });
    assert.deepEqual(
      store.getReport('Fresh Teacher', '2026-07-22').payload.classSnapshot,
      ['Regular-M', 'Special-M'],
    );
  });
});

test('special snapshot sync matches exact teachers, reports misses, fully replaces, is idempotent, and preserves on no-match failure', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice', { 월수금반: ['Regular-A'] });
    addTeacher(db, 'bob', 'Bob', { 화목토반: ['Regular-B'] });

    const first = store.applySpecialClassSnapshot(syncInput([
      specialClass('C1', 'Summer-M', ' Alice ', 'M', [
        { scode: 'S1', student: 'Student 1' },
        { scode: 'S2', student: 'Student 2' },
      ]),
      specialClass('C2', 'Summer-T', 'Bob', 'T', [{ scode: 'S3', student: 'Student 3' }]),
      specialClass('C3', 'Wrong Case', 'alice', 'M', [{ scode: 'S4', student: 'Student 4' }]),
      specialClass('C4', 'Unsupported', 'Alice', 'MW', [{ scode: 'S5', student: 'Student 5' }]),
    ]));

    assert.equal(first.matchedTeacherCount, 2);
    assert.equal(first.classCount, 2);
    assert.equal(first.studentCount, 3);
    assert.deepEqual(first.unmatchedTeachers, ['alice']);
    assert.deepEqual(first.unmatchedClasses, ['Wrong Case']);
    assert.deepEqual(first.unsupportedClasses, ['Unsupported']);

    const aliceAfterFirst = JSON.parse(db.get('SELECT classes FROM teachers WHERE tid=?', 'alice').classes);
    const bobAfterFirst = JSON.parse(db.get('SELECT classes FROM teachers WHERE tid=?', 'bob').classes);
    assert.deepEqual(aliceAfterFirst, {
      월수금반: ['Regular-A'],
      화목토반: [],
      '특강 월수금반': ['Summer-M'],
      '특강 화목토반': [],
    });
    assert.deepEqual(bobAfterFirst, {
      월수금반: [],
      화목토반: ['Regular-B'],
      '특강 월수금반': [],
      '특강 화목토반': ['Summer-T'],
    });

    const replacement = syncInput([
      specialClass('C9', 'Replacement-T', 'Alice', 'T', [{ scode: 'S9', student: 'Student 9' }]),
    ], { syncedAt: '2026-07-22T04:00:00.000Z' });
    store.applySpecialClassSnapshot(replacement);

    assert.deepEqual(JSON.parse(db.get('SELECT classes FROM teachers WHERE tid=?', 'alice').classes), {
      월수금반: ['Regular-A'],
      화목토반: [],
      '특강 월수금반': [],
      '특강 화목토반': ['Replacement-T'],
    });
    assert.deepEqual(JSON.parse(db.get('SELECT classes FROM teachers WHERE tid=?', 'bob').classes), {
      월수금반: [],
      화목토반: ['Regular-B'],
      '특강 월수금반': [],
      '특강 화목토반': [],
    });
    assert.deepEqual(
      db.all('SELECT class_code,scode FROM special_class_roster WHERE source_month=?', '2026-07'),
      [{ class_code: 'C9', scode: 'S9' }],
    );

    const once = persistedSpecialState(db);
    store.applySpecialClassSnapshot(replacement);
    assert.deepEqual(persistedSpecialState(db), once);

    const beforeNoMatch = persistedSpecialState(db);
    assert.throws(
      () => store.applySpecialClassSnapshot(syncInput([
        specialClass('CX', 'No Match', 'Nobody', 'M', [{ scode: 'SX', student: 'Nobody Student' }]),
      ], { syncedAt: '2026-07-22T05:00:00.000Z' })),
      /정확히 일치하는 강사가 없어/,
    );
    assert.deepEqual(persistedSpecialState(db), beforeNoMatch);
  });
});

test('a blank ERP teacher is reported as unmatched without aborting other matched classes', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice');

    const result = store.applySpecialClassSnapshot(syncInput([
      specialClass('C1', 'Matched Class', 'Alice', 'M', [
        { scode: 'S1', student: 'Matched Student' },
      ]),
      specialClass('C2', 'Teacher Missing Class', '   ', 'T', [
        { scode: 'S2', student: 'Unmatched Student' },
      ]),
    ]));

    assert.equal(result.matchedTeacherCount, 1);
    assert.equal(result.classCount, 1);
    assert.equal(result.studentCount, 1);
    assert.deepEqual(result.unmatchedTeachers, ['강사 미지정']);
    assert.deepEqual(result.unmatchedClasses, ['Teacher Missing Class']);
    assert.deepEqual(
      db.all('SELECT class_code,scode FROM special_class_roster ORDER BY class_code,scode'),
      [{ class_code: 'C1', scode: 'S1' }],
    );
    assert.deepEqual(JSON.parse(db.get('SELECT classes FROM teachers WHERE tid=?', 'alice').classes), {
      월수금반: [],
      화목토반: [],
      '특강 월수금반': ['Matched Class'],
      '특강 화목토반': [],
    });
  });
});

test('system counsel tags are immutable and the selected tag alone determines new task behavior', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice');

    const tags = store.getState('lead', 'admin').tags.filter((tag) => ['상담', '특강 상담'].includes(tag.name));
    assert.deepEqual(tags.map((tag) => [tag.name, tag.fixed]), [['상담', true], ['특강 상담', true]]);
    assert.throws(
      () => store.updateTag('상담', { name: '상담 변경' }),
      /고정 태그/,
    );
    assert.throws(() => store.deleteTag('특강 상담'), /고정 태그/);
    store.updateTag('특강 상담', { color: '#123456', emoji: '✨' });
    assert.deepEqual(
      db.get('SELECT name,color,emoji FROM tags WHERE name=?', '특강 상담'),
      { name: '특강 상담', color: '#123456', emoji: '✨' },
    );

    // 이전 토글 필드는 더 이상 상담 종류를 만들 수 없다.
    const normalId = store.createTask(taskInput({ tag: '행정', counsel: true, specialCounsel: true }));
    assert.deepEqual(
      db.get('SELECT tag,counsel,special_counsel FROM tasks WHERE id=?', normalId),
      { tag: '행정', counsel: 0, special_counsel: 0 },
    );

    const regularId = store.createTask(taskInput({
      tag: '상담', counsel: false, specialCounsel: true,
      reportReq: true, attachReq: true,
    }));
    assert.deepEqual(
      db.get('SELECT tag,report_req,attach_req,mt,counsel,special_counsel FROM tasks WHERE id=?', regularId),
      { tag: '상담', report_req: 0, attach_req: 0, mt: 0, counsel: 1, special_counsel: 0 },
    );

    assert.throws(
      () => store.createTask(taskInput({ tag: '특강 상담' })),
      /특강기간에만/,
    );
    assert.equal(db.get("SELECT COUNT(*) count FROM tasks WHERE tag='특강 상담'").count, 0);

    store.applySpecialClassSnapshot(syncInput([
      specialClass('C1', 'System Tag Class', 'Alice', 'M', [{ scode: 'S1', student: 'Student' }]),
    ]));
    enableSpecialCounsel(store);
    const specialId = store.createTask(taskInput({
      tag: '특강 상담', counsel: true, specialCounsel: false,
      reportReq: true, attachReq: true,
    }));
    assert.deepEqual(
      db.get('SELECT tag,report_req,attach_req,mt,counsel,special_counsel,special_source_month FROM tasks WHERE id=?', specialId),
      { tag: '특강 상담', report_req: 0, attach_req: 0, mt: 0, counsel: 0, special_counsel: 1, special_source_month: '2026-07' },
    );

    // 편집도 시스템 태그 계약을 유지하며 상담 업무에 일반 완료조건을 다시 켤 수 없다.
    store.updateTask(regularId, taskInput({
      title: 'Edited Counsel', tag: '상담', reportReq: true, attachReq: true,
    }));
    assert.deepEqual(
      db.get('SELECT title,report_req,attach_req,mt,counsel,special_counsel FROM tasks WHERE id=?', regularId),
      { title: 'Edited Counsel', report_req: 0, attach_req: 0, mt: 0, counsel: 1, special_counsel: 0 },
    );

    assert.throws(
      () => store.updateTask(specialId, taskInput({ tag: '상담' })),
      /상담 대상이 고정된 업무/,
    );
  });
});

test('new MT tasks are rejected while existing legacy MT rows remain readable and editable', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice');
    assert.throws(() => store.createTask(taskInput({ tag: '행정', mt: true })), /더 이상 만들 수 없습니다/);

    db.run(
      `INSERT INTO tasks(id,title,descr,tag,start_date,due_date,scope,mt,created_at,sort)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      'legacy-mt', 'Legacy MT', '', '행정', '2026-07-22', '2026-07-31', JSON.stringify(['Alice']), 1, '2026-07-22', 1,
    );
    assert.equal(store.getState('lead', 'admin').tasks.find((task) => task.id === 'legacy-mt').mt, true);
    store.updateTask('legacy-mt', taskInput({ title: 'Edited Legacy MT', tag: '행정', mt: false }));
    assert.deepEqual(
      db.get('SELECT title,mt FROM tasks WHERE id=?', 'legacy-mt'),
      { title: 'Edited Legacy MT', mt: 1 },
    );

    const normalId = store.createTask(taskInput({ tag: '행정' }));
    assert.throws(() => store.updateTask(normalId, taskInput({ tag: '행정', mt: true })), /더 이상 만들 수 없습니다/);
  });
});

test('a retried task-create request reuses one task and one frozen special roster', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice');
    store.applySpecialClassSnapshot(syncInput([
      specialClass('C1', 'Idempotent Class', 'Alice', 'M', [
        { scode: 'S1', student: 'First Student' },
        { scode: 'S2', student: 'Second Student' },
      ]),
    ]));
    enableSpecialCounsel(store);

    const input = taskInput({
      title: 'Idempotent Special Counsel',
      specialCounsel: true,
      requestId: 'request-1234567890',
    });
    const firstId = store.createTask(input, 'lead:admin');
    store.setSpecialPeriod(false, '2026-07-22');
    const retriedId = store.createTask(input, 'lead:admin');

    assert.equal(retriedId, firstId);
    assert.equal(db.get('SELECT COUNT(*) count FROM tasks').count, 1);
    assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries WHERE task_id=?', firstId).count, 2);

    assert.throws(
      () => store.createTask({ ...input, title: 'Changed Payload' }, 'lead:admin'),
      (error) => error && error.status === 409 && /\ub2e4\ub978 \ub0b4\uc6a9/.test(error.message),
    );
    assert.equal(db.get('SELECT COUNT(*) count FROM tasks').count, 1);
    assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries WHERE task_id=?', firstId).count, 2);

    enableSpecialCounsel(store);
    const distinctId = store.createTask({ ...input, requestId: 'request-0987654321' }, 'lead:admin');
    assert.notEqual(distinctId, firstId);
    assert.equal(db.get('SELECT COUNT(*) count FROM tasks').count, 2);

    // 구 UI는 특강 토글을 켜고도 태그에는 '상담'을 저장했다. 배포 경계에서 응답을
    // 잃은 그 요청도 기존 행과 정확히 같을 때만 멱등 재개한다.
    db.run("UPDATE tasks SET tag='상담' WHERE id=?", firstId);
    const legacyRetryId = store.createTask({
      ...input,
      tag: '상담',
      counsel: false,
      specialCounsel: true,
    }, 'lead:admin');
    assert.equal(legacyRetryId, firstId);
    assert.equal(db.get('SELECT COUNT(*) count FROM tasks').count, 2);
  });
});

test('primary special-counsel creation freezes 270 students for 16 teachers in one atomic task delta and retries idempotently', () => {
  withHarness(({ db, store }) => {
    const classes = [];
    let studentSequence = 0;
    for (let teacherIndex = 1; teacherIndex <= 16; teacherIndex += 1) {
      const teacher = `Teacher ${String(teacherIndex).padStart(2, '0')}`;
      addTeacher(db, `teacher-${teacherIndex}`, teacher);
      const studentCount = teacherIndex <= 14 ? 17 : 16;
      const students = [];
      for (let index = 0; index < studentCount; index += 1) {
        studentSequence += 1;
        students.push({
          scode: `S${String(studentSequence).padStart(3, '0')}`,
          student: `Student ${String(studentSequence).padStart(3, '0')}`,
          motherPhone: `010-0000-${String(studentSequence).padStart(4, '0')}`,
        });
      }
      classes.push(specialClass(
        `C${String(teacherIndex).padStart(2, '0')}`,
        `Bulk Class ${String(teacherIndex).padStart(2, '0')}`,
        teacher,
        teacherIndex % 2 ? 'M' : 'T',
        students,
      ));
    }
    assert.equal(studentSequence, 270);
    store.applySpecialClassSnapshot(syncInput(classes));
    enableSpecialCounsel(store);

    const input = taskInput({
      title: 'Bulk Special Counsel',
      all: true,
      pick: [],
      tag: '특강 상담',
      requestId: 'bulk-request-0001',
    });
    const first = store.createSpecialCounselTaskOnPrimary(input, 'lead:admin');

    assert.equal(first.created, true);
    assert.equal(first.rosterCount, 270);
    assert.equal(first.task.id, first.id);
    assert.equal(first.task.total, 16);
    assert.equal(Object.keys(first.task.counselProg).length, 16);
    assert.deepEqual(first.task.counselProg['Teacher 01'], {
      synced: 0, total: 17, absenceCount: 0, absencePendingCount: 0, noTarget: false,
    });
    assert.deepEqual(first.task.counselProg['Teacher 16'], {
      synced: 0, total: 16, absenceCount: 0, absencePendingCount: 0, noTarget: false,
    });
    assert.equal(db.get('SELECT COUNT(*) count FROM tasks WHERE id=?', first.id).count, 1);
    assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries WHERE task_id=?', first.id).count, 270);
    const publicDelta = JSON.stringify(first.task);
    assert.equal(publicDelta.includes('Student 001'), false, 'the task delta must not expose student PII');
    assert.equal(publicDelta.includes('010-0000-0001'), false, 'the task delta must not expose phone PII');

    // The browser may retry after losing the response. The deterministic request id must
    // return the same task even if the special-period toggle has since been disabled.
    store.setSpecialPeriod(false, '2026-07-22');
    const retry = store.createSpecialCounselTaskOnPrimary(input, 'lead:admin');
    assert.equal(retry.id, first.id);
    assert.equal(retry.created, false);
    assert.equal(retry.rosterCount, 270);
    assert.equal(db.get('SELECT COUNT(*) count FROM tasks WHERE id=?', first.id).count, 1);
    assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries WHERE task_id=?', first.id).count, 270);
  });
});

test('primary special-counsel creation rolls back both task and bulk roster when any roster insert aborts', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice');
    store.applySpecialClassSnapshot(syncInput([
      specialClass('C1', 'Atomic Class', 'Alice', 'M', [
        { scode: 'OK', student: 'First Student' },
        { scode: 'FAIL', student: 'Failing Student' },
      ]),
    ]));
    enableSpecialCounsel(store);
    db.db.exec(`
      CREATE TRIGGER fail_special_counsel_roster
      BEFORE INSERT ON counsel_entries
      WHEN NEW.scode='FAIL'
      BEGIN
        SELECT RAISE(ABORT, 'forced bulk roster failure');
      END;
    `);

    const input = taskInput({
      title: 'Atomic Special Counsel',
      tag: '특강 상담',
      requestId: 'atomic-request-001',
    });
    assert.throws(
      () => store.createSpecialCounselTaskOnPrimary(input, 'lead:admin'),
      /forced bulk roster failure/,
    );
    assert.equal(db.get('SELECT COUNT(*) count FROM tasks').count, 0);
    assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries').count, 0);
  });
});

test('primary special-counsel creation rejects unknown or excessive assignees without creating partial rows', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice');
    store.applySpecialClassSnapshot(syncInput([
      specialClass('C1', 'Validated Class', 'Alice', 'M', [
        { scode: 'S1', student: 'First Student' },
      ]),
    ]));
    enableSpecialCounsel(store);

    assert.throws(
      () => store.createSpecialCounselTaskOnPrimary(taskInput({
        title: 'Unknown Assignee',
        tag: '특강 상담',
        pick: ['Alice', 'Not Registered'],
        requestId: 'unknown-assignee-001',
      }), 'lead:admin'),
      (error) => error && error.status === 400 && /등록되지 않은 강사/.test(error.message),
    );
    assert.equal(db.get('SELECT COUNT(*) count FROM tasks').count, 0);
    assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries').count, 0);

    assert.throws(
      () => store.createSpecialCounselTaskOnPrimary(taskInput({
        title: 'Excessive Assignees',
        tag: '특강 상담',
        pick: Array.from({ length: 201 }, (_, index) => `Teacher ${index + 1}`),
        requestId: 'excess-assignee-001',
      }), 'lead:admin'),
      (error) => error && error.status === 400 && /최대 200명/.test(error.message),
    );
    assert.equal(db.get('SELECT COUNT(*) count FROM tasks').count, 0);
    assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries').count, 0);
  });
});

test('editing a normal task into special counsel validates assignees before changing the task or freezing rows', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice');
    store.applySpecialClassSnapshot(syncInput([
      specialClass('C1', 'Validated Edit Class', 'Alice', 'M', [
        { scode: 'S1', student: 'First Student' },
      ]),
    ]));
    enableSpecialCounsel(store);
    const taskId = store.createTask(taskInput({
      title: 'Normal Task Before Edit',
      tag: '행정',
      requestId: 'normal-edit-source-001',
    }), 'lead:admin');

    assert.throws(
      () => store.updateTask(taskId, taskInput({
        title: 'Invalid Special Edit',
        tag: '특강 상담',
        pick: ['Alice', 'Not Registered'],
      })),
      (error) => error && error.status === 400 && /등록되지 않은 강사/.test(error.message),
    );
    assert.deepEqual(
      db.get('SELECT title,tag,special_counsel FROM tasks WHERE id=?', taskId),
      { title: 'Normal Task Before Edit', tag: '행정', special_counsel: 0 },
    );
    assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries WHERE task_id=?', taskId).count, 0);
  });
});

test('direct-primary counsel snapshot sees a new special task absent from the local replica', () => {
  withHarness((replica) => {
    withHarness((primary) => {
      addTeacher(primary.db, 'alice', 'Alice');
      addTeacher(primary.db, 'bob', 'Bob');
      primary.store.applySpecialClassSnapshot(syncInput([
        specialClass('C1', 'Primary Class', 'Alice', 'M', [
          { scode: 'S1', student: 'Primary Student', motherPhone: '010-1111-1111' },
        ]),
        specialClass('C2', 'Other Teacher Class', 'Bob', 'T', [
          { scode: 'S2', student: 'Other Student', motherPhone: '010-2222-2222' },
        ]),
      ]));
      enableSpecialCounsel(primary.store);
      const created = primary.store.createSpecialCounselTaskOnPrimary(taskInput({
        title: 'Primary-only Special Counsel',
        tag: '특강 상담',
        pick: ['Alice'],
        requestId: 'primary-snapshot-001',
      }), 'lead:admin');
      const entry = primary.db.get('SELECT * FROM counsel_entries WHERE task_id=? AND teacher=?', created.id, 'Alice');
      primary.db.run(
        `INSERT INTO counsel_absence_attempts(
           id,entry_id,task_id,teacher,cls,scode,student,content,attempted_date,
           synced,delivery_state,delivery_stage,created_at
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        'primary-absence', entry.id, created.id, 'Alice', entry.cls, entry.scode, entry.student,
        '문자 안내', '2026-07-23', 1, 'confirmed', 'confirmed', '2026-07-23T09:00:00.000Z',
      );

      assert.equal(replica.db.get('SELECT COUNT(*) count FROM tasks WHERE id=?', created.id).count, 0);
      replica.db.withCounselSnapshotPrimary = (operation) => operation(primary.db.db);
      const snapshot = replica.store.getCounselSnapshotOnPrimary(created.id, 'Alice');

      assert.deepEqual(snapshot.classes, ['Primary Class']);
      assert.equal(snapshot.sourceMonth, '2026-07');
      assert.equal(snapshot.entries.length, 1);
      assert.equal(snapshot.entries[0].student, 'Primary Student');
      assert.equal(snapshot.entries[0].phone, '010-1111-1111');
      assert.equal(snapshot.entries[0].absenceCount, 1);
      assert.equal(snapshot.entries[0].absenceAttempts.length, 1);
      assert.equal(JSON.stringify(snapshot).includes('Other Student'), false, 'another teacher roster must not leak');
      assert.equal(JSON.stringify(snapshot).includes('010-2222-2222'), false, 'another teacher phone must not leak');
    });
  });
});

test('counsel task aggregates count synced students and absence pending/posting/confirmed states by teacher', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice');
    store.applySpecialClassSnapshot(syncInput([
      specialClass('C1', 'Aggregate Class', 'Alice', 'M', [
        { scode: 'S1', student: 'First Student' },
        { scode: 'S2', student: 'Second Student' },
      ]),
    ]));
    enableSpecialCounsel(store);
    const created = store.createSpecialCounselTaskOnPrimary(taskInput({
      title: 'Aggregate Special Counsel',
      tag: '특강 상담',
      requestId: 'aggregate-req-001',
    }), 'lead:admin');
    const entries = db.all(
      'SELECT id,task_id,teacher,cls,scode,student FROM counsel_entries WHERE task_id=? ORDER BY scode',
      created.id,
    );
    store.markCounselSynced(entries[0].id, '2026-07-23 09:00');

    const insertAttempt = db.db.prepare(
      `INSERT INTO counsel_absence_attempts(
         id,entry_id,task_id,teacher,cls,scode,student,content,attempted_date,
         synced,delivery_state,delivery_stage,created_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const addAttempt = (id, entry, synced, state, stage) => insertAttempt.run(
      id, entry.id, entry.task_id, entry.teacher, entry.cls, entry.scode, entry.student,
      `${id} content`, '2026-07-23', synced, state, stage, `2026-07-23T0${id.length}:00:00.000Z`,
    );
    addAttempt('claimed', entries[1], 0, 'pending', 'claimed');
    addAttempt('posting', entries[0], 0, 'pending', 'posting');
    addAttempt('confirmed', entries[0], 1, 'confirmed', 'confirmed');

    const task = store.getState('lead', 'admin').tasks.find((item) => item.id === created.id);
    assert.deepEqual(task.counselProg.Alice, {
      synced: 1,
      total: 2,
      absenceCount: 2,
      absencePendingCount: 2,
      noTarget: false,
    });
    assert.equal(task.doneCount, 0, 'absence attempts do not masquerade as completed student counsel sends');

    const enriched = store.getCounselEntries(created.id, 'Alice');
    assert.deepEqual(
      enriched.map((entry) => ({
        scode: entry.scode,
        absenceCount: entry.absenceCount,
        absencePendingCount: entry.absencePendingCount,
      })),
      [
        { scode: 'S1', absenceCount: 2, absencePendingCount: 1 },
        { scode: 'S2', absenceCount: 0, absencePendingCount: 1 },
      ],
    );
  });
});

test('special-counsel roster, source month, drafts, and no-target completion stay fixed across resync', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice');
    addTeacher(db, 'bob', 'Bob');
    store.applySpecialClassSnapshot(syncInput([
      specialClass('C1', 'Frozen Class', 'Alice', 'M', [
        { scode: 'S1', student: 'First Student', motherPhone: '010-1111-1111' },
        { scode: 'S2', student: 'Second Student' },
      ]),
    ]));
    enableSpecialCounsel(store);

    const taskId = store.createTask(taskInput({
      title: 'Frozen Special Counsel',
      all: true,
      pick: [],
      specialCounsel: true,
    }));
    let entries = store.getCounselEntries(taskId, 'Alice');
    assert.deepEqual(entries.map((entry) => [entry.cls, entry.scode, entry.student]), [
      ['Frozen Class', 'S1', 'First Student'],
      ['Frozen Class', 'S2', 'Second Student'],
    ]);
    assert.equal(store.getCounselContext(taskId, 'Alice').sourceMonth, '2026-07');
    assert.deepEqual(store.getCounselContext(taskId, 'Bob').classes, []);

    store.saveCounselDraft(entries[0].id, 'Kept subject', 'Kept draft');
    store.markCounselSynced(entries[0].id, '2026-07-22 12:00');

    let task = store.getState('lead', 'admin').tasks.find((item) => item.id === taskId);
    assert.deepEqual(task.counselProg.Bob, {
      synced: 0, total: 0, absenceCount: 0, absencePendingCount: 0, noTarget: true,
    });
    assert.equal(task.doneCount, 1, 'the no-target teacher is complete while Alice is still partial');

    store.applySpecialClassSnapshot(syncInput([
      specialClass('C2', 'Current Class', 'Alice', 'T', [
        { scode: 'S3', student: 'New Student' },
      ]),
    ], { syncedAt: '2026-07-23T03:00:00.000Z' }));

    entries = store.getCounselEntries(taskId, 'Alice');
    assert.deepEqual(entries.map((entry) => [entry.cls, entry.scode, entry.student]), [
      ['Frozen Class', 'S1', 'First Student'],
      ['Frozen Class', 'S2', 'Second Student'],
    ]);
    assert.deepEqual(
      entries.find((entry) => entry.scode === 'S1'),
      {
        ...entries.find((entry) => entry.scode === 'S1'),
        subject: 'Kept subject',
        content: 'Kept draft',
        synced: true,
        syncedAt: '2026-07-22 12:00',
      },
    );
    assert.deepEqual(store.getCounselContext(taskId, 'Alice'), {
      kind: 'special',
      sourceMonth: '2026-07',
      classes: ['Frozen Class'],
    });
    assert.deepEqual(
      store.getSpecialRoster('2026-07').map((row) => [row.className, row.scode]),
      [['Current Class', 'S3']],
      'the mutable monthly cache is replaced without changing the task snapshot',
    );

    const second = entries.find((entry) => entry.scode === 'S2');
    store.markCounselSynced(second.id, '2026-07-23 12:00');
    task = store.getState('lead', 'admin').tasks.find((item) => item.id === taskId);
    assert.equal(task.specialSourceMonth, '2026-07');
    assert.equal(task.doneCount, 2);
    assert.deepEqual(task.counselProg.Bob, {
      synced: 0, total: 0, absenceCount: 0, absencePendingCount: 0, noTarget: true,
    });
  });
});

test('scope-all special counsel freezes assignees when teachers are added later', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice');
    addTeacher(db, 'bob', 'Bob');
    store.applySpecialClassSnapshot(syncInput([
      specialClass('C1', 'Frozen Class', 'Alice', 'M', [
        { scode: 'S1', student: 'Frozen Student' },
      ]),
    ]));
    enableSpecialCounsel(store);

    const taskId = store.createTask(taskInput({
      title: 'Frozen All Teachers',
      all: true,
      pick: [],
      specialCounsel: true,
    }));
    assert.deepEqual(
      JSON.parse(db.get('SELECT special_assignees FROM tasks WHERE id=?', taskId).special_assignees),
      ['Alice', 'Bob'],
    );

    addTeacher(db, 'charlie', 'Charlie');
    const task = store.getState('lead', 'admin').tasks.find((item) => item.id === taskId);
    assert.deepEqual(task.assignees, ['Alice', 'Bob']);
    assert.equal(task.total, 2);
    assert.equal(task.doneCount, 1, 'only the frozen no-target Bob is complete');
    assert.throws(
      () => store.getCounselContext(taskId, 'Charlie'),
      /배정되지 않은 강사/,
    );
    assert.equal(
      store.getState('teacher', 'charlie').tasks.some((item) => item.id === taskId),
      false,
    );
  });
});

test('an all-zero-target special counsel remains empty after same-month resync and its scope/type are immutable', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice');
    addTeacher(db, 'bob', 'Bob');
    addTeacher(db, 'charlie', 'Charlie');

    // Establish a valid current source month through an unrelated matched teacher.
    store.applySpecialClassSnapshot(syncInput([
      specialClass('C0', 'Unrelated Class', 'Charlie', 'M', [
        { scode: 'S0', student: 'Unrelated Student' },
      ]),
    ]));
    enableSpecialCounsel(store);
    const taskId = store.createTask(taskInput({
      title: 'Initially Empty Special Counsel',
      pick: ['Alice', 'Bob'],
      specialCounsel: true,
    }));
    assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries WHERE task_id=?', taskId).count, 0);

    // Alice gains a class later in the same monthly cache; the existing task must not absorb it.
    store.applySpecialClassSnapshot(syncInput([
      specialClass('C1', 'Later Class', 'Alice', 'T', [
        { scode: 'S1', student: 'Later Student' },
      ]),
    ], { syncedAt: '2026-07-24T03:00:00.000Z' }));
    assert.deepEqual(store.getCounselContext(taskId, 'Alice').classes, []);
    assert.deepEqual(store.getCounselContext(taskId, 'Bob').classes, []);
    assert.deepEqual(store.getCounselEntries(taskId, 'Alice'), []);

    const before = db.get('SELECT scope,counsel,special_counsel,special_source_month FROM tasks WHERE id=?', taskId);
    assert.throws(
      () => store.updateTask(taskId, taskInput({
        title: 'Changed Scope',
        pick: ['Alice'],
        specialCounsel: true,
      })),
      /상담 대상이 고정된 업무/,
    );
    assert.throws(
      () => store.updateTask(taskId, taskInput({
        title: 'Changed Type',
        pick: ['Alice', 'Bob'],
        counsel: true,
        specialCounsel: false,
      })),
      /상담 대상이 고정된 업무/,
    );
    assert.deepEqual(
      db.get('SELECT scope,counsel,special_counsel,special_source_month FROM tasks WHERE id=?', taskId),
      before,
    );

    const stateTask = store.getState('lead', 'admin').tasks.find((item) => item.id === taskId);
    assert.equal(stateTask.doneCount, 2);
    assert.deepEqual(stateTask.counselProg.Alice, {
      synced: 0, total: 0, absenceCount: 0, absencePendingCount: 0, noTarget: true,
    });
    assert.deepEqual(stateTask.counselProg.Bob, {
      synced: 0, total: 0, absenceCount: 0, absencePendingCount: 0, noTarget: true,
    });
  });
});

test('special-counsel contact enrichment applies only valid phones and preserves existing phones and drafts', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice');
    store.applySpecialClassSnapshot(syncInput([
      specialClass('C1', 'Phone Class', 'Alice', 'M', [
        { scode: 'S1', student: 'Existing Phone', motherPhone: '010-1111-1111' },
        { scode: 'S2', student: 'New Phone' },
      ]),
    ]));
    enableSpecialCounsel(store);
    const taskId = store.createTask(taskInput({ specialCounsel: true }));
    let entries = store.getCounselEntries(taskId, 'Alice');
    const first = entries.find((entry) => entry.scode === 'S1');
    const second = entries.find((entry) => entry.scode === 'S2');
    store.saveCounselDraft(first.id, 'First subject', 'First draft');
    store.saveCounselDraft(second.id, 'Second subject', 'Second draft');

    store.updateSpecialRosterContactsForTask(taskId, 'Alice', 'Phone Class', [
      { scode: 'S1', motherPhone: '' },
      { scode: 'S2', motherPhone: '010-2222-2222' },
      { scode: 'UNKNOWN', motherPhone: '010-9999-9999' },
      { scode: '', motherPhone: '010-0000-0000' },
    ]);

    entries = store.getCounselEntries(taskId, 'Alice');
    assert.deepEqual(
      entries.map((entry) => ({
        scode: entry.scode,
        phone: entry.phone,
        subject: entry.subject,
        content: entry.content,
      })),
      [
        {
          scode: 'S1',
          phone: '010-1111-1111',
          subject: 'First subject',
          content: 'First draft',
        },
        {
          scode: 'S2',
          phone: '010-2222-2222',
          subject: 'Second subject',
          content: 'Second draft',
        },
      ],
    );
    assert.deepEqual(
      store.getSpecialRoster('2026-07').map((row) => [row.scode, row.motherPhone]),
      [['S1', '010-1111-1111'], ['S2', '010-2222-2222']],
    );
  });
});

test('task deletion is atomic and removes frozen counsel PII and task status', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice');
    store.applySpecialClassSnapshot(syncInput([
      specialClass('C1', 'Delete Task Class', 'Alice', 'M', [
        { scode: 'S1', student: 'Delete Task Student', motherPhone: '010-1111-1111' },
      ]),
    ]));
    enableSpecialCounsel(store);
    const taskId = store.createTask(taskInput({ specialCounsel: true }));
    store.setTaskStatus(taskId, 'Alice', 'done');

    const originalRun = db.run.bind(db);
    db.run = (sql, ...params) => {
      if (String(sql).startsWith('DELETE FROM task_status')) throw new Error('simulated delete failure');
      return originalRun(sql, ...params);
    };
    try {
      assert.throws(() => store.deleteTask(taskId), /simulated delete failure/);
    } finally {
      db.run = originalRun;
    }

    assert.equal(db.get('SELECT COUNT(*) count FROM tasks WHERE id=?', taskId).count, 1);
    assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries WHERE task_id=?', taskId).count, 1);
    assert.equal(db.get('SELECT COUNT(*) count FROM task_status WHERE task_id=?', taskId).count, 1);

    store.deleteTask(taskId);
    assert.equal(db.get('SELECT COUNT(*) count FROM tasks WHERE id=?', taskId).count, 0);
    assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries WHERE task_id=?', taskId).count, 0);
    assert.equal(db.get('SELECT COUNT(*) count FROM task_status WHERE task_id=?', taskId).count, 0);
  });
});

test('teacher deletion is atomic and removes counsel and special-roster PII', () => {
  withHarness(({ db, store }) => {
    addTeacher(db, 'alice', 'Alice');
    store.applySpecialClassSnapshot(syncInput([
      specialClass('C1', 'Delete Teacher Class', 'Alice', 'T', [
        { scode: 'S1', student: 'Delete Teacher Student', motherPhone: '010-2222-2222' },
      ]),
    ]));
    enableSpecialCounsel(store);
    const taskId = store.createTask(taskInput({ specialCounsel: true }));
    store.setTaskStatus(taskId, 'Alice', 'done');

    const originalRun = db.run.bind(db);
    db.run = (sql, ...params) => {
      if (String(sql).startsWith('DELETE FROM special_class_roster')) throw new Error('simulated delete failure');
      return originalRun(sql, ...params);
    };
    try {
      assert.throws(() => store.deleteTeacher('alice'), /simulated delete failure/);
    } finally {
      db.run = originalRun;
    }

    assert.equal(db.get('SELECT COUNT(*) count FROM teachers WHERE tid=?', 'alice').count, 1);
    assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries WHERE teacher=?', 'Alice').count, 1);
    assert.equal(db.get('SELECT COUNT(*) count FROM special_class_roster WHERE teacher_tid=?', 'alice').count, 1);
    assert.equal(db.get('SELECT COUNT(*) count FROM task_status WHERE teacher=?', 'Alice').count, 1);

    store.deleteTeacher('alice');
    assert.equal(db.get('SELECT COUNT(*) count FROM teachers WHERE tid=?', 'alice').count, 0);
    assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries WHERE teacher=?', 'Alice').count, 0);
    assert.equal(db.get('SELECT COUNT(*) count FROM special_class_roster WHERE teacher_tid=? OR teacher_name=?', 'alice', 'Alice').count, 0);
    assert.equal(db.get('SELECT COUNT(*) count FROM task_status WHERE teacher=?', 'Alice').count, 0);
  });
});

test('syncStrict retries exactly three times and exposes only a controlled failure message', () => {
  withHarness(({ db }) => {
    const database = db.db;
    const hadOwnSync = Object.prototype.hasOwnProperty.call(database, 'sync');
    const originalSync = database.sync;
    db.turso = true;
    try {
      let attempts = 0;
      Object.defineProperty(database, 'sync', {
        configurable: true,
        writable: true,
        value() {
          attempts += 1;
          if (attempts < 3) throw new Error('sensitive transient detail');
        },
      });
      db.syncStrict();
      assert.equal(attempts, 3);

      attempts = 0;
      database.sync = () => {
        attempts += 1;
        throw new Error('sensitive permanent detail');
      };
      assert.throws(
        () => db.syncStrict(),
        (error) => {
          assert.equal(error.message, '원격 데이터 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
          assert.equal(error.message.includes('sensitive'), false);
          return true;
        },
      );
      assert.equal(attempts, 3);
    } finally {
      db.turso = false;
      if (hadOwnSync) database.sync = originalSync;
      else delete database.sync;
    }
  });
});

test('classesForDate merges regular and special groups only for special journals and removes duplicates', () => {
  const teacher = {
    classes: {
      월수금반: ['Regular', 'Shared'],
      화목토반: ['Tuesday'],
      '특강 월수금반': ['Shared', ' Special ', 'Special'],
      '특강 화목토반': ['Tuesday Special'],
    },
  };
  const state = {
    me: teacher,
    journals: [
      { date: '2026-07-20', specialPeriod: true },
      { date: '2026-07-22', specialPeriod: false },
    ],
  };

  assert.deepEqual(classesForDate(state, '2026-07-20'), ['Regular', 'Shared', 'Special']);
  assert.deepEqual(classesForDate(state, '2026-07-21', teacher, true), ['Tuesday', 'Tuesday Special']);
  assert.deepEqual(classesForDate(state, '2026-07-22'), ['Regular', 'Shared']);
  assert.deepEqual(classesForDate(state, '2026-07-19', teacher, true), []);
});

test('mother-phone batch summary distinguishes total failure, partial success, and a valid empty phone', () => {
  const failed = summarizeSpecialMotherPhoneBatch(['S1', 'S2'], {
    phones: [],
    failures: [
      { studentCode: 'S1', reason: 'request-failed' },
      { studentCode: 'S2', reason: 'invalid-response' },
    ],
  });
  assert.deepEqual(failed, {
    requested: 2,
    received: 0,
    populated: 0,
    empty: 0,
    failures: 2,
    failuresByReason: {
      'invalid-student-code': 0,
      'session-expired': 0,
      'request-failed': 1,
      'invalid-response': 1,
    },
    allFailed: true,
  });

  const partial = summarizeSpecialMotherPhoneBatch(['S1', 'S2', 'S3', 'S1'], {
    phones: [
      { studentCode: 'S1', motherPhone: '010-1111-1111' },
      { studentCode: 'S2', motherPhone: '' },
    ],
    failures: [{ studentCode: 'S3', reason: 'request-failed' }],
  });
  assert.equal(partial.requested, 3);
  assert.equal(partial.received, 2);
  assert.equal(partial.populated, 1);
  assert.equal(partial.empty, 1, 'a valid detail response with no registered number is not a lookup failure');
  assert.equal(partial.failures, 1);
  assert.equal(partial.allFailed, false);
});

test('confirmed external writes downgrade persistence failure to pending instead of throwing', () => {
  let attempts = 0;
  assert.equal(persistConfirmedExternalWrite(() => { attempts += 1; }), 'synced');
  assert.equal(persistConfirmedExternalWrite(() => {
    attempts += 1;
    throw new Error('simulated Turso failure');
  }), 'pending');
  assert.equal(attempts, 2);
});
