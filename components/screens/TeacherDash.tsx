import React from 'react';
import { useApp } from '@/lib/state';
import { Stat } from '@/components/ui';
import { PageTitle, CalendarCard } from '@/components/screens/shared';

export function TeacherDash() {
  const { App } = useApp();
  const S = App.state;
  const myOpen = S.tasks.filter((t) => (t.statuses[S.me.name] || {}).status !== 'done').length;
  const myUrgent = S.tasks.filter((t) => t.dday <= 2 && (t.statuses[S.me.name] || {}).status !== 'done').length;
  const rep = S.myReport;
  const logVal = !rep || rep.status !== 'submitted' ? '미제출' : rep.confirmed ? '확인 완료' : '확인 대기';
  const logTone = !rep || rep.status !== 'submitted' ? 'destructive' : rep.confirmed ? 'success' : '';
  return (
    <div>
      <PageTitle title="대시보드" cap={`${S.todayLabel} · 내게 배정된 업무와 개인일정`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
        <Stat label="미완료 업무" value={String(myOpen)} hint="내게 배정된 업무 기준" />
        <Stat label="오늘 일일보고" value={logVal} tone={logTone} hint={rep && rep.status === 'submitted' ? '제출됨' : '작성 필요'} />
        <Stat label="마감 임박" value={String(myUrgent)} tone="destructive" hint="마감 D-2 이내 · 내 업무" />
      </div>
      <CalendarCard />
    </div>
  );
}
