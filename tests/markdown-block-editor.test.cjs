const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const markdownPath = path.join(root, 'components/Markdown.tsx');
const markdownSource = fs.readFileSync(markdownPath, 'utf8');

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function section(text, from, to) {
  const start = text.indexOf(from);
  assert.notEqual(start, -1, `missing section start: ${from}`);
  const end = to ? text.indexOf(to, start + from.length) : text.length;
  assert.notEqual(end, -1, `missing section end: ${to}`);
  return text.slice(start, end);
}

function loadMarkdownModule() {
  const { outputText } = ts.transpileModule(markdownSource, {
    fileName: markdownPath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
  });
  const compiled = new Module(markdownPath, module);
  compiled.filename = markdownPath;
  compiled.paths = Module._nodeModulePaths(path.dirname(markdownPath));
  compiled._compile(outputText, markdownPath);
  return compiled.exports;
}

const {
  Markdown,
  MarkdownEditor,
  parseMarkdownBlocks,
  parseMarkdownLine,
  serializeMarkdownBlocks,
} = loadMarkdownModule();

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function renderEditor(props) {
  // useLayoutEffect의 정상적인 SSR 경고만 이 좁은 렌더 동안 숨긴다.
  const originalError = console.error;
  console.error = () => {};
  try {
    return renderToStaticMarkup(React.createElement(MarkdownEditor, props));
  } finally {
    console.error = originalError;
  }
}

test('block helpers preserve legacy plaintext and normalize supported Markdown predictably', () => {
  assert.equal(typeof parseMarkdownLine, 'function');
  assert.equal(typeof parseMarkdownBlocks, 'function');
  assert.equal(typeof serializeMarkdownBlocks, 'function');

  const legacyPlaintext = '첫 줄\n둘째 줄\n\n<script>alert(1)</script>';
  assert.equal(
    serializeMarkdownBlocks(parseMarkdownBlocks(legacyPlaintext)),
    legacyPlaintext,
    'existing plaintext must survive opening and saving without migration',
  );

  const legacyMarkdown = [
    '# 큰 제목',
    '## 중간 제목',
    '### 작은 제목',
    '* 예전 글머리',
    '- 새 글머리',
    '7) 예전 번호',
    '8. 다음 번호',
    '일반 문장',
  ].join('\r\n');
  const blocks = parseMarkdownBlocks(legacyMarkdown);
  assert.deepEqual(
    blocks.map(({ kind, text }) => [kind, text]),
    [
      ['h1', '큰 제목'],
      ['h2', '중간 제목'],
      ['h3', '작은 제목'],
      ['ul', '예전 글머리'],
      ['ul', '새 글머리'],
      ['ol', '예전 번호'],
      ['ol', '다음 번호'],
      ['p', '일반 문장'],
    ],
  );

  const serialized = serializeMarkdownBlocks(blocks);
  assert.equal(serialized, [
    '# 큰 제목',
    '## 중간 제목',
    '### 작은 제목',
    '- 예전 글머리',
    '- 새 글머리',
    '1. 예전 번호',
    '2. 다음 번호',
    '일반 문장',
  ].join('\n'));
  assert.equal(
    serializeMarkdownBlocks(parseMarkdownBlocks(serialized)),
    serialized,
    'canonical serialization must be stable on the next edit',
  );
  assert.deepEqual(parseMarkdownBlocks(''), [{ kind: 'p', text: '' }]);
});

test('todo block helpers round-trip unchecked and checked markers without changing legacy blocks', () => {
  const blocks = parseMarkdownBlocks('[ ] 전화하기\n[x] 문자 보내기\n[X] 기존 완료\n일반 문장');
  assert.deepEqual(blocks, [
    { kind: 'todo', text: '전화하기', checked: false },
    { kind: 'todo', text: '문자 보내기', checked: true },
    { kind: 'todo', text: '기존 완료', checked: true },
    { kind: 'p', text: '일반 문장' },
  ]);
  assert.equal(
    serializeMarkdownBlocks(blocks),
    '[ ] 전화하기\n[x] 문자 보내기\n[x] 기존 완료\n일반 문장',
    'checked markers are stored canonically with a lowercase x',
  );
});

