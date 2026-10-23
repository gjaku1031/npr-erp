const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, esModuleInterop: true },
}).outputText, file);
const { counselRecency } = require('../lib/counsel-recency.ts');

test('counsel age boundaries are 0–13 green, 14–20 yellow, and 21+ red', () => {
  for (const [days, tone] of [[0, 'success'], [13, 'success'], [14, 'warning'], [20, 'warning'], [21, 'destructive'], [60, 'destructive']]) {
    const last = new Date(Date.parse('2026-09-05T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);
    assert.deepEqual(counselRecency(last, '2026-09-05'), { days, tone, label: `D+${days}` });
  }
});

test('missing records, failed reads, invalid and future dates stay gray and distinguish their reason', () => {
  assert.equal(counselRecency(null, '2026-09-05').label, '상담 기록 없음');
  assert.equal(counselRecency(null, '2026-09-05', 'error').label, '확인 필요');
  for (const date of [null, '2026-09-06', '2026-02-30', 'not-a-date']) assert.equal(counselRecency(date, '2026-09-05').tone, 'neutral');
});
