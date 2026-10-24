const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const teacherLogSource = fs.readFileSync(path.join(root, 'components/screens/TeacherLog.tsx'), 'utf8');
const wizardSource = fs.readFileSync(path.join(root, 'components/screens/Wizard.tsx'), 'utf8');
const stateSource = fs.readFileSync(path.join(root, 'lib/state.tsx'), 'utf8');

function section(text, from, to) {
  const start = text.indexOf(from);
  assert.notEqual(start, -1, `missing section start: ${from}`);
  const end = to ? text.indexOf(to, start + from.length) : text.length;
  assert.notEqual(end, -1, `missing section end: ${to}`);
  return text.slice(start, end);
}

test('past journal rows distinguish missing, draft, and submitted actions', () => {
  const pastRows = section(teacherLogSource, '<Card flush title="지난 일일보고">', '</Card>');

  assert.match(pastRows, /p\.status === 'submitted'/);
  assert.match(pastRows, /p\.status === 'draft'/);
  assert.match(pastRows, /label: '미제출'/);
  assert.match(pastRows, /label: '임시저장'/);
  assert.match(pastRows, /App\.enterWizard\(p\.date\)/);
  assert.match(pastRows, /App\.openLogView\(S\.me\.name, p\.date\)/);
  assert.match(pastRows, /'이어서 작성 →'/);
  assert.match(pastRows, /'작성하기 →'/);
});

test('past journal entry reads the exact report date and aborts safely on read failure', () => {
  const enterWizard = section(stateSource, 'App.enterWizard = async function', 'App.exitWizard = function');

  assert.match(enterWizard, /const reportDate = date \|\| S\.today/);
  assert.match(enterWizard, /S\.journals\.find\(\(j: any\) => j\.date === reportDate\)/);
  assert.match(enterWizard, /api\.get\(`\/api\/reports\/\$\{encodeURIComponent\(S\.me\.name\)\}\/\$\{reportDate\}`\)/);
  assert.match(enterWizard, /catch \(e: any\) \{ toast\('지난 일일보고를 불러오지 못했습니다: ' \+ e\.message\); return; \}/);
  assert.doesNotMatch(enterWizard, /catch\s*\{\s*report\s*=\s*null/);
  assert.match(enterWizard, /reportDate, cl, nbByClass/);
  assert.match(enterWizard, /classesForDate\(S, reportDate, S\.me, specialPeriod\)/);
});

test('wizard persistence and date-sensitive integrations use the selected report date', () => {
  assert.match(stateSource, /App\.reportDate = function/);
  assert.match(stateSource, /\/\$\{App\.reportDate\(\)\}\/draft/);
  assert.match(stateSource, /\/\$\{App\.reportDate\(\)\}\/submit/);
  assert.match(stateSource, /ttt\/attendance\?cls=\$\{encodeURIComponent\(cls\)\}&date=\$\{App\.reportDate\(\)\}/);
  assert.match(stateSource, /ttt\/counsel\?date=\$\{App\.reportDate\(\)\}/);
  assert.match(stateSource, /api\.post\('\/api\/ttt\/notebook', \{ cls, date: App\.reportDate\(\)/);

  assert.match(wizardSource, /const reportDate = App\.reportDate\(\)/);
  assert.match(wizardSource, /koDateFull\(reportDate\)/);
  assert.match(wizardSource, /reportDate < S\.today \? <Badge tone="neutral">지난 보고 작성<\/Badge>/);
  assert.match(wizardSource, /S\.journals\.find\(\(j: any\) => j\.date === reportDate\)/);
  assert.match(wizardSource, /groupOf\(reportDate\)/);
  assert.match(wizardSource, /koDate\(reportDate\)\}<span className="muted" style=\{\{ fontWeight: 400 \}\}> — 일일보고 날짜/);
});
