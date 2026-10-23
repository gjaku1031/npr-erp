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
process.env.APP_TODAY = '2026-08-06';
process.env.LEAD_ID = 'admin';
process.env.LEAD_PW = 'test-only';
process.env.LEAD_NAME = 'Test Lead';

const { DbService } = require('../src/db/db.service.ts');
const { StoreService } = require('../src/api/store.service.ts');

function withStore(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npr-past-journal-write-'));
  const previousCwd = process.cwd();
  let db;
  try {
    process.chdir(root);
    db = new DbService();
    db.init();
    db.run(
      'INSERT INTO teachers(tid,name,pw,classes,sort) VALUES(?,?,?,?,?)',
      'teacher-1', 'Teacher One', 'pw', JSON.stringify({
        월수금반: ['M Class'], 화목토반: ['T Class'], '특강 월수금반': [], '특강 화목토반': [],
      }), 1,
    );
    return fn({ db, store: new StoreService(db) });
  } finally {
    try { db?.db.close(); } catch {}
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function addJournal(db, date) {
  db.run('INSERT INTO journals(date,created_at,special_period) VALUES(?,?,0)', date, '2026-08-06');
  db.run('INSERT INTO journal_items(id,date,text,required,sort) VALUES(?,?,?,?,0)', `item-${date}`, date, `Checklist ${date}`, 1);
}

test('teacher past logs are driven by created journals and include missing, draft, and submitted states', () => withStore(({ db, store }) => {
  for (const date of ['2026-08-07', '2026-08-06', '2026-08-05', '2026-08-04', '2026-08-03']) addJournal(db, date);
  db.run(
    'INSERT INTO daily_reports(id,teacher,date,status,confirmed,payload,submitted_at) VALUES(?,?,?,?,?,?,?)',
    'draft-report', 'Teacher One', '2026-08-05', 'draft', 0, JSON.stringify({ nb: 2 }), null,
  );
  db.run(
    'INSERT INTO daily_reports(id,teacher,date,status,confirmed,payload,submitted_at) VALUES(?,?,?,?,?,?,?)',
    'submitted-report', 'Teacher One', '2026-08-04', 'submitted', 1, JSON.stringify({ nb: 3 }), '제출',
  );
  db.run(
    'INSERT INTO daily_reports(id,teacher,date,status,confirmed,payload,submitted_at) VALUES(?,?,?,?,?,?,?)',
    'orphan-report', 'Teacher One', '2026-08-02', 'submitted', 1, JSON.stringify({ nb: 9 }), '제출',
  );

  const state = store.getState('teacher', 'teacher-1');
  assert.deepEqual(state.myPastLogs, [
    {
      date: '2026-08-05', label: '8월 5일 (수)', status: 'draft', submitted: false,
      confirmed: false, nb: 2, at: null,
    },
    {
      date: '2026-08-04', label: '8월 4일 (화)', status: 'submitted', submitted: true,
      confirmed: true, nb: 3, at: '제출',
    },
    {
      date: '2026-08-03', label: '8월 3일 (월)', status: 'none', submitted: false,
      confirmed: false, nb: 0, at: null,
    },
  ]);
  assert.equal(state.myPastLogs.some((row) => row.date === '2026-08-06'), false, 'today stays in myReport');
  assert.equal(state.myPastLogs.some((row) => row.date === '2026-08-07'), false, 'future journals are not writable history');
  assert.equal(state.myPastLogs.some((row) => row.date === '2026-08-02'), false, 'an orphan report is not a created journal');
}));

test('drafting and submitting a past journal writes only the selected report date', () => withStore(({ db, store }) => {
  addJournal(db, '2026-08-06');
  addJournal(db, '2026-08-05');

  store.saveDraft('Teacher One', '2026-08-05', {
    marker: 'past-draft', nb: 1, specialPeriod: false, classSnapshot: ['M Class'],
  });
  assert.deepEqual(
    db.get('SELECT teacher,date,status,payload,submitted_at FROM daily_reports WHERE teacher=?', 'Teacher One'),
    {
      teacher: 'Teacher One', date: '2026-08-05', status: 'draft',
      payload: JSON.stringify({
        marker: 'past-draft', nb: 1, specialPeriod: false, classSnapshot: ['M Class'],
      }), submitted_at: null,
    },
  );
  assert.equal(store.getReport('Teacher One', '2026-08-06'), null);

  store.submitReport('Teacher One', '2026-08-05', {
    marker: 'past-submit', nb: 2, specialPeriod: false, classSnapshot: ['M Class'],
  });
  assert.deepEqual(store.getReport('Teacher One', '2026-08-05'), {
    teacher: 'Teacher One', date: '2026-08-05', status: 'submitted', confirmed: false,
    payload: {
      marker: 'past-submit', nb: 2, specialPeriod: false, classSnapshot: ['M Class'],
    }, at: '제출',
  });
  assert.equal(store.getState('teacher', 'teacher-1').myPastLogs[0].status, 'submitted');
}));
