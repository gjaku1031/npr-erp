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
process.env.APP_TODAY = '2026-09-01';
process.env.LEAD_ID = 'admin';
process.env.LEAD_PW = 'test-only';
process.env.LEAD_NAME = 'Test Lead';

const { DbService } = require('../src/db/db.service.ts');
const { StoreService } = require('../src/api/store.service.ts');

function createHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npr-other-team-'));
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

function addTeacher(db, tid, name, { other = false, lead = false } = {}) {
  db.run(
    `INSERT INTO teachers(tid,name,pw,classes,is_lead,is_other_team,sort)
     VALUES(?,?,?, ?,?,?,?)`,
    tid,
    name,
    '1234',
    JSON.stringify({
      '월수금반': [], '화목토반': [],
      '특강 월수금반': [], '특강 화목토반': [],
    }),
    lead ? 1 : 0,
    other ? 1 : 0,
    1,
  );
}

function createCommonTask(store, patch = {}) {
  return store.createTask({
    title: '공용 업무', descr: '', tag: '행정',
    start: '2026-09-01', due: '2026-09-03',
    all: true, pick: [], links: [], reportReq: false, attachReq: false,
    ...patch,
  }, 'lead:admin');
}

test('schema and legacy migration include the independent other-team permission and private workspace tables', () => withHarness(({ db }) => {
  const teacherColumns = db.all('PRAGMA table_info(teachers)').map((column) => column.name);
  const taskColumns = db.all('PRAGMA table_info(tasks)').map((column) => column.name);
  assert.ok(teacherColumns.includes('is_other_team'));
  assert.ok(taskColumns.includes('self_managed'));
  assert.ok(taskColumns.includes('created_by_tid'));
  assert.ok(taskColumns.includes('self_source_month'));
  for (const table of ['other_team_syncs', 'other_team_classes', 'other_team_students']) {
    assert.equal(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table)?.name, table);
  }
  const classColumns = db.all('PRAGMA table_info(other_team_classes)').map((column) => column.name);
  assert.ok(classColumns.includes('top_name'));
  assert.ok(classColumns.includes('middle_name'));
}));

test('normal teachers use the same code-based selection with category-aware legacy views and CAS', () => withHarness(({ db, store }) => {
  addTeacher(db, 'teacher-1', '일반 강사');
  const empty = store.getTeacherRoster('teacher-1');
  assert.match(empty.selectionRevision, /^[a-f0-9]{64}$/);

  const applied = store.applyTeacherRosterSnapshotOnPrimary({
    teacherTid: 'teacher-1', sourceMonth: '2026-09', syncedAt: '2026-09-05T00:00:00.000Z',
    expectedRevision: empty.selectionRevision,
    classes: [
      { classCode: 'REG-M', className: '[내신]1M전A1', topName: '중등부', middleName: '중등1', dayGroup: 'M', scheduleCode: '1010100', students: [] },
      { classCode: 'REG-T', className: '[연장]1T', topName: '중등부', middleName: '중등1', dayGroup: 'T', scheduleCode: '0101010', students: [] },
      { classCode: 'SP-M', className: '가을 특강', topName: '특강', middleName: '중등', dayGroup: 'M', scheduleCode: '1010100', students: [] },
      { classCode: 'ODD', className: '토요 선택반', topName: '중등부', middleName: '중등1', dayGroup: 'OTHER', scheduleCode: '0000010', students: [] },
    ],
  });
  assert.match(applied.selectionRevision, /^[a-f0-9]{64}$/);
  assert.notEqual(applied.selectionRevision, empty.selectionRevision);
  assert.deepEqual(JSON.parse(db.get('SELECT classes FROM teachers WHERE tid=?', 'teacher-1').classes), {
    '월수금반': ['[내신]1M전A1'],
    '화목토반': ['[연장]1T'],
    '특강 월수금반': ['가을 특강'],
    '특강 화목토반': [],
  });
  assert.deepEqual(
    store.getTeacherRoster('teacher-1').classes.map((cls) => [cls.classCode, cls.topName]).sort(),
    [['ODD', '중등부'], ['REG-M', '중등부'], ['REG-T', '중등부'], ['SP-M', '특강']],
  );

  assert.throws(() => store.applyTeacherRosterSnapshotOnPrimary({
    teacherTid: 'teacher-1', sourceMonth: '2026-09', expectedRevision: empty.selectionRevision,
    classes: [{ classCode: 'NEW', className: '동시 변경', topName: '중등부', dayGroup: 'M', students: [] }],
  }), /다른 화면에서 반 선택이 먼저 변경/);
  assert.equal(store.getTeacherRoster('teacher-1').classCount, 4);
}));