test('todo renderer is disabled by default and returns the complete toggled Markdown only for an owner callback', () => {
  const sourceText = '# 일정\n[ ] 첫 항목\n[x] 둘째 항목\n끝';
  const readOnlyHtml = renderToStaticMarkup(React.createElement(Markdown, { text: sourceText }));
  assert.match(readOnlyHtml, /type="checkbox"[^>]*disabled=""/);
  assert.match(readOnlyHtml, /md-todo-done/);

  let nextValue = '';
  const rendered = Markdown({ text: sourceText, onTodoChange: (next) => { nextValue = next; } });
  const todoLabels = React.Children.toArray(rendered.props.children).filter((node) => node && node.props && /md-todo/.test(node.props.className || ''));
  assert.equal(todoLabels.length, 2);
  const firstInput = React.Children.toArray(todoLabels[0].props.children)[0];
  assert.equal(firstInput.props.disabled, false);
  firstInput.props.onChange();
  assert.equal(nextValue, '# 일정\n[x] 첫 항목\n[x] 둘째 항목\n끝');
});

test('read-only renderer emits headings, lists and plaintext while keeping links and HTML safe', () => {
  const html = renderToStaticMarkup(React.createElement(Markdown, {
    text: [
      '# 큰 제목',
      '## 중간 제목',
      '### 작은 제목',
      '- 첫 항목',
      '- 둘째 항목',
      '1. 첫 순서',
      '2. 둘째 순서',
      '일반 문장',
      '다음 줄',
      '<script>alert("xss")</script>',
      '[안전 링크](https://example.com/docs)',
      'https://safe.example/path.',
      '[차단 링크](javascript:alert(1))',
    ].join('\n'),
  }));

  assert.match(html, /<h3 class="md-h md-h1">큰 제목<\/h3>/);
  assert.match(html, /<h4 class="md-h md-h2">중간 제목<\/h4>/);
  assert.match(html, /<h5 class="md-h md-h3">작은 제목<\/h5>/);
  assert.match(html, /<ul class="md-ul"><li>첫 항목<\/li><li>둘째 항목<\/li><\/ul>/);
  assert.match(html, /<ol class="md-ol"><li>첫 순서<\/li><li>둘째 순서<\/li><\/ol>/);
  assert.match(html, /일반 문장<br\/>다음 줄/);

  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
  assert.match(html, /href="https:\/\/example\.com\/docs"[^>]*target="_blank"[^>]*rel="noreferrer noopener"/);
  assert.match(html, /href="https:\/\/safe\.example\/path"/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /\[차단 링크\]\(javascript:alert\(1\)\)/);
  assert.doesNotMatch(markdownSource, /dangerouslySetInnerHTML\s*=/);
});

test('multiline bold stays one strong run in notices while preserving each surface separator', () => {
  const text = [
    '**첫 줄',
    '둘째 줄**',
    'https://safe.example/path',
    '<script>alert("xss")</script>',
  ].join('\n');

  const bannerHtml = renderToStaticMarkup(React.createElement(Markdown, { text, inline: true }));
  assert.match(bannerHtml, /<strong>첫 줄<span[^>]*>·<\/span>둘째 줄<\/strong>/);
  assert.match(bannerHtml, /<\/strong><span[^>]*>·<\/span><a[^>]*href="https:\/\/safe\.example\/path"/);
  assert.doesNotMatch(bannerHtml, /\*\*/);
  assert.doesNotMatch(bannerHtml, /<script/i);
  assert.match(bannerHtml, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);

  const documentHtml = renderToStaticMarkup(React.createElement(Markdown, { text }));
  assert.match(documentHtml, /<strong>첫 줄<br\/>둘째 줄<\/strong>/);
  assert.match(documentHtml, /<\/strong><br\/><a[^>]*href="https:\/\/safe\.example\/path"/);
  assert.doesNotMatch(documentHtml, /\*\*/);
});

