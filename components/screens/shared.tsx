import React from 'react';
import { useApp } from '@/lib/state';
import { Calendar } from '@/components/Calendar';

export function PageTitle({ title, cap, action }: { title: React.ReactNode; cap?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="page-hd">
      <div className="page-hd-txt">
        <h1 className="page-title">{title}</h1>
        {cap ? <span className="cap">{cap}</span> : null}
      </div>
      {action ? <div className="page-hd-act">{action}</div> : null}
    </div>
  );
}

// 강사별 제출 버블 칩
export function Bubble({ name, submitted, confirmed, date }: { name: string; submitted: boolean; confirmed: boolean; date?: string }) {
  const { App } = useApp();
  const cls = confirmed ? 'conf' : submitted ? 'wait' : 'none';
  const mk = confirmed ? '✓' : submitted ? '…' : '—';
  return (
    <div className={'bubble ' + cls}
      title={confirmed ? '확인 완료 · 보고 보기' : submitted ? '확인 대기 · 보고 보기' : '미제출'}
      onClick={(submitted || confirmed) ? () => App.openLogView(name, date) : undefined}>
      <span className="mk">{mk}</span>
      <span style={{ fontWeight: 600 }}>{name}</span>
    </div>
  );
}

export function CalendarCard() {
  const { App } = useApp();
  const S = App.state, u = App.ui;
  if (u.calMonth == null) u.calMonth = Number(S.today.slice(5, 7));
  if (u.calFilter == null) u.calFilter = 'all';
  const items = S.tasks.concat(S.events);
  return (
    <Calendar
      items={items} month={u.calMonth} today={S.today} isLead={u.role === 'lead'} tags={S.tags}
      filter={u.calFilter} onFilter={(f) => { u.calFilter = f; App.render(); }}
      onDayClick={(date) => App.openDayAdd(date)}
      onOpenTask={(t) => App.openModal({ type: 'task', id: t.id })}
      onOpenEvent={(e) => App.openModal({ type: 'eventView', id: e.id })}
      onPrev={() => { u.calMonth = Math.max(1, u.calMonth - 1); App.render(); }}
      onNext={() => { u.calMonth = Math.min(12, u.calMonth + 1); App.render(); }}
      onAddTeam={() => App.openEventCreate('team')}
      onAddPersonal={() => App.openEventCreate('personal')}
    />
  );
}
