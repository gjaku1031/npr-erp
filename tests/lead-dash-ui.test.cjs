const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dashSource = fs.readFileSync(path.join(root, 'components/screens/LeadDash.tsx'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'public/app.css'), 'utf8');

function section(text, from, to) {
  const start = text.indexOf(from);
  assert.notEqual(start, -1, `missing section start: ${from}`);
  const end = to ? text.indexOf(to, start + from.length) : text.length;
  assert.notEqual(end, -1, `missing section end: ${to}`);
  return text.slice(start, end);
}

test('LeadDash stacks the submit-status card full-width below the calendar, then the task/notice split', () => {
  assert.match(dashSource, /<Card title="오늘 일일보고 제출 현황"/);
  assert.match(dashSource, /<Card title="업무별 진행"/);
  assert.match(dashSource, /<Card\s+title="공지사항"/);

  const belowCalendar = section(dashSource, '<CalendarCard />');
  assert.match(
    belowCalendar,
    /<div className="lead-dash-stack">\s*\{submitCard\}\s*<div className="lead-dash-split">\s*\{taskCard\}\s*\{noticeCard\}\s*<\/div>\s*<\/div>/,
  );
  assert.doesNotMatch(dashSource, /gridTemplateColumns: '1\.3fr 1fr'/);
});

test('lead-dash split uses equal minmax(0,1fr) columns and collapses to one column under 900px', () => {
  assert.match(cssSource, /^\.lead-dash-stack \{ display: flex; flex-direction: column; gap: 16px; \}$/m);
  assert.match(cssSource, /^\.lead-dash-split \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: 16px; align-items: start; \}$/m);
  assert.match(cssSource, /@media \(max-width: 900px\) \{\s*\.lead-dash-split \{ grid-template-columns: 1fr; \}\s*\}/);
});

test('notice preview keeps single-line truncation so long markdown cannot widen the notice column', () => {
  const noticeCard = section(dashSource, 'const noticeCard = (', 'const taskCard = (');
  assert.match(noticeCard, /overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'/);
  assert.match(noticeCard, /<Markdown text=\{n\.text\} inline \/>/);
});