test('state summaries and today classes prefer the saved selection over stale legacy assignments', () => withHarness(({ db, store }) => {
  addTeacher(db, 'partner-1', '협업 인원', { other: true });
  store.applyTeacherRosterSnapshotOnPrimary({
    teacherTid: 'partner-1', sourceMonth: '2026-09', syncedAt: '2026-09-05T00:00:00.000Z',
    expectedRevision: store.getTeacherRoster('partner-1').selectionRevision,
    classes: [
      { classCode: 'M1', className: '예1M3B', topName: '중등부', dayGroup: 'M', students: [] },
      { classCode: 'S1', className: '가을 특강', topName: '특강', dayGroup: 'T', students: [] },
      { classCode: 'O1', className: '[내신] 토요반', topName: '중등부', dayGroup: 'OTHER', students: [] },
    ],
  });
  db.run('UPDATE teachers SET classes=? WHERE tid=?', JSON.stringify({
    '월수금반': ['예전M1', '예전M2'],
    '화목토반': ['예전T1', '예전T2'],
    '특강 월수금반': ['예전특강M'],
    '특강 화목토반': ['예전특강T'],
  }), 'partner-1');

  const leadTeacher = store.getState('lead', 'admin').teachers.find((teacher) => teacher.tid === 'partner-1');
  assert.equal(leadTeacher.selectedClassCount, 3);
  assert.deepEqual(leadTeacher.classes, {
    '월수금반': ['예1M3B'],
    '화목토반': [],
    '특강 월수금반': [],
    '특강 화목토반': ['가을 특강'],
  });
  assert.deepEqual(store.getState('other', 'partner-1').me.classes, leadTeacher.classes);
}));

test('selected classes become the normal counsel roster while special classes stay period-scoped', () => withHarness(({ db, store }) => {
  addTeacher(db, 'teacher-1', '일반 강사');
  const revision = store.getTeacherRoster('teacher-1').selectionRevision;
  store.applyTeacherRosterSnapshotOnPrimary({
    teacherTid: 'teacher-1', sourceMonth: '2026-09', syncedAt: '2026-09-05T00:00:00.000Z',
    expectedRevision: revision,
    classes: [
      {
        classCode: 'REG', className: '[내신] 중등반', topName: '중등부', middleName: '중등1',
        dayGroup: 'M', students: [{ scode: 'R1', student: '정규 학생' }],
      },
      {
        classCode: 'ODD', className: '토요 선택반', topName: '중등부', middleName: '중등1',
        dayGroup: 'OTHER', students: [{ scode: 'O1', student: '기타 학생' }],
      },
      {
        classCode: 'SPECIAL', className: '가을 특강', topName: '특강', middleName: '중등',
        dayGroup: 'T', students: [{ scode: 'S1', student: '특강 학생' }],
      },
    ],
  });

  const regularTask = store.createTask({
    title: '정기 상담', descr: '', tag: '상담', start: '2026-09-01', due: '2026-09-30',
    all: false, pick: ['일반 강사'], links: [], reportReq: false, attachReq: false,
  }, 'lead:admin');
  const regular = store.syncTeacherCounselRosterFromSelectionOnPrimary(regularTask, 'teacher-1');
  assert.deepEqual(regular.classes.sort(), ['[내신] 중등반', '토요 선택반']);
  assert.deepEqual(
    store.getCounselSnapshotOnPrimary(regularTask, '일반 강사').entries.map((entry) => entry.scode).sort(),
    ['O1', 'R1'],
  );

  store.setSpecialPeriod(true, '2026-09-05');
  const special = store.createSpecialCounselTaskOnPrimary({
    title: '특강 상담', descr: '', tag: '특강 상담', start: '2026-09-05', due: '2026-09-30',
    all: false, pick: ['일반 강사'], links: [], reportReq: false, attachReq: false,
    requestId: 'manual-special-roster-0001',
  }, 'lead:admin');
  assert.equal(special.rosterCount, 1);
  assert.deepEqual(
    store.getCounselSnapshotOnPrimary(special.id, '일반 강사').entries.map((entry) => [entry.cls, entry.scode]),
    [['가을 특강', 'S1']],
  );
}));

test('a new normal daily report cannot save a stale pre-selection class snapshot', () => withHarness(({ db, store }) => {
  addTeacher(db, 'teacher-1', '일반 강사');
  store.applyTeacherRosterSnapshotOnPrimary({
    teacherTid: 'teacher-1', sourceMonth: '2026-09',
    expectedRevision: store.getTeacherRoster('teacher-1').selectionRevision,
    classes: [{ classCode: 'T1', className: '새 화목토반', topName: '중등부', dayGroup: 'T', students: [] }],
  });
  store.createJournal('2026-09-01');

  assert.throws(() => store.saveDraft('일반 강사', '2026-09-01', {
    specialPeriod: false, classSnapshot: [],
  }), /담당 반 구성이 변경/);
  store.saveDraft('일반 강사', '2026-09-01', {
    specialPeriod: false, classSnapshot: ['새 화목토반'],
  });
  assert.deepEqual(store.getReport('일반 강사', '2026-09-01').payload.classSnapshot, ['새 화목토반']);
}));

