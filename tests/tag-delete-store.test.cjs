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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npr-tag-delete-'));
  const previousCwd = process.cwd();
  let db;
  try {
    process.chdir(root);
    db = new DbService();
    db.init();
    return fn({ db, store: new StoreService(db) });
  } finally {
    try { db?.db.close(); } catch {}
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function addTask(db, id, tag) {
  db.run(
    'INSERT INTO tasks(id,title,tag,start_date,due_date,created_at) VALUES(?,?,?,?,?,?)',
    id, `Task ${id}`, tag, '2026-08-01', '2026-08-31', '2026-08-01',
  );
}

function addEvent(db, id, tag) {
  db.run(
    'INSERT INTO events(id,owner,type,tag,title,start_date,end_date) VALUES(?,?,?,?,?,?,?)',
    id, 'team', 'team_event', tag, `Event ${id}`, '2026-08-10', '2026-08-10',
  );
}

const tagOf = (db, table, id) => db.get(`SELECT tag FROM ${table} WHERE id=?`, id).tag;
const tagNames = (db) => db.all('SELECT name FROM tags ORDER BY sort').map((row) => row.name);

test('deleting a tag moves its tasks and events to an existing tag', () => withStore(({ db, store }) => {
  addTask(db, 'book-task', '교재');
  addEvent(db, 'book-event', '교재');
  store.deleteTag('교재');
  assert.equal(tagOf(db, 'tasks', 'book-task'), '행정', "'행정' is the fallback while it exists");
  assert.equal(tagOf(db, 'events', 'book-event'), '행정');

  addTask(db, 'admin-task', '행정');
  store.deleteTag('행정');
  assert.equal(tagOf(db, 'tasks', 'admin-task'), '채점', 'without 행정 the first remaining normal tag is used');
  assert.equal(tagOf(db, 'tasks', 'book-task'), '채점');
  assert.equal(tagOf(db, 'events', 'book-event'), '채점');
  assert.ok(tagNames(db).includes('채점'));
}));

test('a tag in use is kept when no other normal tag remains, and fixed tags cannot be deleted', () => withStore(({ db, store }) => {
  addTask(db, 'graded-task', '채점');
  for (const name of ['교재', '행정', '행사']) store.deleteTag(name);
  assert.throws(() => store.deleteTag('채점'), /옮길 다른 태그가 없어/);
  assert.equal(tagOf(db, 'tasks', 'graded-task'), '채점');
  assert.ok(tagNames(db).includes('채점'));
  assert.throws(() => store.deleteTag('상담'), /고정 태그/);
}));
