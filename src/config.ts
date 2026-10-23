/**
 * 앱 전역 설정 + 날짜 헬퍼.
 *
 * '오늘'은 기본적으로 **한국 시간(KST, Asia/Seoul) 기준 실제 날짜**를 쓴다.
 * 서버가 미국(Vercel iad1)이라도 KST로 계산하므로 한국 사용자에게 항상 정확.
 * APP_TODAY 환경변수를 지정하면 그 날짜로 고정(로컬 테스트/데모용).
 */

const KO_DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** 한국 시간(KST) 기준 오늘을 'YYYY-MM-DD'로. 서버 타임존과 무관. */
export function todayKST(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

/** 요일 그룹: 월수금 / 화목토. 그 외(일)는 null */
export function groupOf(dateISO: string): '월수금반' | '화목토반' | null {
  const dow = new Date(dateISO + 'T00:00:00').getDay();
  if (dow === 1 || dow === 3 || dow === 5) return '월수금반';
  if (dow === 2 || dow === 4 || dow === 6) return '화목토반';
  return null;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  /** 앱 기준 '오늘'. 기본은 한국(KST) 실제 날짜, APP_TODAY 지정 시 그 날짜로 고정. */
  get today(): string {
    const v = (process.env.APP_TODAY ?? '').trim();
    return v || todayKST();
  },
};

/** 'YYYY-MM-DD' → { y, m, d, dow } */
export function parseISO(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(iso + 'T00:00:00').getDay();
  return { y, m, d, dow };
}

/** 'YYYY-MM-DD' → '7월 11일 (토)' */
export function koDate(iso: string): string {
  const { m, d, dow } = parseISO(iso);
  return `${m}월 ${d}일 (${KO_DOW[dow]})`;
}

/** 'YYYY-MM-DD' → '2026년 7월 11일 (토)' */
export function koDateFull(iso: string): string {
  const { y, m, d, dow } = parseISO(iso);
  return `${y}년 ${m}월 ${d}일 (${KO_DOW[dow]})`;
}

/** due 기준 D-day (양수=남음, 0=당일, 음수=지남) — today 기준 */
export function ddayFrom(todayISO: string, dueISO: string): number {
  const a = new Date(todayISO + 'T00:00:00').getTime();
  const b = new Date(dueISO + 'T00:00:00').getTime();
  return Math.round((b - a) / 86400000);
}

export function ddayLabel(dday: number): string {
  return dday < 0 ? '완료' : dday === 0 ? 'D-DAY' : `D-${dday}`;
}

/** 다음 날 ISO */
export function nextDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
