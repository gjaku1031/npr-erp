// 날짜 · 태그 색상 헬퍼 (core.js 이식)
const KO_DOW = ['일', '월', '화', '수', '목', '금', '토'];
export const dow = (iso: string) => new Date(iso + 'T00:00:00').getDay();
export const koDate = (iso: string) => { const [, m, d] = iso.split('-').map(Number); return `${m}월 ${d}일 (${KO_DOW[dow(iso)]})`; };
export const koDateFull = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return `${y}년 ${m}월 ${d}일 (${KO_DOW[dow(iso)]})`; };
export const groupOf = (iso: string): '월수금반' | '화목토반' | null => {
  const g = dow(iso);
  return g === 1 || g === 3 || g === 5 ? '월수금반' : g === 2 || g === 4 || g === 6 ? '화목토반' : null;
};
export const specialGroupOf = (iso: string): '특강 월수금반' | '특강 화목토반' | null => {
  const group = groupOf(iso);
  return group ? `특강 ${group}` as '특강 월수금반' | '특강 화목토반' : null;
};

// 일일보고에서 실제로 처리할 반 목록. 기존 데이터는 specialPeriod가 없어도 일반 반만 정상 반환한다.
export function isSpecialJournal(state: any, iso: string): boolean {
  const journal = (state?.journals || []).find((item: any) => item.date === iso);
  const value = journal?.specialPeriod ?? journal?.special_period;
  return value === true || value === 1 || value === '1';
}

export function classesForDate(state: any, iso: string, teacher?: any, specialPeriod?: boolean): string[] {
  const regularGroup = groupOf(iso);
  if (!regularGroup) return [];

  const owner = teacher || state?.me || {};
  const classes = owner.classes || {};
  const groups: string[] = [regularGroup];
  if (specialPeriod ?? isSpecialJournal(state, iso)) {
    const specialGroup = specialGroupOf(iso);
    if (specialGroup) groups.push(specialGroup);
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const value of (Array.isArray(classes[group]) ? classes[group] : [])) {
      const className = String(value || '').trim();
      if (!className || seen.has(className)) continue;
      seen.add(className);
      result.push(className);
    }
  }
  return result;
}
export const ddayFrom = (a: string, b: string) => Math.round((+new Date(b + 'T00:00:00') - +new Date(a + 'T00:00:00')) / 86400000);
export const ddayLabel = (d: number) => (d < 0 ? '완료' : d === 0 ? 'D-DAY' : 'D-' + d);
export const ddayTone = (d: number, arch?: boolean) => (arch ? 'neutral' : d <= 2 ? 'destructive' : 'neutral');
export const nextDay = (iso: string) => {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// ── 태그 색상 ──
export const COLORS: Record<string, any> = {
  '올리브': { tone: 'brand', edge: 'var(--primary)', bg: 'var(--accent)', fg: 'var(--accent-foreground)' },
  '블루': { tone: 'info', edge: 'var(--info)', bg: 'var(--info-bg)', fg: 'var(--info-bg-foreground)' },
  '옐로': { tone: 'warning', edge: 'var(--warning)', bg: 'color-mix(in srgb, var(--warning) 20%, transparent)', fg: 'var(--warning-foreground)' },
  '네이비': { tone: 'neutral', edge: 'var(--navy)', bg: 'color-mix(in srgb, var(--navy) 10%, transparent)', fg: 'color-mix(in srgb, var(--navy) 55%, var(--foreground))' },
  '그린': { tone: 'success', edge: 'var(--success)', bg: 'color-mix(in srgb, var(--success) 15%, transparent)', fg: 'color-mix(in srgb, var(--success) 45%, var(--foreground))' },
  '레드': { tone: 'destructive', edge: 'var(--destructive)', bg: 'color-mix(in srgb, var(--destructive) 10%, transparent)', fg: 'color-mix(in srgb, var(--destructive) 70%, var(--foreground))' },
};
export const PRESETS = ['올리브', '블루', '옐로'];

export function tagMeta(tag: string, tags: any[] = []): any {
  if (tag === '개인일정') return { tone: 'neutral', edge: 'var(--muted-foreground)', bg: 'var(--card)', fg: 'var(--foreground)', dashed: true, emoji: '' };
  if (tag === '일정') return { tone: 'neutral', edge: 'var(--navy)', bg: 'var(--secondary)', fg: 'var(--secondary-foreground)', emoji: '' };
  const def = (tags || []).find((x) => x.name === tag);
  const col = def ? def.color : '네이비';
  if (String(col).indexOf('#') === 0) {
    return { tone: 'neutral', edge: col, bg: `color-mix(in srgb, ${col} 14%, transparent)`, fg: `color-mix(in srgb, ${col} 60%, var(--foreground))`, emoji: def ? def.emoji : '🗂️' };
  }
  return Object.assign({}, COLORS[col] || COLORS['네이비'], { emoji: def ? def.emoji : '🗂️' });
}

// 전역 토스트 — #toast 요소를 직접 제어 (vanilla NPR.toast 이식)
let toastT: any;
export function toast(msg: string) {
  if (typeof document === 'undefined') return;
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

// 파일 선택 → base64 (vanilla NPR.pickFiles 이식)
export function pickFiles(accept: string, multiple: boolean, cb: (out: { filename: string; b64: string }[]) => void) {
  const inp = document.createElement('input');
  inp.type = 'file'; if (accept) inp.accept = accept; inp.multiple = !!multiple;
  inp.onchange = () => {
    const files = Array.prototype.slice.call(inp.files) as File[];
    let n = files.length; const out: { filename: string; b64: string }[] = [];
    if (!n) return;
    files.forEach((f) => {
      const r = new FileReader();
      r.onload = () => { out.push({ filename: f.name, b64: String(r.result).split(',')[1] }); if (--n === 0) cb(out); };
      r.readAsDataURL(f);
    });
  };
  inp.click();
}
