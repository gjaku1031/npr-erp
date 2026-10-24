import React from 'react';
import { useApp } from '@/lib/state';
import { Card, Badge, Stat, Btn } from '@/components/ui';
import { PageTitle, Bubble, CalendarCard } from '@/components/screens/shared';
import { Markdown } from '@/components/Markdown';
import { tagMeta } from '@/lib/helpers';

export function LeadDash() {
  const { App } = useApp();
  const S = App.state;
  const reportTeachers = S.teachers.filter((t: any) => !t.isOtherTeam);
  const total = S.tasks.reduce((a, t) => a + t.total, 0);
  const done = S.tasks.reduce((a, t) => a + t.doneCount, 0);
  const rate = total ? Math.round((done / total) * 100) : 0;
  const subs = reportTeachers.filter((t: any) => t.todaySubmitted).length;
  const confs = reportTeachers.filter((t: any) => t.todayConfirmed).length;
  const unsub = reportTeachers.filter((t: any) => !t.todaySubmitted);
  const urgent = S.tasks.filter((t) => t.dday <= 2 && t.doneCount < t.total).length;

  const activeNotices = S.notices.filter((n) => n.active);

  const submitCard = (
    <Card title="오늘 일일보고 제출 현황" action={<Badge tone="brand">{`${subs} / ${reportTeachers.length}`}</Badge>}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {reportTeachers.map((t: any) => (
          <Bubble key={t.tid} name={t.name} submitted={t.todaySubmitted} confirmed={t.todayConfirmed} />
        ))}
      </div>
    </Card>
  );

  const noticeCard = (
    <Card
      title="공지사항"
      action={
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--primary)', cursor: 'pointer' }} onClick={() => App.go('notice')}>
          관리 →
        </span>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {activeNotices.slice(0, 2).map((n) => (
          <p key={n.id} style={{ fontSize: 13.5, lineHeight: 1.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span aria-hidden="true" style={{ color: 'var(--muted-foreground)' }}>{'· '}</span>
            <Markdown text={n.text} inline />
          </p>
        ))}
      </div>
      <div className="row">
        <Badge tone="success" icon="✓">{`노출 ${activeNotices.length}건`}</Badge>
        <span className="muted" style={{ fontSize: 12 }}>강사 모든 화면 상단</span>
      </div>
    </Card>
  );

  const taskCard = (
    <Card title="업무별 진행" action={<Badge tone="neutral">{`${S.tasks.length}건`}</Badge>}>
      {S.tasks.length === 0 ? (
        <p className="cap">진행 중인 업무가 없습니다.</p>
      ) : (
        <div className="col" style={{ gap: 13 }}>
          {S.tasks.map((t) => {
            const meta = tagMeta(t.tag, S.tags);
            const pct = t.total ? Math.round((t.doneCount / t.total) * 100) : 0;
            return (
              <div key={t.id} style={{ cursor: 'pointer' }} onClick={() => App.openModal({ type: 'task', id: t.id })}>
                <div className="row" style={{ marginBottom: 5 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{(meta.emoji ? meta.emoji + ' ' : '') + t.title}</span>
                  <Badge tone={meta.tone}>{t.tag}</Badge>
                  <span className="grow" />
                  <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{`${t.doneCount}/${t.total}명 · ${pct}%`}</span>
                </div>
                <div className="bar"><i style={{ width: pct + '%' }} /></div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );

  return (
    <div>
      <PageTitle title="대시보드" cap={S.todayLabel} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
        <Stat label="진행 업무" value={String(S.tasks.length)} hint="등록된 업무 수" />
        <Stat label="오늘 보고 제출" value={`${subs} / ${reportTeachers.length}`} tone="success" hint={`미제출 ${unsub.length}명 · 확인 대기 ${subs - confs}명`} />
        <Stat label="마감 임박" value={String(urgent)} tone="destructive" hint="마감 D-2 이내 업무" />
      </div>
      <div style={{ marginBottom: 20 }}><CalendarCard /></div>
      <div className="lead-dash-stack">
        {submitCard}
        <div className="lead-dash-split">
          {taskCard}
          {noticeCard}
        </div>
      </div>
    </div>
  );
}
