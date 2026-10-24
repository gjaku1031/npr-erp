import React from 'react';
import { useApp } from '@/lib/state';
import { Btn, Card, Badge, FileChips, counselComplete, counselCountLabel, counselAbsenceStats } from '@/components/ui';
import { Markdown, MarkdownEditor } from '@/components/Markdown';
import { PageTitle } from '@/components/screens/shared';
import { tagMeta, ddayLabel, ddayTone, pickFiles } from '@/lib/helpers';

export function TeacherTasks(props: { otherTeam?: boolean } = {}) {
  const { App } = useApp();
  const S = App.state, u = App.ui;
  const otherTeam = !!props.otherTeam;
  const mine = S.tasks;
  if (mine.length && !mine.some((task: any) => task.id === u.selTask)) u.selTask = mine[0].id;
  if (!mine.length) u.selTask = null;
  // 완료 판정: 상담=전원 전송, 특강상담=대상 없음 또는 전원 전송, 그 외=본인 status='done'
  const isDone = (t: any) => {
    if (t.counsel || t.specialCounsel) return counselComplete(t.counselProg?.[S.me.name], !!t.specialCounsel);
    return (t.statuses[S.me.name] || {}).status === 'done';
  };
  const open = mine.filter((t: any) => !isDone(t)).length;
  const vis = mine.filter((t: any) => {
    if (u.myFilter === 'done') return isDone(t);
    if (u.myFilter === 'open') return !isDone(t);
    return true;
  });
  const chips: [string, string][] = [['all', '전체'], ['open', '진행 중'], ['done', '완료']];

  const t = mine.find((x: any) => x.id === u.selTask);
  let detailBody: React.ReactNode = null;
  if (t) {
    const me = S.me.name;
    const counselLike = !!(t.counsel || t.specialCounsel);
    const st = (t.statuses[me] || {});
    const report = { text: st.reportText || '', files: st.reportFiles || [] };
    const unmet = t.reportReq && !report.text.trim() ? '텍스트 보고' : (t.attachReq && report.files.length === 0 ? '첨부파일' : null);
    const stLine = st.status === 'done' ? '완료로 표시됨' : st.status === 'undone' ? '미완료로 표시됨' : (unmet ? unmet + ' 필수 — 작성 후 완료 가능' : '아직 표시하지 않음');
    const cp = counselLike ? t.counselProg?.[me] : null;
    const cAbs = counselAbsenceStats(cp);
    const cNoTarget = counselLike && !!t.specialCounsel && !!cp?.noTarget;
    detailBody = (
      <div className="col" style={{ gap: 14 }}>
        <div className="row detail-hd">
          <h2 style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>{t.title}</h2>
          {t.specialCounsel ? <Badge tone="brand" icon="✦">특강상담</Badge> : t.counsel ? <Badge tone="brand">전체 상담</Badge> : null}
          <Badge tone={ddayTone(t.dday)}>{ddayLabel(t.dday)}</Badge>
          {otherTeam ? <Btn variant="ghost" size="sm" onClick={() => App.deleteOtherCounsel(t.id, t.title)}>삭제</Btn> : null}
        </div>
        <Markdown text={t.descr} style={{ fontSize: 14, lineHeight: 1.7 }} />
        <div className="muted-box" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <span className="muted">시작일</span><span style={{ fontWeight: 500 }}>{t.startLabel}</span>
          <span className="muted">마감 기한</span><span style={{ fontWeight: 500 }}>{t.dueLabel}</span>
          <span className="muted">담당</span><span style={{ fontWeight: 500 }}>{t.scope === 'all' ? '전체 강사' : t.assignees.join(', ')}</span>
          <span className="muted">완료 조건</span><span style={{ fontWeight: 500 }}>{counselLike ? '학생별 상담 전송 — 자동 집계' : ([t.reportReq ? '텍스트 보고' : null, t.attachReq ? '첨부파일' : null].filter(Boolean).join(' · ') || '없음')}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(t.links || []).map((l: any, i: number) => <a key={'l' + i} className="link-chip" href={l.url} target="_blank">{'🔗 ' + l.label}</a>)}
        </div>
        {counselLike ? (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row"><span className="section-label">상담 진행</span></div>
            {cNoTarget ? (
              <div className="dashed-box">특강상담 대상 없음 — ‘대상 없음’(완료)으로 자동 집계됩니다.</div>
            ) : (
              <button type="button" className="btn secondary md" title="학생별 상담 전송·부재/문자 현황 열기"
                style={{ width: '100%', justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap' }}
                onClick={() => App.openModal({ type: 'counselStatus', taskId: t.id })}>
                <span style={{ fontWeight: 600 }}>학생 상담 상세</span>
                <span className="grow" />
                <Badge tone={counselComplete(cp, !!t.specialCounsel) ? 'success' : 'neutral'}>{counselCountLabel(cp, !!t.specialCounsel, '상담 전송')}</Badge>
                <Badge tone="neutral">{`부재 ${cAbs.absenceCount}회`}</Badge>
                {cAbs.absencePendingCount ? <Badge tone="warning">{`확인 대기 ${cAbs.absencePendingCount}`}</Badge> : null}
                <span aria-hidden="true" style={{ fontSize: 12 }}>›</span>
              </button>
            )}
            <span className="muted" style={{ fontSize: 12 }}>학생별 상담을 통통통에 전송하면 완료로 자동 집계됩니다 · 이 상담 업무는 일일보고 제출을 막지 않습니다.</span>
          </div>
        ) : null}
        {!otherTeam ? <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="row">
            <span className="section-label">보고 작성</span>
            {counselLike ? <Badge tone="neutral">선택</Badge> : null}
            {t.reportReq ? <Badge tone="warning">텍스트 필수</Badge> : null}
            {t.attachReq ? <Badge tone="warning">첨부 필수</Badge> : null}
          </div>
          <MarkdownEditor key={t.id} rows={3} ariaLabel={counselLike ? '업무 보고 (선택)' : '업무 보고'}
            placeholder={counselLike ? '선택 사항 — 상담 진행에 대해 팀장과 공유할 내용이 있으면 남겨 주세요' : '처리 내용을 보고해 주세요 — 예: 재고 32권 확인, 시트 입력 완료'}
            defaultValue={report.text} onInput={(v) => App.saveTaskReport(t.id, v, report.files)}
            hint="입력하면 바로 서식 적용 — ‘# ’ 제목 · ‘- ’ 목록 · ‘1. ’ 번호 · **굵게**" />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Btn variant="subtle" size="sm" onClick={() => pickFiles('', true, (arr) => App.addTaskFiles(t.id, arr))}>📎 파일 첨부</Btn>
            <FileChips files={report.files} onRemove={(i) => App.removeTaskFile(t.id, i)} />
          </div>
          {counselLike ? <span className="muted" style={{ fontSize: 12 }}>보고는 선택 사항입니다 — 완료는 학생별 상담 전송으로만 집계되며, 보고를 쓰지 않아도 완료·일일보고 제출에 영향이 없습니다.</span> : null}
        </div> : null}
        {!counselLike ? (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row"><span className="section-label">처리 상태 표시</span>{t.mt ? <Badge tone="brand">MT 업무</Badge> : null}</div>
            {t.mt ? (
              <>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn variant={st.mDone ? 'primary' : 'secondary'} full onClick={() => App.markTaskMt(t.id, 'm', !st.mDone)}>{(st.mDone ? '✓ ' : '') + 'M(월수금) 완료'}</Btn>
                  <Btn variant={st.tDone ? 'primary' : 'secondary'} full onClick={() => App.markTaskMt(t.id, 't', !st.tDone)}>{(st.tDone ? '✓ ' : '') + 'T(화목토) 완료'}</Btn>
                </div>
                <span className="muted" style={{ fontSize: 12 }}>{st.mDone && st.tDone ? '월수금·화목토 모두 완료' : st.mDone ? '월수금(M) 완료' : st.tDone ? '화목토(T) 완료' : '아직 표시하지 않음'}</span>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn variant={st.status === 'done' ? 'primary' : 'secondary'} full disabled={!!unmet && st.status !== 'done'} onClick={() => App.markTask(t.id, 'done')}>V 완료했습니다</Btn>
                  <Btn variant={st.status === 'undone' ? 'destructive' : 'secondary'} full onClick={() => App.markTask(t.id, 'undone')}>X 못 했습니다</Btn>
                </div>
                <span className="muted" style={{ fontSize: 12 }}>{stLine}</span>
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <PageTitle
        title={otherTeam ? '상담일정' : '내 업무'}
        cap={otherTeam ? `직접 만든 일정 · 진행 중 ${open}건` : `미완료 ${open}건`}
        action={otherTeam ? <Btn variant="primary" onClick={() => App.openOtherCounselCreate()}>+ 상담일정 만들기</Btn> : null}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {chips.map((p) => (
          <span key={p[0]} className={'chip' + (u.myFilter === p[0] ? ' on' : '')} onClick={() => { u.myFilter = p[0]; App.render(); }}>{p[1]}</span>
        ))}
      </div>
      <div className="feature-grid cols-tasks">
        <Card flush>
          {!vis.length ? (
            <div className="dashed-box" style={{ margin: 16 }}>
              {mine.length ? (
                `선택한 필터에 해당하는 ${otherTeam ? '상담일정이' : '업무가'} 없습니다 — 「전체」로 바꿔 확인해 주세요.`
              ) : otherTeam ? (
                <div className="col" style={{ gap: 10, alignItems: 'center' }}>
                  <span>아직 만든 상담일정이 없습니다 — 본인 반 학생을 대상으로 첫 일정을 만들어 주세요.</span>
                  <Btn variant="primary" size="sm" onClick={() => App.openOtherCounselCreate()}>+ 상담일정 만들기</Btn>
                </div>
              ) : '배정된 업무가 없습니다.'}
            </div>
          ) : null}
          {vis.map((t: any) => {
            const meta = tagMeta(t.tag, S.tags);
            const stObj = (t.statuses[S.me.name] || {});
            const st = stObj.status;
            const counselLike = t.counsel || t.specialCounsel;
            const cp = counselLike ? t.counselProg?.[S.me.name] : null;
            const tone = counselLike ? (counselComplete(cp, !!t.specialCounsel) ? 'success' : 'neutral') : (st === 'done' ? 'success' : st === 'undone' ? 'destructive' : 'neutral');
            const icon = !counselLike && st === 'done' ? '✓' : !counselLike && st === 'undone' ? '✕' : '';
            const label = counselLike
              ? counselCountLabel(cp, !!t.specialCounsel)
              : t.mt
              ? (stObj.mDone && stObj.tDone ? '완료' : `M${stObj.mDone ? '✓' : '·'} T${stObj.tDone ? '✓' : '·'}`)
              : (st === 'done' ? '완료' : st === 'undone' ? '미완료' : '미표시');
            const select = () => { u.selTask = t.id; App.render(); };
            return (
              <div
                key={t.id}
                className={'lrow' + (t.id === u.selTask ? ' sel' : '')}
                role="button"
                tabIndex={0}
                aria-pressed={t.id === u.selTask}
                aria-label={`${t.title} 상세 보기`}
                onClick={select}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } }}
              >
                <div className="row">
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{t.title}</span>
                  <Badge tone={meta.tone} icon={meta.emoji}>{t.tag}</Badge>
                  {t.specialCounsel ? <Badge tone="brand" icon="✦">특강</Badge> : null}
                  <span className="grow" />
                  <Badge tone={tone} icon={icon}>{label}</Badge>
                </div>
                <div className="row" style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                  <span>{'마감 ' + t.dueLabel}</span>
                  <Badge tone={ddayTone(t.dday)}>{ddayLabel(t.dday)}</Badge>
                </div>
              </div>
            );
          })}
        </Card>
        <Card>{detailBody}</Card>
      </div>
    </div>
  );
}
