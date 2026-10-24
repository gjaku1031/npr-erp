import React, { useRef, useState, useLayoutEffect } from 'react';
import { Card } from '@/components/ui';
import { tagMeta } from '@/lib/helpers';

const FILTERS: [string, string][] = [['all', '전체'], ['task', '업무'], ['team', '팀일정'], ['personal', '개인일정']];
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s: string) => new Date(s + 'T00:00:00');
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const diffDays = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86400000);

/**
 * 연속 주(週) 무한 스크롤 캘린더 — 월 경계 없이 이어짐.
 * 기본: 현재 주 기준 위 2주·아래 2주가 보이고, 스크롤하면 위/아래로 계속 확장.
 * 이벤트 위치는 ISO 날짜(start~due/end)로 계산(연·월 넘겨도 정확).
 */
export function Calendar(o: {
  items: any[]; today: string; isLead: boolean; tags: any[];
  filter?: string; onFilter?: (f: string) => void; onDayClick?: (dateISO: string) => void;
  onOpenTask: (t: any) => void; onOpenEvent: (e: any) => void;
  onAddTeam: () => void; onAddPersonal: () => void;
}) {
  const { items, today, isLead, tags, filter = 'all' } = o;
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null); // (현재주-2) 주 — 초기 스크롤 기준
  const todayRef = useRef<HTMLDivElement>(null); // 실제 오늘(현재주, wi=0) — '오늘' 버튼 점프 기준
  const pend = useRef<{ prevH: number } | null>(null);
  const didInit = useRef(false);
  const [range, setRange] = useState({ back: 4, fwd: 6 });
  const [jump, setJump] = useState(0); // '오늘' 클릭마다 증가 → 렌더/effect 강제(기본 range와 같아도)

  const isEventItem = (t: any) => t.type === 'personal' || t.type === 'team_event';
  const shown = items.filter((t: any) => {
    if (filter === 'task') return !isEventItem(t);
    if (filter === 'team') return t.type === 'team_event';
    if (filter === 'personal') return t.type === 'personal';
    return true;
  });

  const todayD = parseISO(today);
  const anchorSun = addDays(todayD, -todayD.getDay()); // 이번 주 일요일

  // 초기 1회: 컨테이너만 스크롤(페이지 X)해서 (현재주-2)를 상단에 → 위로 2주가 보임
  useLayoutEffect(() => {
    if (!didInit.current && anchorRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = anchorRef.current.offsetTop; // cal-scroll이 offsetParent(position:relative)
      didInit.current = true;
    }
  });
  // '오늘' 버튼: 실제 오늘 주(wi=0)로 컨테이너 scrollTop만 이동(페이지 X, scrollIntoView 미사용).
  // 아래 위쪽-확장 보정 effect보다 먼저 선언·실행하고 pend를 비워, 점프를 다시 밀지 않도록 우선 처리.
  useLayoutEffect(() => {
    if (jump > 0 && todayRef.current && scrollRef.current) {
      pend.current = null;
      scrollRef.current.scrollTop = todayRef.current.offsetTop;
    }
  }, [jump]);
  // 위쪽 확장 시 스크롤 점프 보정
  useLayoutEffect(() => {
    if (pend.current && scrollRef.current) { scrollRef.current.scrollTop += scrollRef.current.scrollHeight - pend.current.prevH; pend.current = null; }
  });

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 260) setRange((r) => ({ ...r, fwd: r.fwd + 4 }));
    if (el.scrollTop < 260) { pend.current = { prevH: el.scrollHeight }; setRange((r) => ({ ...r, back: r.back + 4 })); }
  };

  const action = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {o.onFilter ? (
        <span className="cal-filter">
          {FILTERS.map(([k, lb]) => (
            <button key={k} className={'cal-fchip' + (filter === k ? ' on' : '')} onClick={() => o.onFilter!(k)}>{lb}</button>
          ))}
        </span>
      ) : null}
      {isLead ? <button className="cal-navbtn wide navy" onClick={o.onAddTeam}>+ 팀 일정</button> : null}
      <button className="cal-navbtn wide" onClick={o.onAddPersonal}>+ 개인일정</button>
      <button className="cal-navbtn wide" onClick={() => { pend.current = null; setRange({ back: 4, fwd: 6 }); setJump((j) => j + 1); }} title="오늘로">오늘</button>
    </span>
  );

  const weekEls: React.ReactNode[] = [];
  for (let wi = -range.back; wi <= range.fwd; wi++) {
    const sun = addDays(anchorSun, wi * 7);
    const sunISO = isoOf(sun), satISO = isoOf(addDays(sun, 6));

    // 이 주에 '1일'이 있으면 월 라벨
    let monthLabel = '';
    for (let i = 0; i < 7; i++) { const dt = addDays(sun, i); if (dt.getDate() === 1) monthLabel = `${dt.getFullYear()}년 ${dt.getMonth() + 1}월`; }

    const dayEls: React.ReactNode[] = [];
    for (let i = 0; i < 7; i++) {
      const dt = addDays(sun, i), iso = isoOf(dt);
      const isToday = iso === today, first = dt.getDate() === 1;
      dayEls.push(
        <div className={'cal-day' + (o.onDayClick ? ' clickable' : '')} key={i}
          onClick={o.onDayClick ? () => o.onDayClick!(iso) : undefined}
          title={o.onDayClick ? '이 날짜에 추가' : undefined}>
          <span className={'cal-daynum' + (isToday ? ' today' : '')}>{first ? `${dt.getMonth() + 1}/1` : String(dt.getDate())}</span>
        </div>,
      );
    }

    const lanes: [number, number][][] = [];
    const barEls: React.ReactNode[] = [];
    shown.forEach((t: any, idx: number) => {
      const s = t.start, en = t.due || t.end;
      if (!s || !en || s > satISO || en < sunISO) return;
      const cutL = s < sunISO, cutR = en > satISO;
      const s0 = cutL ? 0 : Math.max(0, Math.min(6, diffDays(parseISO(s), sun)));
      const e0 = cutR ? 6 : Math.max(0, Math.min(6, diffDays(parseISO(en), sun)));
      if (s0 > e0) return;
      let lane = 0;
      while ((lanes[lane] || []).some((seg) => !(e0 < seg[0] || s0 > seg[1]))) lane++;
      (lanes[lane] = lanes[lane] || []).push([s0, e0]);

      const meta = tagMeta(t.tag, tags);
      const span = e0 - s0 + 1;
      const isEvent = isEventItem(t);
      const names = isEvent ? [t.owner === 'team' ? '전체' : '나'] : (t.scope === 'all' ? ['전체 강사'] : t.scope);
      const cap = Math.max(1, span * 2 - 1);
      const nameChipStyle: React.CSSProperties = { background: 'color-mix(in srgb, var(--card) 62%, transparent)', border: `1px solid color-mix(in srgb, ${meta.edge} 28%, transparent)` };
      const tagChipStyle: React.CSSProperties = { background: meta.edge, color: 'var(--card)', fontWeight: 700 };
      const chips: React.ReactNode[] = [<span className="cal-mini" style={tagChipStyle} key="tag">{t.tag || '행정'}</span>];
      (names as string[]).slice(0, cap).forEach((n, ni) => chips.push(<span className="cal-mini" style={nameChipStyle} key={'n' + ni}>{n}</span>));
      if (names.length > cap) chips.push(<span className="cal-mini" style={nameChipStyle} key="more">{'+' + (names.length - cap)}</span>);
      const icon = isEvent ? '📅' : (meta.emoji || '');

      barEls.push(
        <div key={'bar' + idx}
          className={'cal-bar' + (isEvent ? ' cal-bar-event' : '')}
          style={{
            gridColumn: `${s0 + 1} / span ${span}`, gridRow: String(lane + 1),
            background: isEvent ? 'color-mix(in srgb, ' + meta.edge + ' 8%, var(--card))' : meta.bg, color: meta.fg,
            border: meta.dashed ? '1px dashed color-mix(in srgb, var(--muted-foreground) 55%, transparent)' : 'none',
            borderLeft: cutL ? 'none' : `${isEvent ? 2 : 3}px ${isEvent ? 'dashed' : 'solid'} ${meta.edge}`,
            borderTopLeftRadius: cutL ? 0 : 5, borderBottomLeftRadius: cutL ? 0 : 5,
            borderTopRightRadius: cutR ? 0 : 5, borderBottomRightRadius: cutR ? 0 : 5,
          }}
          title={`[${isEvent ? '일정' : '업무'} · ${t.tag || '행정'}] ${t.title} — ${t.startLabel || ''} ~ ${t.dueLabel || ''}`}
          onClick={(e) => { e.stopPropagation(); isEvent ? o.onOpenEvent(t) : o.onOpenTask(t); }}
        >
          <div className="b1"><span style={{ fontSize: 13.5, lineHeight: 1, flex: 'none' }}>{icon}</span><span className="lb">{t.title}</span></div>
          <div className="b2">{chips}</div>
        </div>,
      );
    });

    weekEls.push(
      <div className="cal-week" key={wi} ref={wi === -2 ? anchorRef : wi === 0 ? todayRef : undefined}>
        {monthLabel ? <div className="cal-mlabel">{monthLabel}</div> : null}
        <div className="cal-days">{dayEls}</div>
        <div className="cal-bars">{barEls}</div>
      </div>,
    );
  }

  return (
    <Card flush title="업무·일정 캘린더" action={action}>
      <div className="cal-weekhd">{WD.map((d) => <span key={d}>{d}</span>)}</div>
      <div className="cal-scroll" ref={scrollRef} onScroll={onScroll}>{weekEls}</div>
    </Card>
  );
}
