const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
}).outputText, file);

process.env.APP_TODAY = '2026-07-22';
const { MockTttGateway } = require('../src/ttt/ttt.mock.ts');
const { TttService, TttSpecialService } = require('../src/ttt/ttt.service.ts');
const { reconcileCounselWrite } = require('../src/ttt/counsel-write.ts');

const account = { id: 'teacher-a', pw: 'demo' };

test('the same teacher always sees the same classes, codes and students', async () => {
  const first = await new MockTttGateway().getOwnedClassSnapshot(account, '2026-07-22', 'Teacher A');
  const second = await new MockTttGateway().getOwnedClassSnapshot(account, '2026-07-05', 'Teacher A');
  assert.ok(first.classes.length >= 2);
  assert.deepEqual(second.classes, first.classes, 'a new process and another day in the same month must agree');
  assert.equal(first.sourceMonth, '2026-07');
  assert.equal(first.targetMonth, '2026-07');
  for (const cls of first.classes) {
    assert.match(cls.className, /^[3-6][MT][1-4][ABC]$/);
    assert.equal(cls.dayGroup, cls.className[1]);
    assert.equal(new Set(cls.students.map((student) => student.student)).size, cls.students.length, 'names are unique within a class');
  }
});

test('selected class codes narrow the snapshot for the confirmation read', async () => {
  const gateway = new MockTttGateway();
  const all = await gateway.getOwnedClassSnapshot(account, '2026-07-22', 'Teacher A', { includeSpecialClasses: true });
  const picked = all.classes[0].classCode;
  const narrowed = await gateway.getOwnedClassSnapshot(account, '2026-07-22', 'Teacher A', {
    includeSpecialClasses: true, selectedClassCodes: [picked],
  });
  assert.deepEqual(narrowed.classes.map((cls) => cls.classCode), [picked]);
});

test('special classes follow the staff directory and fail with NO_DATA when there are none', async () => {
  const empty = new TttSpecialService(new MockTttGateway(() => []));
  await assert.rejects(() => empty.getCurrentMonthClassSnapshot('2026-07-22'), (error) => error.code === 'NO_DATA');

  const names = Array.from({ length: 12 }, (_, index) => `Teacher ${index}`);
  const snapshot = await new TttSpecialService(new MockTttGateway(() => names)).getCurrentMonthClassSnapshot('2026-07-22');
  assert.ok(snapshot.classes.length > 0);
  assert.ok(snapshot.classes.every((cls) => names.includes(cls.teacherName)));
  assert.equal(snapshot.listedClassCount, snapshot.classes.length);
});

test('a counsel write on the mock is confirmed through the shared read-back rule, even with a truncated preview', async () => {
  const service = new TttService(new MockTttGateway());
  const args = {
    scode: 'S100001', sname: 'Student', className: '5M1A',
    subject: 'Topic', content: 'A long counsel body that the list truncates', date: '2026-07-22',
  };
  const hooks = [];
  const result = await service.writeCounsel(args, account, { delaysMs: [0], onBeforePost: (evidence) => hooks.push(evidence) });
  assert.deepEqual(hooks, [{ beforeCount: 0, writeDate: '2026-07-22' }]);
  assert.equal(result.verified, true);
  assert.equal(result.afterCount, 1);

  const second = await service.writeCounsel(args, account, { delaysMs: [0] });
  assert.equal(second.beforeCount, 1, 'the earlier identical counsel is counted before the second post');
  assert.equal(second.afterCount, 2);

  const reconciled = await service.reconcileCounselWrite(args, 1, '2026-07-22', account);
  assert.equal(reconciled.confirmed, true);
});

test('a failing before-post hook leaves nothing in the mock ERP', async () => {
  const gateway = new MockTttGateway();
  const service = new TttService(gateway);
  const args = { scode: 'S100002', sname: 'Student', className: '5M1A', content: 'Body', date: '2026-07-22' };
  await assert.rejects(
    () => service.writeCounsel(args, account, { delaysMs: [0], onBeforePost: () => { throw new Error('persist failed'); } }),
    /persist failed/,
  );
  const check = await reconcileCounselWrite(gateway, account, args, 0, '2026-07-22', { delaysMs: [0] });
  assert.equal(check.confirmed, false, 'nothing may be stored when the caller could not record the attempt');
});

test('reads without a teacher account return empty results instead of another account’s data', async () => {
  const service = new TttService(new MockTttGateway());
  assert.deepEqual(await service.getAttendance('5M1A', '2026-07-22', null), []);
  assert.deepEqual(await service.getRoster('5M1A', '2026-07-22', null), []);
  await assert.rejects(() => service.getScoresStrict('5M1A', '2026-07-22', '2026-07-22', null), /계정이 필요/);
  assert.ok((await service.getAttendance('5M1A', '2026-07-22', account)).length >= 6);
});

test('student details mark contact lookups per student and keep failures distinct', async () => {
  const service = new TttService(new MockTttGateway());
  const details = await service.getClassStudentDetails(['S100001', 'bad-code'], '2026-07-22', account);
  const byCode = Object.fromEntries(details.students.map((student) => [student.scode, student]));
  assert.equal(byCode.S100001.phoneState, 'ok');
  assert.match(byCode.S100001.motherPhone, /^010-0000-\d{4}$/);
  assert.equal(byCode['bad-code'].phoneState, 'error');
  assert.equal(details.warnings.length, 1);
});