test('markdown polish CSS makes banner bold and keeps native todos aligned and accessible', () => {
  const css = source('public/app.css');
  assert.match(css, /\.md strong, \.md-inline strong \{ font-weight: 700; \}/);
  assert.match(css, /\.md-todo \{[^}]*display: flex;[^}]*align-items: flex-start;[^}]*gap: 8px;/);
  assert.match(css, /\.md-todo-box \{[^}]*width: 21px;[^}]*height: 21px;[^}]*accent-color: var\(--primary\);/);
  assert.match(css, /\.md-todo-box:focus-visible \{[^}]*outline: 2px solid var\(--ring\);[^}]*outline-offset: 2px;/);
  assert.match(css, /\.md-todo-box:disabled \{[^}]*cursor: default;/);
  assert.match(css, /\.md-todo-done \.md-todo-text \{[^}]*text-decoration: line-through;[^}]*color: var\(--muted-foreground\);/);

  const todoHtml = renderToStaticMarkup(React.createElement(Markdown, { text: '[x] 완료한 일정' }));
  assert.match(todoHtml, /<label class="md-todo md-todo-done">/);
  assert.match(todoHtml, /<input type="checkbox" class="md-todo-box"/);
  assert.match(todoHtml, /<input[^>]*disabled=""/);
  assert.match(todoHtml, /<input[^>]*checked=""/);
  assert.match(todoHtml, /<span class="md-todo-text">완료한 일정<\/span>/);
});

test('teacher notice banner renders full Markdown blocks and aligns badge/content/date cleanly', () => {
  const appRoot = source('components/AppRoot.tsx');
  const banner = section(appRoot, 'activeNotices.length ?', '<main className="app-main">');

  // 강사 배너는 전체 마크다운(제목/목록/굵게/링크/읽기전용 체크박스)을 그대로 보여준다 — inline 평면화 금지.
  assert.match(banner, /<Markdown text=\{n\.text\} \/>/);
  assert.doesNotMatch(banner, /<Markdown text=\{n\.text\} inline/);
  // 블록 마크다운(<div class="md">)을 인라인 <span>에 넣지 않도록 <div className="txt">로 감싼다.
  assert.match(banner, /<div className="txt"><Markdown text=\{n\.text\} \/><\/div>/);
  assert.doesNotMatch(banner, /<span className="txt">/);
  // 날짜는 스타일을 CSS 클래스로 옮겨 계약을 검증 가능하게 하고, 잉여 grow 스페이서는 제거한다.
  assert.match(banner, /<span className="banner-date">\{n\.meta\}<\/span>/);
  assert.doesNotMatch(banner, /className="grow"/);

  const css = source('public/app.css');
  // 배지·본문·날짜를 첫 줄 기준선에 맞춰 다중 줄 공지에서도 깔끔히 정렬한다.
  assert.match(css, /\.banner-row \{[^}]*align-items: baseline;/);
  // 본문 칸은 늘되 줄어들 수 있어(min-width:0) 긴 내용이 잘리지 않고 줄바꿈된다.
  assert.match(css, /\.banner-row \.txt \{[^}]*flex: 1 1 auto;[^}]*min-width: 0;/);
  // 평상 본문 굵기(500)는 강조(700)와 눈에 띄게 구분된다.
  assert.match(css, /\.banner-row \.txt \{[^}]*font-weight: 500;/);
  assert.match(css, /\.md strong, \.md-inline strong \{ font-weight: 700; \}/);
  // 날짜는 한 줄로 유지되어 본문과 겹치지 않는다.
  assert.match(css, /\.banner-date \{[^}]*white-space: nowrap;/);
});

