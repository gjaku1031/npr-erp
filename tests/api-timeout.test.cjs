const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const apiPath = path.resolve(__dirname, '../lib/api.ts');

function loadApi() {
  const source = fs.readFileSync(apiPath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: apiPath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
    },
  });
  const compiled = new Module(apiPath, module);
  compiled.filename = apiPath;
  compiled.paths = Module._nodeModulePaths(path.dirname(apiPath));
  compiled._compile(outputText, apiPath);
  return compiled.exports;
}

test('special-counsel, absence, and quarter-start ERP requests wait for the long server response window', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const delays = [];
  global.fetch = async () => ({ ok: true, text: async () => '{"ok":true}' });
  global.setTimeout = (_callback, delay) => { delays.push(delay); return { delay }; };
  global.clearTimeout = () => {};

  try {
    const { req, setAuthCtx } = loadApi();
    setAuthCtx('lead', 'admin');

    await req('POST', '/api/tasks', { title: 'Special', specialCounsel: true });
    await req('POST', '/api/tasks/task-1/edit', { title: 'Special', specialCounsel: true });
    await req('POST', '/api/tasks', { title: 'Tagged special', tag: ' 특강 상담 ' });
    await req('POST', '/api/counsel/entry/entry-1/reconcile', {});
    await req('POST', '/api/counsel/entry/entry-1/absence', { content: '문자 안내' });
    await req('POST', '/api/counsel/absence/attempt-1/reconcile', {});
    await req('POST', '/api/regular-classes/quarter-start', { targetDate: '2026-09-01', dryRun: true });
    await req('POST', '/api/tasks', { title: 'Normal', specialCounsel: false });

    assert.deepEqual(delays, [125000, 125000, 125000, 125000, 125000, 125000, 125000, 28000]);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});
