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

const { runSequentialCounselRosterSync } = require('../lib/counsel-sync.ts');

test('all-class roster sync stays sequential, reports real percentages, and folds only the final response', async () => {
  const calls = [];
  const progress = [];
  let active = 0;
  let maxActive = 0;
  const result = await runSequentialCounselRosterSync(
    ['A', 'B', 'C'],
    async (cls, mode) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push([cls, mode]);
      await Promise.resolve();
      active -= 1;
      return mode === 'full' ? { state: { ok: true } } : { entries: [] };
    },
    (value) => progress.push([value.processed, value.percent, value.currentClass]),
  );
  assert.equal(maxActive, 1);
  assert.deepEqual(calls, [['A', 'delta'], ['B', 'delta'], ['C', 'full']]);
  assert.deepEqual(progress, [[0, 0, 'A'], [1, 33, 'B'], [2, 67, 'C'], [3, 100, '']]);
  assert.equal(result.finalStateFolded, true);
  assert.deepEqual(result.failures, []);
});

test('all-class roster sync continues after a class failure and exposes final-fold fallback need', async () => {
  const calls = [];
  const snapshots = [];
  const result = await runSequentialCounselRosterSync(
    ['A', 'B'],
    async (cls, mode) => {
      calls.push([cls, mode]);
      if (cls === 'B') throw new Error('last class failed');
      return { entries: [] };
    },
    (value) => snapshots.push(value),
  );
  assert.deepEqual(calls, [['A', 'delta'], ['B', 'full']]);
  assert.equal(result.finalStateFolded, false);
  assert.deepEqual(result.failures, [{ cls: 'B', message: 'last class failed' }]);
  assert.equal(snapshots.at(-1).percent, 100);
  assert.equal(snapshots.at(-1).failures.length, 1);
});
