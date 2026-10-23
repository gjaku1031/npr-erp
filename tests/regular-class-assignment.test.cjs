const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
    },
  });
  module._compile(outputText, filename);
};

const { resolveRegularClassAssignments } = require('../src/ttt/regular-class-sync.ts');

const cls = (classCode, className, dayGroup = 'M') => ({
  classCode,
  className,
  dayGroup,
  scheduleCode: dayGroup === 'M' ? '1010100' : '0101010',
});
const teacher = (tid, name, codes, current = {}) => ({
  tid,
  name,
  currentClasses: { '월수금반': current.M || [], '화목토반': current.T || [] },
  accessibleClasses: codes.map((classCode) => ({ classCode, className: `alias-${classCode}` })),
});

test('a class visible to exactly one registered teacher account is assigned by class code', () => {
  const result = resolveRegularClassAssignments(
    [cls('c1', '5M4A'), cls('c2', '5M4C', 'T')],
    [teacher('a', '김선생', ['c1']), teacher('b', '박선생', ['c2'])],
  );
  assert.equal(result.canApply, true);
  assert.equal(result.uniquelyClaimedClassCount, 2);
  assert.equal(result.matchedTeacherCount, 2);
  assert.deepEqual(result.assignments.map((entry) => [entry.className, entry.teacherTid, entry.dayGroup]), [
    ['5M4A', 'a', 'M'],
    ['5M4C', 'b', 'T'],
  ]);
});

test('multiple account visibility keeps the one existing owner and reports the tie-break', () => {
  const result = resolveRegularClassAssignments(
    [cls('c1', '5M4A')],
    [teacher('a', '김선생', ['c1'], { M: ['5M4A'] }), teacher('b', '박선생', ['c1'])],
  );
  assert.equal(result.canApply, true);
  assert.equal(result.assignments[0].teacherTid, 'a');
  assert.deepEqual(result.retainedByCurrentOwner, ['5M4A']);
});

test('a unique picker claimant cannot silently take an existing class from another teacher', () => {
  const result = resolveRegularClassAssignments(
    [cls('c1', '5M4A')],
    [teacher('a', '현재선생', [], { M: ['5M4A'] }), teacher('b', '조회선생', ['c1'])],
  );
  assert.equal(result.canApply, false);
  assert.deepEqual(result.assignments, []);
  assert.equal(result.ambiguousClasses.length, 1);
  assert.match(result.ambiguousClasses[0], /현재 현재선생 · 계정 조회선생/);
});

test('a genuinely new class with one picker claimant can be assigned without manual entry', () => {
  const result = resolveRegularClassAssignments(
    [cls('new', '신규반')],
    [teacher('a', '김선생', ['new']), teacher('b', '박선생', [])],
  );
  assert.equal(result.canApply, true);
  assert.equal(result.assignments[0].teacherTid, 'a');
});

test('unowned or multiply-owned ambiguous classes block the complete snapshot', () => {
  const result = resolveRegularClassAssignments(
    [cls('c1', '5M4A'), cls('c2', '5M4C')],
    [
      teacher('a', '김선생', ['c1'], { M: ['5M4A'] }),
      teacher('b', '박선생', ['c1'], { T: ['5M4A'] }),
    ],
  );
  assert.equal(result.canApply, false);
  assert.deepEqual(result.unclaimedClasses, ['5M4C']);
  assert.equal(result.ambiguousClasses.length, 1);
  assert.match(result.ambiguousClasses[0], /^5M4A/);
  assert.deepEqual(result.assignments, []);
});

test('multiple claimants cannot displace a current owner outside the claimant set', () => {
  const result = resolveRegularClassAssignments(
    [cls('c1', '5M4A')],
    [
      teacher('original', '기존선생', [], { M: ['5M4A'] }),
      teacher('claim-1', '후보1', ['c1'], { M: ['5M4A'] }),
      teacher('claim-2', '후보2', ['c1']),
    ],
  );
  assert.equal(result.canApply, false);
  assert.deepEqual(result.assignments, []);
  assert.equal(result.ambiguousClasses.length, 1);
});

test('a duplicate central class code is never assigned twice', () => {
  const result = resolveRegularClassAssignments(
    [cls('c1', '5M4A'), cls('c1', 'duplicate alias')],
    [teacher('a', '김선생', ['c1'])],
  );
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].className, '5M4A');
});