test('other-team permission keeps staff in admin management but removes daily-report and common-task duties', () => withHarness(({ db, store }) => {
  addTeacher(db, 'teacher-1', '일반 강사');
  addTeacher(db, 'partner-1', '협업 인원');
  store.setTeacherOtherTeam('partner-1', true);

  const login = store.login('partner-1', '1234');
  assert.deepEqual(login, {
    role: 'other', tid: 'partner-1', name: '협업 인원',
    canLead: false, isTeacher: false, canOtherTeam: true,
  });
  assert.equal(store.login('  partner-1  ', '1234').role, 'other', 'login ids tolerate copy/paste whitespace');

  createCommonTask(store);
  assert.throws(
    () => createCommonTask(store, { all: false, pick: ['협업 인원'], title: '잘못된 배정' }),
    /다른 팀 또는 등록되지 않은 인원/,
  );
  store.createJournal('2026-09-01');
  store.submitReport('협업 인원', '2026-09-01', { legacy: true });

  const leadState = store.getState('lead', 'admin');
  assert.deepEqual(leadState.teachers.map((teacher) => teacher.name).sort(), ['일반 강사', '협업 인원']);
  assert.deepEqual(leadState.teacherNames, ['일반 강사']);
  assert.deepEqual(leadState.tasks[0].assignees, ['일반 강사']);
  assert.equal(leadState.teachers.find((teacher) => teacher.tid === 'partner-1').isOtherTeam, true);
  assert.deepEqual(store.getRegularClassSyncTeachers().map((teacher) => teacher.tid), ['teacher-1']);

  const otherState = store.getState('other', 'partner-1');
  assert.equal(otherState.me.isOtherTeam, true);
  assert.equal(otherState.me.isTeacher, false);
  assert.equal(otherState.myReport, null);
  assert.deepEqual(otherState.myPastLogs, []);
  assert.deepEqual(otherState.tasks, []);
  assert.deepEqual(otherState.teacherNames, []);
  assert.deepEqual(otherState.events, []);
  assert.deepEqual(otherState.notices, []);
  assert.deepEqual(otherState.journals, []);
  assert.deepEqual(otherState.tags.map((tag) => tag.name), ['상담']);
  assert.throws(() => store.getState('teacher', 'partner-1'), /사용자를 찾을 수 없습니다/);
}));

