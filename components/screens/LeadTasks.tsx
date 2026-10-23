import React from 'react';
import { useApp } from '@/lib/state';
import { Btn, Card, Badge, Select } from '@/components/ui';
import { PageTitle } from '@/components/screens/shared';
import { tagMeta, ddayLabel, ddayTone } from '@/lib/helpers';

export function LeadTasks() {
  const { App } = useApp();
  const S = App.state, u = App.ui;
  const statusOf = (t: any) => (t.archived || t.doneCount >= t.total) ? 'done' : 'open';
  const counts = {
    all: S.tasks.length,
    open: S.tasks.filter((t: any) => statusOf(t) === 'open').length,
    done: S.tasks.filter((t: any) => statusOf(t) === 'done').length,
  };
  const vis = S.tasks.filter((t: any) => (u.taskFilter === 'all' || statusOf(t) === u.taskFilter) && (u.tagFilter === '전체' || t.tag === u.tagFilter));
  const chips: [string, string][] = [['all', '전체 ' + counts.all], ['open', '진행 중 ' + counts.open], ['done', '완료 ' + counts.done]];

  return (
    <div style={{ maxWidth: 800 }}>
      <PageTitle title="업무" cap={'클릭해 강사별 처리 상태 확인 · 생성은 상단 "+ 업무 생성"'} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {chips.map((p) => (
          <span key={p[0]} className={'chip' + (u.taskFilter === p[0] ? ' on' : '')} onClick={() => { u.taskFilter = p[0]; App.render(); }}>{p[1]}</span>
        ))}
        <span className="grow" />
        <span className="muted" style={{ fontSize: 12.5 }}>태그</span>
        <div style={{ width: 120 }}>
          <Select options={['전체', ...S.tags.map((t: any) => t.name)]} value={u.tagFilter} onChange={(v) => { u.tagFilter = v; App.render(); }} />
        </div>
        <Btn variant="subtle" size="sm" onClick={() => App.openTagManager()}>태그 관리</Btn>
      </div>
      <Card flush title="업무 목록" action={<Badge tone="neutral">{`${vis.length}건`}</Badge>}>
        {vis.map((t: any) => {
          const meta = tagMeta(t.tag, S.tags);
          const pct = t.total ? Math.round(t.doneCount / t.total * 100) : 0;
          const reqs = [t.reportReq ? '보고 필수' : null, t.attachReq ? '첨부 필수' : null].filter(Boolean).join(' · ');
          const open = () => App.openModal({ type: 'task', id: t.id });
          return (
            <div
              key={t.id}
              className="lrow"
              role="button"
              tabIndex={0}
              aria-label={`${t.title} 상세 보기`}
              onClick={open}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
              style={t.archived ? { opacity: 0.65 } : undefined}
            >
              <div className="row">
                <span style={{ fontSize: 14, fontWeight: 600, color: t.archived ? 'var(--muted-foreground)' : 'var(--foreground)' }}>{t.title}</span>
                <Badge tone={meta.tone} icon={meta.emoji}>{t.tag}</Badge>
                <Badge tone={t.scope === 'all' ? 'brand' : 'info'}>{t.scope === 'all' ? '전체' : '담당 ' + t.assignees.length + '명'}</Badge>
                <span className="grow" />
                <Badge tone={ddayTone(t.dday, t.archived)}>{ddayLabel(t.dday)}</Badge>
              </div>
              <div className="row" style={{ gap: 10 }}>
                <div className="bar"><i className={t.archived ? 'gray' : ''} style={{ width: pct + '%' }} /></div>
                <span style={{ fontSize: 12, color: 'var(--muted-foreground)', fontWeight: 500 }}>{`${t.doneCount}/${t.total}명`}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{`${t.startLabel} ~ ${t.dueLabel}${reqs ? ' · ' + reqs : ''}`}</div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
