import React from 'react';

/**
 * 아주 가벼운 마크다운 렌더러 + 라이브 블록 에디터 (외부 의존성 없음).
 * 노션식 기본 문법만 지원: 알림장 제외한 업무/일정/공지 등의 표시에 사용.
 *   # ## ###  → 제목
 *   * / -     → 글머리표 목록
 *   1. / 1)   → 번호 목록
 *   **굵게**  → strong
 * dangerouslySetInnerHTML 미사용(JSX로 구성) — XSS 안전.
 */

// 인라인 텍스트 조각 안의 개행 처리: 일반 단락(nl='br')은 <br>, 배너/인라인(nl='dot')은 가운뎃점(·)으로 잇는다.
// nl이 없으면(제목·목록 등 본디 한 줄) 개행 변환 없이 원문 그대로 둔다.
function textRun(text: string, nl: 'br' | 'dot' | undefined, keyBase: string): React.ReactNode[] {
  if (!nl || text.indexOf('\n') < 0) return text ? [text] : [];
  const out: React.ReactNode[] = [];
  text.split('\n').forEach((seg, k) => {
    if (k) out.push(nl === 'br'
      ? <br key={keyBase + 'br' + k} />
      : <span key={keyBase + 'dot' + k} style={{ opacity: 0.4, padding: '0 6px' }}>·</span>);
    if (seg) out.push(seg);
  });
  return out;
}

// 인라인: [라벨](url) 링크, 맨 URL(http/https), **굵게** 처리 (링크는 새 탭 + 클릭 전파 차단).
// 여러 줄을 한 번에 받아 처리하므로 **굵게** 가 줄 경계를 넘어도 이어진다. nl은 조각 안 개행을 어떻게 이을지 정한다.
function inline(text: string, keyBase: string, nl?: 'br' | 'dot'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s]+)|\*\*([^*]+?)\*\*/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(...textRun(text.slice(last, m.index), nl, keyBase + '-p' + i));
    if (m[2]) {
      out.push(<a key={keyBase + '-l' + i++} className="md-link" href={m[2]} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>{m[1]}</a>);
    } else if (m[3]) {
      let url = m[3]; let trail = '';
      const tm = url.match(/[).,;:!?]+$/); // URL 뒤 문장부호는 링크에서 제외
      if (tm) { trail = tm[0]; url = url.slice(0, -trail.length); }
      out.push(<a key={keyBase + '-u' + i++} className="md-link" href={url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>{url}</a>);
      if (trail) out.push(trail);
    } else if (m[4]) {
      const bk = keyBase + '-b' + i++;
      out.push(<strong key={bk}>{textRun(m[4], nl, bk)}</strong>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...textRun(text.slice(last), nl, keyBase + '-e'));
  return out.length ? out : [text];
}