test('live editor keeps the legacy toolbar and preview removed while allowing only the gated todo helper button', () => {
  const editorSource = section(markdownSource, 'export function MarkdownEditor', null);
  assert.equal((editorSource.match(/<button\b/g) || []).length, 1);
  assert.match(editorSource, /\{allowTodo && showTodoButton \? \([\s\S]*<button[^>]*onClick=\{addTodo\}>체크 항목 추가<\/button>/);
  assert.doesNotMatch(editorSource, /md-toolbar|md-tb-btn|md-preview|MarkdownPreview/);
  assert.doesNotMatch(editorSource, /surround\(|linePrefix\(/);
  assert.match(editorSource, /role="group"/);
  assert.match(editorSource, /aria-required=\{required \|\| undefined\}/);
  assert.match(editorSource, /onCompositionStart/);
  assert.match(editorSource, /clipboardData\.getData\('text\/plain'\)/);
  assert.match(editorSource, /e\.key === 'Enter'/);
  assert.match(editorSource, /e\.key === 'Backspace'/);
  assert.match(editorSource, /e\.key === 'ArrowUp'/);
  assert.match(editorSource, /e\.key === 'ArrowDown'/);
});

test('todo editing is opt-in and preserves literal todo markers when the feature is disabled', () => {
  const editorSource = section(markdownSource, 'export function MarkdownEditor', null);
  assert.match(editorSource, /allowTodo = false, showTodoButton = false/);
  assert.match(editorSource, /if \(allowTodo\) return parsed/);
  assert.match(editorSource, /b\.kind === 'todo' \? \{ kind: 'p', text: lines\[idx\] \} : b/);

  const defaultHtml = renderEditor({ ariaLabel: '일반 편집기', defaultValue: '[ ] 원문 유지' });
  assert.doesNotMatch(defaultHtml, /type="checkbox"/);
  assert.doesNotMatch(defaultHtml, /체크 항목 추가/);
  assert.match(defaultHtml, /<textarea[^>]*>\[ \] 원문 유지<\/textarea>/);

  const enabledHtml = renderEditor({ ariaLabel: '개인일정 편집기', defaultValue: '[ ] 할 일', allowTodo: true });
  assert.match(enabledHtml, /type="checkbox"/);
  assert.match(enabledHtml, /<textarea[^>]*>할 일<\/textarea>/);
  assert.doesNotMatch(enabledHtml, /체크 항목 추가/);

  const buttonHtml = renderEditor({ ariaLabel: '개인일정 편집기', allowTodo: true, showTodoButton: true });
  assert.match(buttonHtml, /<button[^>]*>체크 항목 추가<\/button>/);
});

test('todo marker, checkbox, Enter, Backspace, paste and helper button share the structural block contract', () => {
  const editorSource = section(markdownSource, 'export function MarkdownEditor', null);
  const change = section(editorSource, 'const handleChange =', 'const handleKeyDown =');
  const keydown = section(editorSource, 'const handleKeyDown =', 'const handlePaste =');
  const paste = section(editorSource, 'const handlePaste =', '// 체크박스 토글');
  const todoActions = section(editorSource, '// 체크박스 토글', 'const isEmptyDoc =');

  assert.match(change, /const tm = allowTodo \? \/\^\\\[\(\[ xX\]\)\\\] \$\/\.exec\(head\) : null/);
  assert.match(change, /kind: 'todo', checked: tm\[1\]\.toLowerCase\(\) === 'x'/);
  assert.match(keydown, /\(b\.kind === 'ul' \|\| b\.kind === 'ol' \|\| b\.kind === 'todo'\) && !b\.text/);
  assert.match(keydown, /next\[i\] = \{ \.\.\.b, kind: 'p' \}/);
  assert.match(keydown, /b\.kind === 'todo' \? b\.kind : 'p'/);
  assert.match(keydown, /if \(contKind === 'todo'\) created\.checked = false/);
  assert.match(keydown, /e\.key === 'Backspace' && s === 0 && en === 0/);
  assert.match(keydown, /if \(b\.kind !== 'p'\)/);
  assert.match(paste, /clipboardData\.getData\('text\/plain'\)/);
  assert.match(paste, /splitBlock\(i,/);
  assert.match(todoActions, /next\[i\] = \{ \.\.\.b, checked: !b\.checked \}/);
  assert.match(todoActions, /const created: EdBlock = \{ id: nextBlockId\(\), kind: 'todo', checked: false, text: '' \}/);
  assert.match(todoActions, /const at = idx >= 0 \? idx \+ 1 : blocks\.length/);
  assert.match(todoActions, /applyStructural\(next\)/);
  assert.match(editorSource, /b\.kind === 'todo' \? \([\s\S]*type="checkbox"[\s\S]*onChange=\{\(\) => toggleChecked\(i\)\}/);
});

test('full textarea resize is revision-driven while ordinary typing resizes only its own textarea', () => {
  const editorSource = section(markdownSource, 'export function MarkdownEditor', null);
  assert.match(editorSource, /const \[layoutRev, setLayoutRev\] = React\.useState\(0\)/);
  assert.match(editorSource, /const applyStructural = \(next: EdBlock\[\]\) => \{ setLayoutRev\(\(r\) => r \+ 1\); apply\(next\); \}/);

  const layoutEffect = section(editorSource, 'React.useLayoutEffect(() => {', '// 현재 블록 자리를');
  assert.match(layoutEffect, /refs\.current\.forEach\(\(ta\) => \{ ta\.style\.height = '0px'; ta\.style\.height = ta\.scrollHeight \+ 'px'; \}\)/);
  assert.match(layoutEffect, /\}, \[layoutRev\]\)/);

  const ordinaryChange = section(editorSource, '// 조합(IME) 중 포함', 'const handleKeyDown =');
  assert.match(ordinaryChange, /apply\(next\)/);
  assert.match(ordinaryChange, /ta\.style\.height = '0px'/);
  assert.match(ordinaryChange, /ta\.style\.height = ta\.scrollHeight \+ 'px'/);
  assert.doesNotMatch(ordinaryChange, /refs\.current\.forEach|applyStructural/);
});

test('task creation locks the modal body while saving and task details use the shared accessible shell', () => {
  const modalSource = source('components/modals/ModalHost.tsx');
  const shellSource = section(modalSource, 'function Shell(', '// ── 태그 선택:');
  assert.match(shellSource, /bodyRef\?: React\.RefObject<HTMLDivElement>/);
  assert.match(shellSource, /<div className="modal-bd" ref=\{bodyRef\}>/);

  const createSource = section(modalSource, 'function TaskCreateModal', '// ── 업무 상세');
  assert.match(createSource, /const bodyRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(createSource, /bodyRef\.current\.inert = submitting/);
  assert.match(createSource, /<Shell[^>]*bodyRef=\{bodyRef\}/);

  const detailSource = section(modalSource, 'function TaskDetailModal', 'function LogViewModal');
  assert.match(detailSource, /<Shell title=\{t\.title\} foot=\{foot\}>/);
  assert.match(detailSource, /<Badge tone=\{meta\.tone\} icon=\{meta\.emoji\}>\{t\.tag\}<\/Badge>/);
  assert.match(detailSource, /openModal\(\{ type: 'counselStatus'/);
  assert.match(detailSource, /<Markdown text=\{st\.reportText\}/);
  assert.match(detailSource, /<Btn variant="secondary" onClick=\{\(\) => App\.openTaskEdit\(t\.id\)\}>수정<\/Btn>/);
  assert.match(detailSource, /overflow: 'hidden', flexShrink: 0/);
  assert.doesNotMatch(detailSource, /maxHeight: 340|overflowY: 'auto'/);
  assert.doesNotMatch(detailSource, /<div className="overlay"/);
  assert.doesNotMatch(detailSource, /<div className="modal-wrap"/);

  const css = source('public/app.css');
  assert.match(css, /\.modal \{[^}]*100vh[^}]*100dvh[^}]*overflow: hidden;/);
  assert.match(css, /\.modal-hd \{[^}]*flex: 0 0 auto;/);
  assert.match(css, /\.modal-bd \{[^}]*min-height: 0;[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;[^}]*-webkit-overflow-scrolling: touch;/);
  assert.match(css, /\.modal-ft \{[^}]*flex: 0 0 auto;/);
});

test('todo props are wired only to owned personal-event editing and viewing', () => {
  const modal = source('components/modals/ModalHost.tsx');
  const modalCode = stripComments(modal);
  const eventCreate = section(modalCode, 'function EventCreateModal', 'function EventViewModal');
  const eventView = section(modalCode, 'function EventViewModal', 'function DayAddModal');

  assert.match(eventCreate, /<MarkdownEditor[\s\S]*\.\.\.\(!isTeam \? \{ allowTodo: true, showTodoButton: true \} : \{\}\)/);
  assert.match(eventView, /<Markdown[\s\S]*\.\.\.\(e\.type === 'personal' && e\.mine \? \{ onTodoChange: \(next: any\) => App\.updateEventTodo\(e\.id, next\) \} : \{\}\)/);
  assert.equal((modalCode.match(/\ballowTodo\b/g) || []).length, 1);
  assert.equal((modalCode.match(/\bshowTodoButton\b/g) || []).length, 1);
  assert.equal((modalCode.match(/\bonTodoChange\b/g) || []).length, 1);

  for (const file of [
    'components/screens/LeadNotice.tsx',
    'components/screens/TeacherTasks.tsx',
    'components/screens/Wizard.tsx',
    'components/AppRoot.tsx',
  ]) {
    assert.doesNotMatch(stripComments(source(file)), /\ballowTodo\b|\bshowTodoButton\b|\bonTodoChange\b/, `${file} must remain outside personal todo editing`);
  }
});

test('notices, task descriptions/reports and Wizard checklist reports share the live editor and renderer', () => {
  const modal = source('components/modals/ModalHost.tsx');
  const teacherTasks = source('components/screens/TeacherTasks.tsx');
  const wizard = source('components/screens/Wizard.tsx');
  const notice = source('components/screens/LeadNotice.tsx');
  const appRoot = source('components/AppRoot.tsx');
  const leadDash = source('components/screens/LeadDash.tsx');

  const taskCreate = section(modal, 'function TaskCreateModal', 'function TaskDetailModal');
  const taskDetail = section(modal, 'function TaskDetailModal', 'function LogViewModal');
  const logView = section(modal, 'function LogViewModal', '// ── 태그 관리');
  const wizardStep1 = section(wizard, 'function Step1()', '// STEP 2 알림장');

  assert.match(taskCreate, /<MarkdownEditor label="업무 내용"/);
  assert.match(taskDetail, /<Markdown text=\{t\.descr\}/);
  assert.match(taskDetail, /<Markdown text=\{st\.reportText\}/);
  assert.match(logView, /<Markdown text=\{l\.body\}/);

  assert.match(notice, /<MarkdownEditor[\s\S]*label="공지 내용"/);
  assert.match(notice, /<Markdown text=\{n\.text\}/);
  assert.match(appRoot, /<Markdown text=\{n\.text\} \/>/);
  assert.match(leadDash, /<Markdown text=\{n\.text\} inline/);

  assert.match(teacherTasks, /<MarkdownEditor[\s\S]*defaultValue=\{report\.text\}[\s\S]*App\.saveTaskReport/);
  assert.match(teacherTasks, /<Markdown text=\{t\.descr\}/);
  assert.match(wizardStep1, /<MarkdownEditor[\s\S]*defaultValue=\{s\.report\}[\s\S]*App\.markDirty\(\)/);
  assert.match(wizard, /<Markdown text=\{t\.descr\}/);

  for (const text of [taskCreate, notice, teacherTasks, wizardStep1]) {
    assert.doesNotMatch(text, /서식 툴바|미리보기/);
  }
});

test('task-create tag chooser exposes color, emoji and system tags as an accessible radio group', () => {
  const modal = source('components/modals/ModalHost.tsx');
  const tagField = section(modal, 'function TagField', '// ── 업무 생성/수정');
  const taskCreate = section(modal, 'function TaskCreateModal', 'function TaskDetailModal');

  assert.match(tagField, /role="radiogroup"/);
  assert.match(tagField, /role="radio"/);
  assert.match(tagField, /aria-checked=\{on\}/);
  assert.match(tagField, /tagMeta\(name, tags\)/);
  assert.match(tagField, /background: meta\.edge/);
  assert.match(tagField, /meta\.emoji/);
  assert.match(tagField, /def\?\.fixed/);
  assert.match(tagField, />시스템<\/span>/);
  assert.match(tagField, /ArrowRight/);
  assert.match(tagField, /ArrowLeft/);

  assert.match(taskCreate, /<TagField tags=\{S\.tags\}/);
  assert.doesNotMatch(taskCreate, /<Select\s+label="태그"/);
  assert.match(taskCreate, /name !== SPECIAL_COUNSEL_TAG \|\| specialEnabled \|\| d\.tag === SPECIAL_COUNSEL_TAG/);
  assert.match(taskCreate, /기존 상담 업무/);
});

test('literal ERP payload editors remain plain text instead of block Markdown', () => {
  const modal = source('components/modals/ModalHost.tsx');
  const wizard = source('components/screens/Wizard.tsx');
  const notebook = section(wizard, 'function Step2()', '// STEP 3 상담');
  const counsel = section(modal, 'function CounselSendModal', '// ── 학생 상담 상세');
  const absence = section(modal, 'function CounselAbsenceModal', null);

  assert.match(notebook, /<DraftTextArea[\s\S]*label="내용"[\s\S]*bodyDraft/);
  assert.doesNotMatch(notebook, /<MarkdownEditor/);

  assert.match(counsel, /<textarea[^>]*className="ta"[\s\S]*value=\{content\}/);
  assert.doesNotMatch(counsel, /<MarkdownEditor/);

  assert.match(absence, /<textarea[^>]*id=\{contentId\}[\s\S]*value=\{content\}/);
  assert.doesNotMatch(absence, /<MarkdownEditor/);
});
