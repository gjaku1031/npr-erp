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
process.env.APP_TODAY = '2026-07-23';
process.env.LEAD_ID = 'admin';
process.env.LEAD_PW = 'test-only';
process.env.LEAD_NAME = 'Test Lead';

const { DbService } = require('../src/db/db.service.ts');
const { StoreService, normalizeTeacherClasses } = require('../src/api/store.service.ts');

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npr-regular-sync-'));
  const previousCwd = process.cwd();
  let db;
  try {
    process.chdir(root);
    db = new DbService();
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

function withHarness(fn) {
  const harness = createHarness();
  try {
    return fn(harness);
  } finally {
    harness.close();
  }
}

function addTeacher(store, db, { tid, name, classes }) {
  store.createTeacher(name, tid, 'pw');
  if (classes) db.run('UPDATE teachers SET classes=? WHERE tid=?', JSON.stringify(normalizeTeacherClasses(classes)), tid);
}

function addLegacyDuplicateTeacher(db, { tid, name, classes }) {
  db.run(
    'INSERT INTO teachers(tid,name,pw,classes,sort) VALUES(?,?,?,?,?)',
    tid, name, 'pw', JSON.stringify(normalizeTeacherClasses(classes || {})),
    Number(db.get('SELECT MAX(sort) value FROM teachers')?.value || 0) + 1,
  );
}

function classesOf(db, tid) {
  return normalizeTeacherClasses(db.get('SELECT classes FROM teachers WHERE tid=?', tid).classes);
}

function snapshot(classes, extra = {}) {
  return {
    targetDate: '2026-07-23',
    sourceMonth: '2026-07',
    syncedAt: '2026-07-23T03:04:05.000Z',
    classes,
    ...extra,
  };
}

test('teacher creation trims names and rejects a duplicate exact name', () => withHarness(({ db, store }) => {
  store.createTeacher('  Alice  ', 'alice', 'pw');
  assert.equal(db.get('SELECT name FROM teachers WHERE tid=?', 'alice').name, 'Alice');
  assert.throws(
    () => store.createTeacher(' Alice ', 'alice-duplicate', 'pw'),
    /이미 있는 강사 이름/,
  );
  assert.throws(() => store.createTeacher('  ', 'blank', 'pw'), /강사 이름/);
  assert.equal(db.get('SELECT COUNT(*) count FROM teachers WHERE name=?', 'Alice').count, 1);
}));

test('regular sync full-replaces every teacher regular group, preserves special groups, and deduplicates classes', () => withHarness(({ db, store }) => {
  addTeacher(store, db, {
    tid: 'alice',
    name: '김선생',
    classes: {
      '월수금반': ['예전 M'],
      '화목토반': ['예전 T'],
      '특강 월수금반': ['특강 M'],
      '특강 화목토반': ['특강 T'],
    },
  });
  addTeacher(store, db, {
    tid: 'bob',
    name: '박선생',
    classes: {
      '월수금반': ['지워질 M'],
      '화목토반': ['지워질 T'],
      '특강 월수금반': ['박 특강 M'],
      '특강 화목토반': ['박 특강 T'],
    },
  });

  const result = store.applyRegularClassSnapshot(snapshot([
    { classCode: 'm-1', className: '5M4A', teacherName: '김선생', dayGroup: 'M' },
    { classCode: 'm-1', className: '5M4A', teacherName: '김선생', dayGroup: 'M' },
    // 코드가 달라도 실제 배정 반명이 같으면 한 번만 저장한다.
    { classCode: 'm-1-alias', className: '5M4A', teacherName: '김선생', dayGroup: 'M' },
    { classCode: 't-1', className: '5M4C', teacherName: '김선생', dayGroup: 'T' },
  ]));

  assert.equal(result.matchedTeacherCount, 1);
  assert.equal(result.classCount, 2);
  assert.equal(result.syncMode, 'routine');
  assert.deepEqual(classesOf(db, 'alice'), {
    '월수금반': ['5M4A'],
    '화목토반': ['5M4C'],
    '특강 월수금반': ['특강 M'],
    '특강 화목토반': ['특강 T'],
  });
  assert.deepEqual(classesOf(db, 'bob'), {
    '월수금반': [],
    '화목토반': [],
    '특강 월수금반': ['박 특강 M'],
    '특강 화목토반': ['박 특강 T'],
  });
}));

test('quarter start audit metadata is persisted with the atomic regular-class replacement', () => withHarness(({ db, store }) => {
  addTeacher(store, db, {
    tid: 'alice', name: '김선생',
    classes: { '월수금반': ['이전반'], '특강 월수금반': ['보존 특강'] },
  });
  const result = store.applyRegularClassSnapshot({
    ...snapshot([{ classCode: 'new', className: '새분기반', teacherName: '김선생', dayGroup: 'M' }]),
    targetDate: '2026-09-01', sourceMonth: '2026-09',
    syncMode: 'quarter-start', previousSourceMonth: '2026-07',
    addedClassCount: 1, removedClassCount: 1, changedTeacherCount: 1,
  });

  assert.equal(result.syncMode, 'quarter-start');
  assert.equal(result.previousSourceMonth, '2026-07');
  assert.equal(result.addedClassCount, 1);
  assert.equal(result.removedClassCount, 1);
  assert.equal(result.changedTeacherCount, 1);
  assert.deepEqual(store.getRegularClassSyncSettings().summary, result);
  assert.deepEqual(classesOf(db, 'alice')['특강 월수금반'], ['보존 특강']);
}));

test('regular sync uses the authenticated teacher tid when local display names are duplicated', () => withHarness(({ db, store }) => {
  addTeacher(store, db, { tid: 'same-1', name: '동명선생', classes: { '특강 월수금반': ['S1'] } });
  addLegacyDuplicateTeacher(db, { tid: 'same-2', name: '동명선생', classes: { '특강 월수금반': ['S2'] } });
  const result = store.applyRegularClassSnapshot(snapshot([
    { classCode: 'm-1', className: '5M4A', teacherTid: 'same-2', teacherName: '동명선생', dayGroup: 'M' },
  ]));
  assert.equal(result.matchedTeacherCount, 1);
  assert.deepEqual(classesOf(db, 'same-1')['월수금반'], []);
  assert.deepEqual(classesOf(db, 'same-2')['월수금반'], ['5M4A']);
  assert.deepEqual(classesOf(db, 'same-1')['특강 월수금반'], ['S1']);
  assert.deepEqual(classesOf(db, 'same-2')['특강 월수금반'], ['S2']);
}));

test('regular sync storage rejects duplicate class ownership or conflicting day groups atomically', () => withHarness(({ db, store }) => {
  addTeacher(store, db, { tid: 'alice', name: '김선생', classes: { '월수금반': ['보존 A'] } });
  addTeacher(store, db, { tid: 'bob', name: '박선생', classes: { '화목토반': ['보존 B'] } });
  const before = db.all('SELECT tid,classes FROM teachers ORDER BY tid');

  assert.throws(() => store.applyRegularClassSnapshot(snapshot([
    { classCode: 'same', className: '5M4A', teacherTid: 'alice', teacherName: '김선생', dayGroup: 'M' },
    { classCode: 'same', className: '5M4A', teacherTid: 'bob', teacherName: '박선생', dayGroup: 'M' },
  ])), /담임이 여러 강사로 중복/);
  assert.deepEqual(db.all('SELECT tid,classes FROM teachers ORDER BY tid'), before);

  assert.throws(() => store.applyRegularClassSnapshot(snapshot([
    { classCode: 'same', className: '5M4A', teacherTid: 'alice', teacherName: '김선생', dayGroup: 'M' },
    { classCode: 'same', className: '5M4A', teacherTid: 'alice', teacherName: '김선생', dayGroup: 'T' },
  ])), /요일 그룹이 중복/);
  assert.deepEqual(db.all('SELECT tid,classes FROM teachers ORDER BY tid'), before);
}));

test('regular sync defensively excludes every [연장] class and reports parser exclusions', () => withHarness(({ db, store }) => {
  addTeacher(store, db, { tid: 'alice', name: '김선생' });
  const result = store.applyRegularClassSnapshot(snapshot([
    { classCode: '', className: '[연장] 5M4A', teacherName: '김선생', dayGroup: 'M' },
    { classCode: 'ext-2', className: '5M4C [연장]', teacherName: '김선생', dayGroup: 'T' },
    { classCode: 'normal', className: '5M4A', teacherName: '김선생', dayGroup: 'M' },
  ], { excludedExtensionClasses: ['파서에서 이미 제외한 [연장] 반'] }));

  assert.equal(result.classCount, 1);
  assert.deepEqual(result.excludedExtensionClasses, [
    '파서에서 이미 제외한 [연장] 반',
    '[연장] 5M4A',
    '5M4C [연장]',
  ]);
  assert.deepEqual(classesOf(db, 'alice')['월수금반'], ['5M4A']);
  assert.deepEqual(classesOf(db, 'alice')['화목토반'], []);
}));

test('regular sync rejects every unsupported partial snapshot atomically', () => withHarness(({ db, store }) => {
  addTeacher(store, db, {
    tid: 'spaced', name: '  정상선생  ',
    classes: { '월수금반': ['보존반'], '특강 월수금반': ['S'] },
  });
  const before = db.get('SELECT classes FROM teachers WHERE tid=?', 'spaced').classes;

  assert.throws(() => store.applyRegularClassSnapshot(snapshot([
    { classCode: 'ok', className: '정상반', teacherName: ' 정상선생 ', dayGroup: 'M' },
  ], { unsupportedClasses: ['ERP 미지원 요일반'] })), /기존 일반 반을 변경하지 않았습니다/);
  assert.equal(db.get('SELECT classes FROM teachers WHERE tid=?', 'spaced').classes, before);

  assert.throws(() => store.applyRegularClassSnapshot(snapshot([
    { classCode: 'ok', className: '정상반', teacherName: ' 정상선생 ', dayGroup: 'M' },
    { classCode: 'day', className: '주4일반', teacherName: '정상선생', dayGroup: 'MT' },
  ])), /기존 일반 반을 변경하지 않았습니다/);
  assert.equal(db.get('SELECT classes FROM teachers WHERE tid=?', 'spaced').classes, before);
}));

test('regular sync refuses a partial snapshot when even one class owner is unresolved', () => withHarness(({ db, store }) => {
  addTeacher(store, db, { tid: 'ok', name: '정상선생', classes: { '월수금반': ['보존반'] } });
  addTeacher(store, db, { tid: 'dup-1', name: '동명선생', classes: { '월수금반': ['old-1'] } });
  addLegacyDuplicateTeacher(db, { tid: 'dup-2', name: '동명선생', classes: { '월수금반': ['old-2'] } });
  const before = db.all('SELECT tid,classes FROM teachers ORDER BY tid');
  assert.throws(() => store.applyRegularClassSnapshot(snapshot([
    { classCode: 'ok', className: '정상반', teacherName: '정상선생', dayGroup: 'M' },
    { classCode: 'missing', className: '미귀속반', teacherName: '없는선생', dayGroup: 'T' },
    { classCode: 'dup', className: '동명인반', teacherName: '동명선생', dayGroup: 'M' },
  ])), /기존 일반 반을 변경하지 않았습니다/);
  assert.deepEqual(db.all('SELECT tid,classes FROM teachers ORDER BY tid'), before);
}));

test('regular sync failures leave every teacher and prior sync setting unchanged', () => withHarness(({ db, store }) => {
  addTeacher(store, db, {
    tid: 'alice',
    name: '김선생',
    classes: { '월수금반': ['보존 M'], '화목토반': ['보존 T'], '특강 월수금반': ['보존 S'] },
  });
  db.run('INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)', 'regular_sync_date', '2026-06-01');
  db.run('INSERT OR REPLACE INTO settings(k,v) VALUES(?,?)', 'regular_sync_summary', '{"old":true}');
  const beforeClasses = db.get('SELECT classes FROM teachers WHERE tid=?', 'alice').classes;

  assert.throws(
    () => store.applyRegularClassSnapshot(snapshot([
      { classCode: 'unmatched', className: '미매칭반', teacherName: '없는선생', dayGroup: 'M' },
      { classCode: 'extension', className: '[연장] 제외반', teacherName: '김선생', dayGroup: 'M' },
    ])),
    /기존 일반 반을 변경하지 않았습니다/,
  );
  assert.equal(db.get('SELECT classes FROM teachers WHERE tid=?', 'alice').classes, beforeClasses);
  assert.equal(store.getSetting('regular_sync_date'), '2026-06-01');
  assert.equal(store.getSetting('regular_sync_summary'), '{"old":true}');

  // 유효한 항목 뒤에 손상 항목이 있어도 파싱 단계에서 중단되어 부분 반영되지 않는다.
  assert.throws(
    () => store.applyRegularClassSnapshot(snapshot([
      { classCode: 'valid', className: '반영되면안됨', teacherName: '김선생', dayGroup: 'M' },
      { classCode: '', className: '손상반', teacherName: '김선생', dayGroup: 'T' },
    ])),
    /코드가 없어/,
  );
  assert.equal(db.get('SELECT classes FROM teachers WHERE tid=?', 'alice').classes, beforeClasses);
}));

test('regular sync primary guard rejects a teacher change made after ERP reads', () => withHarness(({ db, store }) => {
  addTeacher(store, db, { tid: 'alice', name: '김선생', classes: { '월수금반': ['처음반'], '특강 월수금반': ['특강보존'] } });
  const staleGuard = store.getRegularClassSyncGuard();
  const changed = classesOf(db, 'alice');
  changed['월수금반'] = ['동시에 바뀐 반'];
  db.run('UPDATE teachers SET classes=? WHERE tid=?', JSON.stringify(changed), 'alice');
  assert.throws(
    () => store.applyRegularClassSnapshot(snapshot([
      { classCode: 'new', className: 'ERP반', teacherTid: 'alice', teacherName: '김선생', dayGroup: 'M' },
    ]), staleGuard),
    /변경되어 적용을 취소/,
  );
  assert.deepEqual(classesOf(db, 'alice')['월수금반'], ['동시에 바뀐 반']);
  assert.deepEqual(classesOf(db, 'alice')['특강 월수금반'], ['특강보존']);
  assert.equal(store.getSetting('regular_sync_date'), '');
}));

test('teacher class mutation lease serializes regular, special, teacher, and credential writes', () => withHarness(({ store }) => {
  const first = store.acquireTeacherClassMutationLease('regular-sync', 1_000);
  assert.throws(
    () => store.acquireTeacherClassMutationLease('teacher-change', 1_001),
    /다른 반 또는 강사 계정 변경 작업/,
  );
  store.releaseTeacherClassMutationLease('not-the-owner');
  assert.throws(
    () => store.acquireTeacherClassMutationLease('special-sync', 1_002),
    /다른 반 또는 강사 계정 변경 작업/,
  );
  store.releaseTeacherClassMutationLease(first);
  const second = store.acquireTeacherClassMutationLease('special-sync', 1_003);
  store.releaseTeacherClassMutationLease(second);

  // 함수가 비정상 종료돼 release하지 못해도 3분 뒤에는 다음 요청이 회수한다.
  store.acquireTeacherClassMutationLease('stale-owner', 10_000);
  const recovered = store.acquireTeacherClassMutationLease('recovered', 10_000 + 3 * 60 * 1000 + 1);
  assert.ok(recovered);
  store.releaseTeacherClassMutationLease(recovered);
}));

test('regular sync is idempotent, persists settings, hides summary from teachers, and blocks all manual class edits', () => withHarness(({ db, store }) => {
  addTeacher(store, db, {
    tid: 'alice',
    name: '김선생',
    classes: { '특강 월수금반': ['특강보존'] },
  });
  const input = snapshot([
    { classCode: 'm1', className: '5M4A', teacherName: '김선생', dayGroup: 'M' },
    { classCode: 't1', className: '5M4C', teacherName: '김선생', dayGroup: 'T' },
  ]);
  const first = store.applyRegularClassSnapshot(input);
  const afterFirst = db.get('SELECT classes FROM teachers WHERE tid=?', 'alice').classes;
  const second = store.applyRegularClassSnapshot(input);

  assert.deepEqual(second, first);
  assert.equal(db.get('SELECT classes FROM teachers WHERE tid=?', 'alice').classes, afterFirst);
  assert.deepEqual(store.getRegularClassSyncSettings(), {
    targetDate: '2026-07-23',
    sourceMonth: '2026-07',
    syncedAt: '2026-07-23T03:04:05.000Z',
    summary: first,
  });

  const leadState = store.getState('lead', 'admin');
  const teacherState = store.getState('teacher', 'alice');
  assert.deepEqual(leadState.settings.regularSyncSummary, first);
  assert.equal(teacherState.settings.regularSyncSummary, null);
  assert.equal(teacherState.settings.regularSyncDate, '2026-07-23');
  assert.equal(teacherState.settings.regularSyncMonth, '2026-07');
  assert.equal(teacherState.settings.regularSyncAt, '2026-07-23T03:04:05.000Z');

  for (const group of ['월수금반', '화목토반']) {
    assert.throws(
      () => store.updateTeacherClasses('alice', group, ['수동 반']),
      /정규 반은 직접 추가·삭제할 수 없습니다/,
    );
  }
  assert.throws(
    () => store.updateTeacherClasses('alice', '특강 월수금반', ['수동 특강']),
    /특강 반은 강사가 직접 수정할 수 없습니다/,
  );
  assert.equal(db.get('SELECT classes FROM teachers WHERE tid=?', 'alice').classes, afterFirst);
}));