export function Markdown({ text, className, style, inline: inlineMode, onTodoChange }: { text?: string; className?: string; style?: React.CSSProperties; inline?: boolean; onTodoChange?: (nextMarkdown: string) => void }) {
  const src = (text || '').replace(/\r\n/g, '\n');
  if (!src.trim()) return null;

  // 인라인 모드: 배너 등 한 줄 표시용 — 줄마다 블록 마커(#, -, *, 1.) 제거 + 빈 줄 제외 후, 남은 줄을
  // 하나로 이어 '한 번만' 파싱한다. 그래야 굵게(**)가 줄 경계를 넘어도 이어지고, 줄 사이는 가운뎃점(·)으로 연결된다.
  if (inlineMode) {
    const joined = src.split('\n')
      .map((raw) => raw.trim().replace(/^(#{1,3}|[*+-]|\d+[.)]|\[[ xX]\])\s+/, ''))
      .filter((line) => line !== '')
      .join('\n');
    return <span className={'md-inline' + (className ? ' ' + className : '')} style={style}>{inline(joined, 'inl', 'dot')}</span>;
  }

  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (!para.length) return;
    const key = 'p' + blocks.length;
    // 문단 전체를 한 번에 파싱 — 굵게(**)가 줄 경계를 넘을 수 있게 하고, 줄바꿈은 <br>로 유지한다.
    blocks.push(<p key={key} className="md-p">{inline(para.join('\n'), key, 'br')}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = 'l' + blocks.length;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, key + i)}</li>);
    blocks.push(list.ordered ? <ol key={key} className="md-ol">{items}</ol> : <ul key={key} className="md-ul">{items}</ul>);
    list = null;
  };

  const lines = src.split('\n');
  // 콜백이 있을 때만 체크박스를 활성화한다. 토글하면 그 줄의 마커([ ]↔[x])만 바꾼
  // 전체 마크다운을 콜백으로 돌려주고 나머지 줄은 원문 그대로 보존한다.
  const toggleTodo = onTodoChange
    ? (li: number, checked: boolean) => {
        const next = lines.slice();
        next[li] = next[li].replace(/^\[[ xX]\]/, checked ? '[ ]' : '[x]');
        onTodoChange(next.join('\n'));
      }
    : undefined;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].replace(/\s+$/, '');
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const todo = /^\[([ xX])\]\s+(.*)$/.exec(line);
    const ul = /^[*-]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (h) {
      flushPara(); flushList();
      const lv = h[1].length; const key = 'h' + blocks.length; const inner = inline(h[2], key);
      const Tag = (lv === 1 ? 'h3' : lv === 2 ? 'h4' : 'h5') as any;
      blocks.push(<Tag key={key} className={'md-h md-h' + lv}>{inner}</Tag>);
    } else if (todo) {
      flushPara(); flushList();
      const key = 't' + blocks.length;
      const checked = todo[1].toLowerCase() === 'x';
      blocks.push(
        <label key={key} className={'md-todo' + (checked ? ' md-todo-done' : '')}>
          <input
            type="checkbox"
            className="md-todo-box"
            checked={checked}
            disabled={!toggleTodo}
            onChange={toggleTodo ? () => toggleTodo(li, checked) : undefined}
          />
          <span className="md-todo-text">{inline(todo[2], key)}</span>
        </label>,
      );
    } else if (ul) {
      flushPara();
      if (!list || list.ordered) { flushList(); list = { ordered: false, items: [] }; }
      list.items.push(ul[1]);
    } else if (ol) {
      flushPara();
      if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [] }; }
      list.items.push(ol[1]);
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else {
      flushList(); para.push(line);
    }
  }
  flushPara(); flushList();

  return <div className={'md' + (className ? ' ' + className : '')} style={style}>{blocks}</div>;
}

/* ── 블록 모델 (라이브 에디터 ↔ 마크다운 문자열) ──────────────────────────
 * 저장 계약은 지금까지와 같은 '마크다운 평문 문자열'이다. 한 줄 = 한 블록으로
 * 해석하며 규칙이 위 렌더러와 동일해 기존 평문/마크다운이 마이그레이션 없이
 * 그대로 열리고, 편집 화면과 읽기 화면이 항상 같은 구조로 보인다.
 * 순수 함수로 분리해 단위 테스트에서 파싱↔직렬화 왕복 호환을 검증할 수 있다. */
export type MdBlockKind = 'p' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'todo';
export type MdBlockData = { kind: MdBlockKind; text: string; checked?: boolean };

const H_RE = /^(#{1,3})\s+(.*)$/;
const TODO_RE = /^\[([ xX])\]\s+(.*)$/;
const UL_RE = /^[*-]\s+(.*)$/;
const OL_RE = /^\d+[.)]\s+(.*)$/;

export function parseMarkdownLine(line: string): MdBlockData {
  const h = H_RE.exec(line);
  if (h) return { kind: ('h' + h[1].length) as MdBlockKind, text: h[2] };
  const todo = TODO_RE.exec(line);
  if (todo) return { kind: 'todo', text: todo[2], checked: todo[1].toLowerCase() === 'x' };
  const ul = UL_RE.exec(line);
  if (ul) return { kind: 'ul', text: ul[1] };
  const ol = OL_RE.exec(line);
  if (ol) return { kind: 'ol', text: ol[1] };
  return { kind: 'p', text: line };
}

// 빈 문자열도 편집을 시작할 수 있게 항상 1개 이상의 블록을 돌려준다(''.split('\n') → ['']).
export function parseMarkdownBlocks(src?: string): MdBlockData[] {
  return String(src ?? '').replace(/\r\n?/g, '\n').split('\n').map(parseMarkdownLine);
}