test('other-team staff sync only their latest classes and own isolated counseling schedules', () => withHarness(({ db, store }) => {
  addTeacher(db, 'partner-1', '협업 인원', { other: true });
  addTeacher(db, 'partner-2', '다른 협업', { other: true });
  addTeacher(db, 'teacher-1', '일반 강사');
  createCommonTask(store);

  store.applyOtherTeamRosterSnapshotOnPrimary({
    teacherTid: 'partner-1', sourceMonth: '2026-08', syncedAt: '2026-08-01T00:00:00.000Z',
    classes: [{
      classCode: 'OLD', className: '지난 반', dayGroup: 'M', scheduleCode: '1010100',
      students: [{ scode: 'OLD-1', student: '지난 학생', grade: '초4', status: '수강' }],
    }],
  });
  const latest = store.applyOtherTeamRosterSnapshotOnPrimary({
    teacherTid: 'partner-1', sourceMonth: '2026-09', syncedAt: '2026-09-01T00:00:00.000Z',
    classes: [
      {
        classCode: 'C1', className: '협업 M반', dayGroup: 'M', scheduleCode: '1010100',
        students: [
          { scode: 'S1', student: '학생 하나', grade: '초5', status: '수강' },
          { scode: 'S2', student: '학생 둘', grade: '초5', status: '수강' },
        ],
      },
      { classCode: 'C2', className: '협업 기타반', dayGroup: 'OTHER', scheduleCode: '1101100', students: [] },
    ],
    warnings: ['기타 요일 반 1개'],
  });
  assert.equal(latest.sourceMonth, '2026-09');
  assert.equal(latest.classCount, 2);
  assert.equal(latest.studentCount, 2);
  assert.equal(store.isOtherTeamRosterClass('partner-1', '협업 M반'), true);
  assert.equal(store.isOtherTeamRosterClass('partner-1', '지난 반'), false, '이전 월 반은 현재 알림장 범위가 아니다');
  assert.equal(store.isOtherTeamRosterClass('partner-2', '협업 M반'), false);

  const created = store.createOtherTeamCounselTaskOnPrimary({
    title: '9월 정기 상담', descr: '본인 일정',
    start: '2026-09-01', due: '2026-09-30',
    requestId: 'other-counsel-request-0001',
  }, 'partner-1');
  assert.equal(created.created, true);
  assert.equal(created.rosterCount, 2);
  assert.equal(created.task.selfManaged, true);
  assert.deepEqual(created.task.assignees, ['협업 인원']);
  assert.equal(store.isOwnedOtherTeamCounselTask(created.id, 'partner-1'), true);
  assert.equal(store.isOwnedOtherTeamCounselTask(created.id, 'partner-2'), false);

  const retry = store.createOtherTeamCounselTaskOnPrimary({
    title: '9월 정기 상담', descr: '본인 일정',
    start: '2026-09-01', due: '2026-09-30',
    requestId: 'other-counsel-request-0001',
  }, 'partner-1');
  assert.equal(retry.id, created.id);
  assert.equal(retry.created, false);
  assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries WHERE task_id=?', created.id).count, 2);

  const ownState = store.getState('other', 'partner-1');
  assert.deepEqual(ownState.tasks.map((task) => task.id), [created.id]);
  assert.equal(store.getState('lead', 'admin').tasks.some((task) => task.id === created.id), false);
  assert.deepEqual(store.getState('other', 'partner-2').tasks, []);
  assert.deepEqual(
    store.getCounselSnapshotOnPrimary(created.id, '협업 인원').entries.map((entry) => entry.scode).sort(),
    ['S1', 'S2'],
  );

  store.applyOtherTeamRosterSnapshotOnPrimary({
    teacherTid: 'partner-1', sourceMonth: '2026-09', syncedAt: '2026-09-02T00:00:00.000Z',
    classes: [{
      classCode: 'C1', className: '협업 M반', dayGroup: 'M', scheduleCode: '1010100',
      students: [{ scode: 'S2', student: '학생 둘', grade: '초5', status: '수강' }],
    }],
  });
  const reconciled = store.syncSelfManagedCounselRosterFromCacheOnPrimary(created.id, 'partner-1');
  assert.equal(reconciled.counts.active, 1);
  assert.equal(reconciled.counts.inactive, 1);
  assert.equal(reconciled.inactivated, 1);
  assert.throws(
    () => store.deleteOtherTeamCounselTaskOnPrimary(created.id, 'partner-2'),
    /본인이 만든 상담일정만 삭제/,
  );
  store.deleteOtherTeamCounselTaskOnPrimary(created.id, 'partner-1');
  assert.equal(db.get('SELECT COUNT(*) count FROM tasks WHERE id=?', created.id).count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries WHERE task_id=?', created.id).count, 0);
}));

test('deleting other-team staff removes their private roster, counseling task, and student history', () => withHarness(({ db, store }) => {
  addTeacher(db, 'partner-delete', '삭제 대상', { other: true });
  store.applyOtherTeamRosterSnapshotOnPrimary({
    teacherTid: 'partner-delete', sourceMonth: '2026-09', syncedAt: '2026-09-01T00:00:00.000Z',
    classes: [{
      classCode: 'DEL-C1', className: '삭제 반', dayGroup: 'M', scheduleCode: '1010100',
      students: [{ scode: 'DEL-S1', student: '삭제 학생', grade: '초5', status: '수강' }],
    }],
  });
  const created = store.createOtherTeamCounselTaskOnPrimary({
    title: '삭제 상담', descr: '', start: '2026-09-01', due: '2026-09-30',
    requestId: 'cleanup-request-0001',
  }, 'partner-delete');
  const entry = db.get('SELECT id,task_id,teacher,cls,scode,student FROM counsel_entries WHERE task_id=?', created.id);
  db.run(
    `INSERT INTO counsel_absence_attempts(id,entry_id,task_id,teacher,cls,scode,student,attempted_date)
     VALUES(?,?,?,?,?,?,?,?)`,
    'absence-delete', entry.id, entry.task_id, entry.teacher, entry.cls, entry.scode, entry.student, '2026-09-01',
  );
  db.run(
    'INSERT INTO task_status(task_id,teacher,status) VALUES(?,?,?)',
    created.id, '삭제 대상', 'none',
  );

  store.deleteTeacher('partner-delete');

  assert.equal(db.get('SELECT COUNT(*) count FROM teachers WHERE tid=?', 'partner-delete').count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM other_team_syncs WHERE teacher_tid=?', 'partner-delete').count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM other_team_classes WHERE teacher_tid=?', 'partner-delete').count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM other_team_students WHERE teacher_tid=?', 'partner-delete').count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM tasks WHERE id=?', created.id).count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM counsel_entries WHERE task_id=?', created.id).count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM counsel_absence_attempts WHERE task_id=?', created.id).count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM task_status WHERE task_id=?', created.id).count, 0);
}));
