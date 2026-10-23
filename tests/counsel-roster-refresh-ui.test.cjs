const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
  });
  module._compile(outputText, filename);
};

const {
  runCounselRosterRefresh,
  pickCounselReconcile,
  counselReconcileSummary,
} = require('../lib/counsel-sync.ts');

// 전체 상담 로스터 새로고침 오케스트레이터의 계약: prepare 먼저 → 정본 반영 → 반별 연락처 순차 새로고침.
test('all-roster refresh always prepares first, then refreshes contacts sequentially with real percentages', async () => {
  const order = [];
  let active = 0;
  let maxActive = 0;
  const progress = [];
  let preparedClasses = null;
  const outcome = await runCounselRosterRefresh({
    prepare: async () => {
      order.push('prepare');
      return {
        classes: ['A', 'B', 'C'],
        entries: [{ id: 1, cls: 'A' }, { id: 2, cls: 'B' }, { id: 3, cls: 'C' }],
        rosterCount: 3, sourceMonth: '2026-07', added: 1,
      };
    },
    onPrepared: (prepared, classes) => {
      order.push('onPrepared:' + classes.join(','));
      preparedClasses = classes;
    },
    syncContacts: async (cls, mode) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push('contact:' + cls + ':' + mode);
      await Promise.resolve();
      active -= 1;
      // 이 라우트는 state를 접어주지 않으므로 마지막 full 응답에도 state가 없다.
      return { entries: [] };
    },
    onProgress: (p) => progress.push([p.processed, p.percent, p.currentClass]),
  });
  // prepare가 맨 먼저, onPrepared가 그다음, 그 후에야 연락처 호출이 시작된다.
  assert.equal(order[0], 'prepare');
  assert.equal(order[1], 'onPrepared:A,B,C');
  assert.deepEqual(order.slice(2), ['contact:A:delta', 'contact:B:delta', 'contact:C:full']);
  assert.deepEqual(preparedClasses, ['A', 'B', 'C']);
  assert.equal(maxActive, 1); // 동시성 1
  assert.deepEqual(progress, [[0, 0, 'A'], [1, 33, 'B'], [2, 67, 'C'], [3, 100, '']]); // 실제 완료 퍼센트
  assert.equal(outcome.prepared, true);
  assert.deepEqual(outcome.classes, ['A', 'B', 'C']);
  assert.deepEqual(outcome.contactFailures, []);
  assert.equal(outcome.finalStateFolded, false); // state 미첨부 → 호출부가 canonical reload로 마감
});

test('a zero-target prepare is a successful 100% roster with no contact calls but still replaces the cache', async () => {
  let contactCalls = 0;
  let onPreparedClasses = 'UNSET';
  const outcome = await runCounselRosterRefresh({
    prepare: async () => ({ classes: ['A', 'B'], entries: [], rosterCount: 0, inactivated: 1 }),
    onPrepared: (prepared, classes) => { onPreparedClasses = classes; },
    syncContacts: async () => { contactCalls += 1; return { entries: [] }; },
    onProgress: () => {},
  });
  assert.deepEqual(onPreparedClasses, ['A', 'B']); // 빈 반도 담당 반 정본에는 유지
  assert.equal(contactCalls, 0);           // 연락처 단계는 완전히 건너뛴다
  assert.equal(outcome.prepared, true);
  assert.deepEqual(outcome.classes, []);   // 실제 연락처 대상 반은 0개
  assert.deepEqual(outcome.contactFailures, []);
  assert.equal(outcome.finalStateFolded, false);
});

test('contact refresh only runs for canonical classes that actually contain active students', async () => {
  const contacts = [];
  let preparedClasses = [];
  const outcome = await runCounselRosterRefresh({
    prepare: async () => ({
      classes: ['A', 'EMPTY', 'B'],
      entries: [{ id: 1, cls: 'A' }, { id: 2, cls: 'B', rosterActive: true }],
      rosterCount: 2,
    }),
    onPrepared: (_prepared, classes) => { preparedClasses = classes; },
    syncContacts: async (cls) => { contacts.push(cls); return { entries: [] }; },
    onProgress: () => {},
  });

  assert.deepEqual(preparedClasses, ['A', 'EMPTY', 'B']);
  assert.deepEqual(contacts, ['A', 'B']);
  assert.deepEqual(outcome.classes, ['A', 'B']);
  assert.deepEqual(outcome.contactFailures, []);
});

test('a failed prepare never reaches onPrepared or contacts, so the caller can preserve its cache', async () => {
  let onPreparedCalls = 0;
  let contactCalls = 0;
  await assert.rejects(
    () => runCounselRosterRefresh({
      prepare: async () => { throw new Error('통통통 반별 원생목록이 비어 있어 기존 명단을 변경하지 않았습니다.'); },
      onPrepared: () => { onPreparedCalls += 1; },
      syncContacts: async () => { contactCalls += 1; return {}; },
      onProgress: () => {},
    }),
    /기존 명단을 변경하지 않았습니다/,
  );
  // 캐시 교체 콜백이 호출되지 않았으므로 호출부의 기존 로스터는 그대로 보존된다.
  assert.equal(onPreparedCalls, 0);
  assert.equal(contactCalls, 0);
});

test('per-class contact failures are collected (not thrown) so a partial refresh still resolves', async () => {
  const outcome = await runCounselRosterRefresh({
    prepare: async () => ({ classes: ['A', 'B'] }),
    onPrepared: () => {},
    syncContacts: async (cls) => {
      if (cls === 'B') throw new Error('연락처 조회 실패');
      return { entries: [] };
    },
    onProgress: () => {},
  });
  assert.equal(outcome.prepared, true);
  assert.deepEqual(outcome.classes, ['A', 'B']);
  assert.deepEqual(outcome.contactFailures, [{ cls: 'B', message: '연락처 조회 실패' }]);
});

test('reconcile counts are picked from the prepare payload and summarized for humans', () => {
  const rc = pickCounselReconcile({ added: 2, updated: 3, inactivated: 1, reactivated: 0, rosterCount: 40, counts: { active: 40 } });
  assert.deepEqual(rc, { added: 2, updated: 3, inactivated: 1, reactivated: 0, rosterCount: 40 });
  assert.equal(counselReconcileSummary(rc), '추가 2 · 수정 3 · 비활성 1');
  // 모든 수치가 0이면 '명단 변경 없음'
  assert.equal(counselReconcileSummary({ added: 0, updated: 0, inactivated: 0, reactivated: 0, rosterCount: 40 }), '명단 변경 없음');
  // 아무 수치도 없으면 null → 빈 문자열(요약 미표시)
  assert.equal(pickCounselReconcile({}), null);
  assert.equal(counselReconcileSummary(null), '');
  // rosterCount는 counts.active로도 보강된다
  assert.deepEqual(
    pickCounselReconcile({ counts: { active: 5 } }),
    { added: undefined, updated: undefined, inactivated: undefined, reactivated: undefined, rosterCount: 5 },
  );
});
