const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const calendarSource = fs.readFileSync(path.join(root, 'components/Calendar.tsx'), 'utf8');
const journalSource = fs.readFileSync(path.join(root, 'components/screens/LeadJournal.tsx'), 'utf8');
const stateSource = fs.readFileSync(path.join(root, 'lib/state.tsx'), 'utf8');

function section(text, from, to) {
  const start = text.indexOf(from);
  assert.notEqual(start, -1, `missing section start: ${from}`);
  const end = to ? text.indexOf(to, start + from.length) : text.length;
  assert.notEqual(end, -1, `missing section end: ${to}`);
  return text.slice(start, end);
}

test('Calendar keeps its two-week initial anchor but the Today button targets wi=0 inside the calendar scroller', () => {
  assert.match(calendarSource, /const anchorRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(calendarSource, /const todayRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(calendarSource, /const pend = useRef<\{ prevH: number \} \| null>\(null\)/);

  const initialScroll = section(calendarSource, '// 초기 1회:', "// '오늘' 버튼:");
  assert.match(initialScroll, /!didInit\.current && anchorRef\.current && scrollRef\.current/);
  assert.match(initialScroll, /scrollRef\.current\.scrollTop = anchorRef\.current\.offsetTop/);
  assert.match(initialScroll, /didInit\.current = true/);

  const todayJump = section(calendarSource, "// '오늘' 버튼:", '// 위쪽 확장 시 스크롤 점프 보정');
  assert.match(todayJump, /jump > 0 && todayRef\.current && scrollRef\.current/);
  assert.match(todayJump, /pend\.current = null;[\s\S]*scrollRef\.current\.scrollTop = todayRef\.current\.offsetTop/);
  assert.match(todayJump, /\}, \[jump\]\)/);

  assert.match(calendarSource, /ref=\{wi === -2 \? anchorRef : wi === 0 \? todayRef : undefined\}/);
  assert.match(
    calendarSource,
    /onClick=\{\(\) => \{ pend\.current = null; setRange\(\{ back: 4, fwd: 6 \}\); setJump\(\(j\) => j \+ 1\); \}\} title="오늘로">오늘<\/button>/,
  );
  assert.doesNotMatch(calendarSource, /scrollIntoView\s*\(/);
});

test('LeadJournal exposes a guarded inline editor only for current or future checklist items', () => {
  assert.match(journalSource, /const editable = sel && sel\.kind !== 'past'/);
  assert.match(journalSource, /const \[editId, setEditId\] = useState<string \| null>\(null\)/);
  assert.match(journalSource, /const \[editText, setEditText\] = useState\(''\)/);
  assert.match(journalSource, /const \[savingId, setSavingId\] = useState<string \| null>\(null\)/);

  assert.match(journalSource, /const startEdit = \(it: any\) => \{[^}]*setEditId\(it\.id\); setEditText\(it\.text \|\| ''\); \}/);
  assert.match(journalSource, /const cancelEdit = \(\) => \{[^}]*setEditId\(null\); setEditText\(''\); \}/);

  const itemRows = section(journalSource, '{(sel ? sel.items : []).map', '  const wtestCard = (');
  assert.match(itemRows, /if \(editable && editId === it\.id\)/);
  assert.match(itemRows, /maxLength=\{300\}/);
  assert.match(itemRows, /aria-label="체크리스트 항목 수정"/);
  assert.match(itemRows, /if \(e\.nativeEvent\.isComposing\) return/);
  assert.match(itemRows, /e\.key === 'Enter'[\s\S]*saveEdit\(it\.id\)/);
  assert.match(itemRows, /e\.key === 'Escape'[\s\S]*cancelEdit\(\)/);
  assert.match(itemRows, />저장<\/Btn>/);
  assert.match(itemRows, />취소<\/Btn>/);
  assert.match(itemRows, /\{editable \? <Btn[^>]*onClick=\{\(\) => startEdit\(it\)\}>수정<\/Btn> : null\}/);
  assert.doesNotMatch(itemRows, /sel\.kind === 'past'[\s\S]*>수정<\/Btn>/);
});

test('journal item save trims once, rejects blank input, and calls the stable-ID action', () => {
  const saveEdit = section(journalSource, 'const saveEdit = async (id: string) => {', 'const detailCard =');
  assert.match(saveEdit, /if \(savingId\) return/);
  assert.match(saveEdit, /const text = editText\.trim\(\)/);
  assert.match(saveEdit, /if \(!text\) return/);
  assert.match(saveEdit, /setSavingId\(id\)/);
  assert.match(saveEdit, /const ok = await App\.updateJournalItemText\(id, text\)/);
  assert.match(saveEdit, /if \(ok && editIdRef\.current === id\) \{[^}]*setEditId\(null\); setEditText\(''\); \}/);
  assert.match(saveEdit, /finally[\s\S]*setSavingId\(null\)/);
});

test('journal item state save returns a truthful result without an optimistic text overwrite', () => {
  const stateAction = section(stateSource, 'App.updateJournalItemText = async function', 'App.removeJournalItem = function');
  assert.match(stateAction, /Promise<boolean>/);
  assert.match(stateAction, /if \(inflight\.has\(key\)\) return false/);
  assert.match(stateAction, /api\.post\(`\/api\/journal-items\/\$\{encodeURIComponent\(id\)\}\/edit`, \{ text: normalized \}\)/);
  assert.match(stateAction, /if \(response && response\.state\) \{ App\.state = response\.state; render\(\); \}/);
  assert.match(stateAction, /return true/);
  assert.match(stateAction, /catch \(e: any\)[\s\S]*return false/);
  assert.doesNotMatch(stateAction, /if \(item\.id === id\) item\.text = normalized/);
});
