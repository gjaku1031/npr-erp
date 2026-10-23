import React from 'react';
import { useApp } from '@/lib/state';
import { Btn, Card, Badge, Alert } from '@/components/ui';
import { PageTitle } from '@/components/screens/shared';

export function TeacherLog() {
  const { App } = useApp();
  const S = App.state;
  const rep = S.myReport;
  const submitted = rep && rep.status === 'submitted';
  const confirmed = rep && rep.confirmed;
  const journalToday = S.journals.find((j: any) => j.date === S.today);
  const badge = !submitted
    ? { tone: 'destructive', label: '미제출' }
    : confirmed
      ? { tone: 'success', label: '확인 완료' }
      : { tone: 'warning', label: '팀장 확인 대기' };

  return (
    <div style={{ maxWidth: 760 }}>
      <PageTitle title="일일보고" cap="하루 1개 · 이전 보고 조회/수정 가능" />
      <Card emphasis>
        <div className="col" style={{ gap: 12 }}>
          <div className="row">
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>오늘의 일일보고</h2>
            <span className="cap">{S.todayLabel}</span>
            <span className="grow" />
            <Badge tone={badge.tone} icon={confirmed ? '✓' : ''}>{badge.label}</Badge>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!submitted ? (
              <Btn variant="primary" onClick={() => App.enterWizard()}>
                {journalToday ? (rep && rep.status === 'draft' ? '이어서 작성' : '작성 시작') : '작성 시작'}
              </Btn>
            ) : null}
            {submitted ? (
              <Btn variant="secondary" onClick={() => App.openLogView(S.me.name)}>제출 내용 보기</Btn>
            ) : null}
            {submitted ? (
              <Btn variant="ghost" disabled={confirmed} onClick={() => App.reopenLog()}>수정하기</Btn>
            ) : null}
          </div>
          {!journalToday ? (
            <Alert tone="info">오늘 일일보고가 아직 생성되지 않았습니다 — 팀장이 생성하면 작성할 수 있습니다.</Alert>
          ) : null}
        </div>
      </Card>
      <div style={{ height: 16 }} />
      <Card flush title="지난 일일보고">
        {(S.myPastLogs || []).map((p: any) => {
          // 상태별 표현: 미제출(none)·임시저장(draft)은 위저드로 이어서 작성, 제출본은 읽기 전용 조회.
          const badge = p.status === 'submitted'
            ? { tone: 'success', icon: '✓', label: p.confirmed ? '확인 완료' : '제출' }
            : p.status === 'draft'
              ? { tone: 'warning', icon: '', label: '임시저장' }
              : { tone: 'destructive', icon: '', label: '미제출' };
          const helper = p.status === 'submitted'
            ? `체크리스트 항목 · 알림장 ${p.nb}건`
            : p.status === 'draft'
              ? '임시저장된 내용을 이어서 작성할 수 있습니다'
              : '작성된 내용이 없습니다';
          const cta = p.status === 'submitted' ? '조회 →' : p.status === 'draft' ? '이어서 작성 →' : '작성하기 →';
          const onOpen = p.status === 'submitted'
            ? () => App.openLogView(S.me.name, p.date)
            : () => App.enterWizard(p.date);
          return (
            <div
              key={p.date}
              style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '13px 20px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
              onClick={onOpen}
            >
              <span style={{ fontSize: 14, fontWeight: 600, minWidth: 110 }}>{p.label}</span>
              <Badge tone={badge.tone} icon={badge.icon}>{badge.label}</Badge>
              <span className="muted" style={{ fontSize: 12 }}>{helper}</span>
              <span className="grow" />
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--primary)' }}>{cta}</span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