// 번호 목록은 연속 구간별 1..n으로 직렬화 — 렌더러(list-style: decimal)도 원본 번호를
// 무시하고 1부터 매기므로 편집·저장·표시가 같은 번호를 보인다.
export function serializeMarkdownBlocks(blocks: MdBlockData[]): string {
  let no = 0;
  return blocks
    .map((b, i) => {
      if (b.kind === 'ol') { no = i > 0 && blocks[i - 1].kind === 'ol' ? no + 1 : 1; return `${no}. ${b.text}`; }
      if (b.kind === 'ul') return `- ${b.text}`;
      if (b.kind === 'todo') return `[${b.checked ? 'x' : ' '}] ${b.text}`;
      if (b.kind === 'h1') return `# ${b.text}`;
      if (b.kind === 'h2') return `## ${b.text}`;
      if (b.kind === 'h3') return `### ${b.text}`;
      return b.text;
    })
    .join('\n');
}

type EdBlock = MdBlockData & { id: string };
let mdSeq = 0;
const nextBlockId = () => 'mdb' + (++mdSeq);
const withIds = (arr: MdBlockData[]): EdBlock[] => arr.map((b) => ({ ...b, id: nextBlockId() }));

const markerToKind = (mark: string): MdBlockKind =>
  mark === '#' ? 'h1' : mark === '##' ? 'h2' : mark === '###' ? 'h3' : mark === '-' || mark === '*' ? 'ul' : 'ol';

const KIND_LABEL: Record<MdBlockKind, string> = { p: '단락', h1: '제목 1', h2: '제목 2', h3: '제목 3', ul: '글머리 항목', ol: '번호 항목', todo: '할 일' };
// 편집 중 타이포가 읽기 렌더(.md-h1~3, 14px 기준)와 같게 보이도록 맞춘 스타일.
const KIND_STYLE: Record<MdBlockKind, { fontSize: number; lineHeight: number; fontWeight?: number }> = {
  p: { fontSize: 14, lineHeight: 1.6 },
  h1: { fontSize: 16.5, lineHeight: 1.45, fontWeight: 700 },
  h2: { fontSize: 15, lineHeight: 1.5, fontWeight: 700 },
  h3: { fontSize: 14, lineHeight: 1.55, fontWeight: 700 },
  ul: { fontSize: 14, lineHeight: 1.6 },
  ol: { fontSize: 14, lineHeight: 1.6 },
  todo: { fontSize: 14, lineHeight: 1.6 },
};

/**
 * 마크다운 라이브 블록 에디터 — 툴바·미리보기 없는 한 장의 편집 화면.
 * 빈 블록에서 '# '·'## '·'### '·'- '·'1. '을 입력하면 마커를 숨기고 그 블록을
 * 즉시 제목/목록으로 바꾼다(노션식). 값은 항상 마크다운 문자열로 저장한다.
 * 블록 textarea는 제어 컴포넌트지만 같은 DOM 노드를 재사용하고, 조합(IME) 중에는
 * 텍스트 반영만 하고 변환·분할을 하지 않아 한글 입력이 안전하다.
 * 값이 외부에서 바뀌어 다시 반영해야 하면 상위에서 key를 바꿔 remount 할 것.
 */
