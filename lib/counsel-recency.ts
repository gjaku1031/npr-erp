export type CounselRecency = {
  days: number | null;
  tone: 'success' | 'warning' | 'destructive' | 'neutral';
  label: string;
};

/** 시간대가 아닌 한국 날짜의 달력 일수 차이. 조회 실패/기록 없음은 녹색으로 만들지 않는다. */
export function counselRecency(lastDate: string | null | undefined, today: string, state: 'ok' | 'error' = 'ok'): CounselRecency {
  const empty = { days: null, tone: 'neutral' as const };
  if (state === 'error') return { ...empty, label: '확인 필요' };
  if (!lastDate) return { ...empty, label: '상담 기록 없음' };
  const day = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const parsed = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : NaN;
  };
  const days = (day(today) - day(lastDate)) / 86_400_000;
  if (!Number.isInteger(days) || days < 0) return { ...empty, label: '확인 필요' };
  return {
    days,
    tone: days >= 21 ? 'destructive' : days >= 14 ? 'warning' : 'success',
    label: `D+${days}`,
  };
}
