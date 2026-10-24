const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const wizardPath = path.resolve(__dirname, '../components/screens/Wizard.tsx');

function loadWizardGate() {
  let source = fs.readFileSync(wizardPath, 'utf8');
  for (const functionName of ['taskGateDone', 'stepDone']) {
    const declaration = new RegExp(`function\\s+${functionName}\\s*\\(`);
    assert.match(source, declaration, `${functionName} must remain directly testable`);
    source = source.replace(declaration, `export function ${functionName}(`);
  }
  const { outputText } = ts.transpileModule(source, {
    fileName: wizardPath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
  });
  const mocks = {
    '@/lib/state': {},
    '@/components/ui': {},
    '@/components/Markdown': {},
    '@/lib/helpers': {},
  };
  const originalLoad = Module._load;
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const compiled = new Module(wizardPath, module);
    compiled.filename = wizardPath;
    compiled.paths = Module._nodeModulePaths(path.dirname(wizardPath));
    compiled._compile(outputText, wizardPath);
    return {
      stepDone: compiled.exports.stepDone,
      taskGateDone: compiled.exports.taskGateDone,
    };
  } finally {
    Module._load = originalLoad;
  }
}

const { stepDone, taskGateDone } = loadWizardGate();

function appWithTasks(tasks, myStatus = {}, reportDate = '2026-07-23') {
  const app = {
    state: {
      today: '2026-07-23',
      tasks: tasks.map((task, index) => ({
        id: `task-${index + 1}`,
        start: '2026-07-01',
        due: '2026-07-31',
        mt: false,
        counsel: false,
        specialCounsel: false,
        ...task,
      })),
    },
    ui: { wizard: { myStatus } },
  };
  app.reportDate = () => reportDate;
  return app;
}

test('unfinished counsel, special-counsel, and MT tasks do not block the Wizard report gate', () => {
  const app = appWithTasks([
    { counsel: true },
    { specialCounsel: true },
    { mt: true },
  ]);

  assert.equal(stepDone(app, 5), true);
  for (const task of app.state.tasks) assert.equal(taskGateDone(task, {}), true);
});

test('an unfinished normal task still blocks the Wizard report gate', () => {
  const app = appWithTasks([
    { counsel: true },
    { specialCounsel: true },
    { mt: true },
    { title: 'Normal checklist task' },
  ]);

  assert.equal(stepDone(app, 5), false);
  assert.equal(taskGateDone(app.state.tasks[3], {}), false);
});

test('a completed normal task allows submission alongside unfinished non-blocking task types', () => {
  const app = appWithTasks([
    { counsel: true },
    { specialCounsel: true },
    { mt: true },
    { title: 'Normal checklist task' },
  ], { 'task-4': false });

  assert.equal(stepDone(app, 5), true, 'both V and X are recorded states; only null/undefined is unfinished');
  assert.equal(taskGateDone(app.state.tasks[3], app.ui.wizard.myStatus), true);
});

test('out-of-period normal tasks are excluded from the daily report gate', () => {
  const app = appWithTasks([
    { title: 'Past', due: '2026-07-22' },
    { title: 'Future', start: '2026-07-24' },
  ]);

  assert.equal(stepDone(app, 5), true);
});

test('a past journal gates tasks by its report date instead of today', () => {
  const app = appWithTasks([
    { title: 'Only active on the past report date', start: '2026-07-20', due: '2026-07-22' },
    { title: 'Only active today', start: '2026-07-23', due: '2026-07-31' },
  ], { 'task-1': true }, '2026-07-22');

  assert.equal(stepDone(app, 5), true, 'the today-only task must not block a 7/22 journal');
});