export function MarkdownEditor(props: {
  label?: React.ReactNode; required?: boolean; rows?: number; placeholder?: string;
  defaultValue?: string; onInput?: (v: string) => void; hint?: string; ariaLabel?: string;
  allowTodo?: boolean; showTodoButton?: boolean;
}) {
  const { label, required, rows = 4, placeholder = '', defaultValue = '', onInput, hint, ariaLabel, allowTodo = false, showTodoButton = false } = props;
  // 할 일은 allowTodo를 켠 화면(개인 일정 등)에서만 블록으로 다룬다. 끈 화면에서는 파싱된
  // 할 일 줄을 원본 마커([ ]/[x])까지 그대로 가진 단락으로 되돌려 평문처럼 편집·저장한다.
  const parseEditorBlocks = (src?: string): MdBlockData[] => {
    const parsed = parseMarkdownBlocks(src);
    if (allowTodo) return parsed;
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
    return parsed.map((b, idx): MdBlockData => (b.kind === 'todo' ? { kind: 'p', text: lines[idx] } : b));
  };
  const [blocks, setBlocks] = React.useState<EdBlock[]>(() => withIds(parseEditorBlocks(defaultValue)));
  const [focused, setFocused] = React.useState(false);
  // 구조 개정(revision): 추가·삭제·서식전환·분할·버튼 조작 등 레이아웃이 바뀌는 편집에서만 올린다.
  // 이 값이 바뀔 때에만 전 블록 높이를 다시 재고 캐럿을 복원한다(일반 타이핑은 해당 textarea만).
  const [layoutRev, setLayoutRev] = React.useState(0);
  const refs = React.useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const caretRef = React.useRef<{ id: string; pos: number } | null>(null);
  const lastFocusedId = React.useRef<string | null>(null); // 버튼 삽입 위치용: 마지막으로 포커스한 블록
  const composing = React.useRef(false);
  const labelId = React.useId();

  // 사용자 편집 때만 상위로 전달 — 마운트만으로 onInput/자동저장이 발생하지 않는다.
  const apply = (next: EdBlock[]) => { setBlocks(next); onInput?.(serializeMarkdownBlocks(next)); };
  // 구조가 바뀌는 편집은 개정을 올려 아래 레이아웃 이펙트(전 블록 리사이즈 + 캐럿 복원)를 태운다.
  const applyStructural = (next: EdBlock[]) => { setLayoutRev((r) => r + 1); apply(next); };

  React.useLayoutEffect(() => {
    // 구조 개정 때(그리고 최초 마운트)만: 전 블록 자동 높이 재계산 + 예약된 캐럿 복원.
    refs.current.forEach((ta) => { ta.style.height = '0px'; ta.style.height = ta.scrollHeight + 'px'; });
    const want = caretRef.current;
    if (want) {
      caretRef.current = null;
      const ta = refs.current.get(want.id);
      if (ta) { ta.focus(); const p = Math.max(0, Math.min(want.pos, ta.value.length)); ta.setSelectionRange(p, p); }
    }
  }, [layoutRev]);

  // 현재 블록 자리를 여러 줄 텍스트로 대체(붙여넣기·IME 개행) — 줄마다 마커를 해석해 블록으로.
  // tailLen: 원래 블록에서 삽입 지점 뒤에 있던 글자 수. 캐럿을 마지막 블록의 그 앞에 놓는다.
  const splitBlock = (i: number, combined: string, tailLen: number) => {
    const cur = blocks[i];
    const parsed = withIds(parseEditorBlocks(combined));
    parsed[0] = { ...parsed[0], id: cur.id }; // 첫 조각은 같은 DOM 노드 재사용
    if (cur.kind !== 'p' && parsed[0].kind === 'p') { // 목록/제목/할 일 중간 삽입에도 서식 유지
      parsed[0] = { ...parsed[0], kind: cur.kind };
      if (cur.kind === 'todo') parsed[0].checked = cur.checked;
    }
    const next = blocks.slice(0, i).concat(parsed, blocks.slice(i + 1));
    const lastB = parsed[parsed.length - 1];
    caretRef.current = { id: lastB.id, pos: Math.max(0, lastB.text.length - tailLen) };
    applyStructural(next);
  };

  const handleChange = (i: number, e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const b = blocks[i];
    const ta = e.currentTarget;
    const value = ta.value;
    if (!composing.current) {
      // 모바일 IME처럼 keydown 없이 개행이 들어오면 붙여넣기와 같은 규칙으로 분할한다.
      if (value.indexOf('\n') >= 0) {
        const caret = ta.selectionStart ?? value.length;
        splitBlock(i, value, value.length - caret);
        return;
      }
      // 단락 시작에서 마커+공백을 캐럿 직전까지 입력한 순간 → 마커를 숨기고 블록 서식 전환.
      if (b.kind === 'p') {
        const caret = ta.selectionStart ?? value.length;
        const head = value.slice(0, caret);
        // '[ ] '·'[x] ' → 할 일. allowTodo를 켠 화면에서만 전환하고, 끈 화면에선 평문으로 남는다.
        const tm = allowTodo ? /^\[([ xX])\] $/.exec(head) : null;
        if (tm) {
          const next = blocks.slice();
          next[i] = { id: b.id, kind: 'todo', checked: tm[1].toLowerCase() === 'x', text: value.slice(caret) };
          caretRef.current = { id: b.id, pos: 0 };
          applyStructural(next);
          return;
        }
        // '# '·'- '·'1. ' 등.
        const m = /^(#{1,3}|[*-]|\d+[.)]) $/.exec(head);
        if (m) {
          const next = blocks.slice();
          next[i] = { id: b.id, kind: markerToKind(m[1]), text: value.slice(caret) };
          caretRef.current = { id: b.id, pos: 0 };
          applyStructural(next);
          return;
        }
      }
    }
    // 조합(IME) 중 포함, 텍스트는 항상 그대로 반영. 구조는 그대로이므로 이 textarea만 리사이즈한다.
    const next = blocks.slice();
    next[i] = { ...b, text: value };
    apply(next);
    ta.style.height = '0px';
    ta.style.height = ta.scrollHeight + 'px';
  };

  const handleKeyDown = (i: number) => (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 조합 중 Enter/Backspace는 조합 확정용 — 블록 조작으로 바꾸지 않는다.
    if (composing.current || (e.nativeEvent as any).isComposing || e.keyCode === 229) return;
    const ta = e.currentTarget; const b = blocks[i];
    const s = ta.selectionStart ?? 0, en = ta.selectionEnd ?? s;
    if (e.key === 'Enter') {
      e.preventDefault();
      if ((b.kind === 'ul' || b.kind === 'ol' || b.kind === 'todo') && !b.text) {
        // 빈 목록/할 일 항목에서 Enter → 서식 해제(단락으로).
        const next = blocks.slice(); next[i] = { ...b, kind: 'p' };
        caretRef.current = { id: b.id, pos: 0 };
        applyStructural(next);
        return;
      }
      // 목록·할 일은 다음 항목으로 이어지고(할 일은 새 항목이 미완료), 제목·단락 다음은 단락.
      const contKind: MdBlockKind = b.kind === 'ul' || b.kind === 'ol' || b.kind === 'todo' ? b.kind : 'p';
      const created: EdBlock = { id: nextBlockId(), kind: contKind, text: b.text.slice(en) };
      if (contKind === 'todo') created.checked = false;
      const next = blocks.slice();
      next[i] = { ...b, text: b.text.slice(0, s) };
      next.splice(i + 1, 0, created);
      caretRef.current = { id: created.id, pos: 0 };
      applyStructural(next);
      return;
    }
    if (e.key === 'Backspace' && s === 0 && en === 0) {
      if (b.kind !== 'p') {
        // 블록 맨 앞 Backspace: 먼저 서식만 해제해 단락으로(할 일 포함, 텍스트 보존).
        e.preventDefault();
        const next = blocks.slice(); next[i] = { ...b, kind: 'p' };
        caretRef.current = { id: b.id, pos: 0 };
        applyStructural(next);
        return;
      }
      if (i > 0) {
        // 단락 맨 앞 Backspace: 앞 블록과 안전 병합(앞 블록 서식 유지).
        e.preventDefault();
        const prev = blocks[i - 1];
        const pos = prev.text.length;
        const next = blocks.slice();
        next[i - 1] = { ...prev, text: prev.text + b.text };
        next.splice(i, 1);
        caretRef.current = { id: prev.id, pos };
        applyStructural(next);
      }
      return;
    }
    if (e.key === 'ArrowUp' && i > 0 && s === 0 && en === 0) {
      e.preventDefault();
      const prevTa = refs.current.get(blocks[i - 1].id);
      if (prevTa) { prevTa.focus(); prevTa.setSelectionRange(prevTa.value.length, prevTa.value.length); }
      return;
    }
    if (e.key === 'ArrowDown' && i < blocks.length - 1 && s === b.text.length && en === s) {
      e.preventDefault();
      const nextTa = refs.current.get(blocks[i + 1].id);
      if (nextTa) { nextTa.focus(); nextTa.setSelectionRange(0, 0); }
    }
  };

  const handlePaste = (i: number) => (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text/plain'); // text/plain만 수용
    if (!/[\r\n]/.test(text)) return; // 한 줄 붙여넣기는 기본 삽입(onChange 경로)에 맡긴다
    e.preventDefault();
    const ta = e.currentTarget; const b = blocks[i];
    const s = ta.selectionStart ?? b.text.length, en = ta.selectionEnd ?? s;
    splitBlock(i, b.text.slice(0, s) + text.replace(/\r\n?/g, '\n') + b.text.slice(en), b.text.length - en);
  };

  // 체크박스 토글: 레이아웃은 그대로(높이 불변)라 개정 없이 checked만 바꿔 직렬화한다.
  const toggleChecked = (i: number) => {
    const b = blocks[i];
    const next = blocks.slice();
    next[i] = { ...b, checked: !b.checked };
    apply(next);
  };
  // 버튼: 마지막으로 포커스했던 블록 다음(없으면 문서 끝)에 빈 미완료 할 일을 넣고 그리로 포커스.
  const addTodo = () => {
    const created: EdBlock = { id: nextBlockId(), kind: 'todo', checked: false, text: '' };
    const idx = lastFocusedId.current ? blocks.findIndex((b) => b.id === lastFocusedId.current) : -1;
    const at = idx >= 0 ? idx + 1 : blocks.length;
    const next = blocks.slice();
    next.splice(at, 0, created);
    caretRef.current = { id: created.id, pos: 0 };
    applyStructural(next);
  };

  const isEmptyDoc = blocks.length === 1 && blocks[0].kind === 'p' && !blocks[0].text;
  let olNo = 0;
  return (
    <div className="field">
      {label ? <label id={labelId}>{label}{required ? <span className="req">*</span> : null}</label> : null}
      {allowTodo && showTodoButton ? (
        <button type="button" className="btn ghost sm" onClick={addTodo}>체크 항목 추가</button>
      ) : null}
      <div
        role="group"
        aria-labelledby={label ? labelId : undefined}
        aria-label={!label ? (ariaLabel || '내용 입력') : undefined}
        aria-required={required || undefined}
        style={{
          border: '1px solid var(--input)', borderRadius: 12, background: 'var(--card)', padding: '9px 12px',
          minHeight: rows * 22 + 20, cursor: 'text', transition: 'border-color .15s, box-shadow .15s',
          ...(focused ? { borderColor: 'var(--ring)', boxShadow: '0 0 0 2px color-mix(in srgb, var(--ring) 30%, transparent)' } : {}),
        }}
        onFocus={() => setFocused(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false); }}
        onMouseDown={(e) => {
          // 마지막 블록 아래 빈 영역 클릭 → 문서 끝에 캐럿(한 장의 편집 화면처럼).
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          const lastB = blocks[blocks.length - 1];
          const ta = refs.current.get(lastB.id);
          if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
        }}
      >
        {blocks.map((b, i) => {
          olNo = b.kind === 'ol' ? (i > 0 && blocks[i - 1].kind === 'ol' ? olNo + 1 : 1) : 0;
          const st = KIND_STYLE[b.kind];
          const heading = b.kind === 'h1' || b.kind === 'h2' || b.kind === 'h3';
          return (
            <div key={b.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginTop: i === 0 ? 0 : heading ? 8 : 2, paddingLeft: b.kind === 'ul' || b.kind === 'ol' ? 4 : 0 }}>
              {b.kind === 'ul' ? <span aria-hidden="true" style={{ flex: 'none', width: 16, textAlign: 'center', fontSize: st.fontSize, lineHeight: st.lineHeight }}>•</span> : null}
              {b.kind === 'ol' ? <span aria-hidden="true" style={{ flex: 'none', minWidth: 16, textAlign: 'right', fontSize: st.fontSize, lineHeight: st.lineHeight }}>{olNo + '.'}</span> : null}
              {b.kind === 'todo' ? (
                <input
                  type="checkbox"
                  className="md-todo-box"
                  checked={!!b.checked}
                  aria-label={(b.checked ? '완료함: ' : '할 일: ') + (b.text || `${i + 1}`)}
                  onChange={() => toggleChecked(i)}
                />
              ) : null}
              <textarea
                ref={(el) => { if (el) refs.current.set(b.id, el); else refs.current.delete(b.id); }}
                rows={1}
                value={b.text}
                aria-label={`${KIND_LABEL[b.kind]} ${i + 1}`}
                placeholder={isEmptyDoc ? placeholder : undefined}
                onChange={(e) => handleChange(i, e)}
                onKeyDown={handleKeyDown(i)}
                onPaste={handlePaste(i)}
                onFocus={() => { lastFocusedId.current = b.id; }}
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={() => { composing.current = false; }}
                style={{
                  fontSize: st.fontSize, lineHeight: st.lineHeight, fontWeight: st.fontWeight,
                  display: 'block', flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
                  color: 'var(--foreground)', resize: 'none', overflow: 'hidden', padding: 0, margin: 0, fontFamily: 'inherit',
                  ...(b.kind === 'todo' && b.checked ? { textDecoration: 'line-through', color: 'var(--muted-foreground)' } : null),
                }}
              />
            </div>
          );
        })}
      </div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}
