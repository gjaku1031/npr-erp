import React, { useState } from 'react';
import { useApp } from '@/lib/state';
import { Btn, Card, Badge, Alert, Toggle, IconCircle, DraftField, DraftTextArea, FileChips, counselComplete, counselCountLabel, counselAbsenceStats } from '@/components/ui';
import { Markdown, MarkdownEditor } from '@/components/Markdown';
import { groupOf, koDate, koDateFull, nextDay, ddayLabel, ddayTone, pickFiles, toast } from '@/lib/helpers';

// 체크리스트/보고 파일: 실제 파일 선택 → {name,url(data)} (4MB 가드)
function attachFiles(target: any[], picked: any[]) {
  const MAX = 4 * 1024 * 1024;
  for (const p of picked) {
    if (Math.floor(((p.b64 || '').length) * 0.75) > MAX) { toast(`'${p.filename}'은(는) 너무 큽니다 (4MB 이하만).`); continue; }
    target.push({ name: p.filename, url: `data:application/octet-stream;base64,${p.b64}` });
  }
}

const STEP_NAMES = ['체크리스트', '알림장', '상담 확인', '출결 확인', '업무 확인'];

// 위저드에서 처리할 반 = 저장된 반 스냅샷(일반 + 특강, 중복 제거). 제출/임시저장본은 당시 스냅샷을 사용한다.
function todayClasses(App: any): string[] {
  return App.todayClasses();
}

// 일일보고 날짜(작성 대상)에 해당하는 기간의 업무만 — 시작일 ≤ 보고일 ≤ 마감일, 보관 제외
function reportTasks(App: any): any[] {
  const today = App.reportDate();
  return App.state.tasks.filter((t: any) => !t.archived && (!t.start || t.start <= today) && (!t.due || t.due >= today));
}

// BR-GATE-1: 5단계 제출 게이트에서 MT·일반/특강 상담 업무는 제외한다(제출을 막지 않음).
// 일반 업무만 V/X 표시(myStatus[id] != null)를 요구한다. stepDone과 5단계 표시 수가
// 같은 판정을 쓰도록 하는 단일 헬퍼 — 상담 진행도 배지 노출과 다른 화면의 전체 로스터
// 기준 진행률 집계는 그대로 유지된다.
function taskGateDone(t: any, myStatus: Record<string, any>): boolean {
  return (t.mt || t.counsel || t.specialCounsel) ? true : myStatus[t.id] != null;
}

function stepDone(App: any, i: number): boolean {
  const w = App.ui.wizard, S = App.state;
  if (i === 1) {
    const items = (S.journals.find((j: any) => j.date === App.reportDate()) || { items: [] }).items;
    return items.length > 0 && items.every((it: any) => { const s = w.cl[it.id] || {}; return s.checked && (!it.required || (s.report || '').trim()); });
  }
  if (i === 2) { const cls = todayClasses(App); return cls.length === 0 || (w.nbSync === 'done' && cls.every((c: string) => (w.nbByClass[c] || {}).written)); }
  if (i === 3) return w.counselOk;
  if (i === 4) return w.attOk;
  // 오늘 기간 업무만 — 게이트 판정은 taskGateDone(BR-GATE-1) 하나로 통일.
  if (i === 5) return reportTasks(App).every((t: any) => taskGateDone(t, w.myStatus));
  return false;
}

export function Wizard() {
  const { App } = useApp();
  const w = App.ui.wizard, S = App.state;
  const reportDate = App.reportDate(); // 작성 대상 일일보고 날짜(지난 보고면 그 날짜) — 모든 날짜 의존 표시의 기준
  if (w.view === 'submitted') return <SubmittedView />;

  const done = [1, 2, 3, 4, 5].map((i) => stepDone(App, i));
  const progress = done.filter(Boolean).length;

  const notLast = w.step < 5;
  const allDone = done.every(Boolean);
  const hint = allDone && w.step === 5 ? '모든 단계가 완료되었습니다 — 제출해 주세요.'
    : w.step === 5 ? '남은 단계: ' + STEP_NAMES.filter((_, i) => !done[i]).join(', ')
      : ['모든 항목을 체크하고 필수 보고를 작성하면 다음으로.', '통통통 동기화 후 반별 알림장을 모두 게시하면 완료.', '상담 내용 확인 처리 후 다음으로.', '출결 확인 처리 후 다음으로.'][w.step - 1];

  return (
    <div>
      <div className="row" style={{ gap: 12, marginBottom: 20 }}>
        <Btn variant="ghost" size="sm" onClick={() => App.exitWizard()}>‹ 목록</Btn>
        <h1 className="page-title">일일보고 작성</h1>
        {w.specialPeriod ? <Badge tone="brand" icon="✦">특강기간</Badge> : null}
        {reportDate < S.today ? <Badge tone="neutral">지난 보고 작성</Badge> : null}
        <span className="cap">{`${koDateFull(reportDate)} · 하루 1회 제출`}</span>
        <span className="grow" />
        {w.dirty ? <span className="muted" style={{ fontSize: 12 }}>임시저장됨</span> : null}
        <Btn variant="secondary" size="sm" onClick={() => App.saveDraft()}>임시저장</Btn>
      </div>
      <div className="feature-grid cols-wizard">
        <Card flush>
          <div style={{ padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {STEP_NAMES.map((name, idx) => {
              const n = idx + 1, isCur = w.step === n, isDone = done[idx];
              return (
                <div key={n} className={'rail-row' + (isCur ? ' on' : '')} onClick={() => { w.step = n; App.enterStep(n); }}>
                  <span className={'rail-mark ' + (isCur ? 'cur' : isDone ? 'done' : '')}>{isDone && !isCur ? '✓' : String(n)}</span>
                  <span className="rail-label">{`${n}단계 · ${name}`}</span>
                </div>
              );
            })}
            <div style={{ padding: '12px 12px 10px', borderTop: '1px solid var(--border)', marginTop: 8 }}>
              <div className="bar" style={{ marginBottom: 6 }}><i style={{ width: `${(progress / 5) * 100}%` }} /></div>
              <span className="muted" style={{ fontSize: 12 }}>{`${progress}/5 단계 완료`}</span>
            </div>
          </div>
        </Card>

        <div className="col" style={{ gap: 16 }}>
          <StepContent />
          <div className="row" style={{ gap: 10 }}>
            <Btn variant="secondary" disabled={w.step === 1} onClick={() => { w.step--; App.enterStep(w.step); }}>‹ 이전</Btn>
            <span className="grow muted" style={{ fontSize: 12, textAlign: 'center' }}>{hint}</span>
            {notLast
              ? <Btn variant="primary" disabled={!done[w.step - 1]} onClick={() => { w.step++; App.enterStep(w.step); }}>다음 ›</Btn>
              : <Btn variant="primary" disabled={!allDone} onClick={() => App.submitWizard()}>일일보고 제출</Btn>}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepContent() {
  const { App } = useApp();
  const w = App.ui.wizard;
  return [<Step1 key="1" />, <Step2 key="2" />, <Step3 key="3" />, <Step4 key="4" />, <Step5 key="5" />][w.step - 1];
}

// STEP 1 체크리스트
function Step1() {
  const { App } = useApp();
  const S = App.state, w = App.ui.wizard;
  const reportDate = App.reportDate();
  const items = (S.journals.find((j: any) => j.date === reportDate) || { items: [] }).items;
  const checked = items.filter((it: any) => (w.cl[it.id] || {}).checked).length;
  return (
    <Card title="1단계 · 체크리스트 확인" action={<span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>{`${checked}/${items.length}`}</span>}>
      <p className="cap" style={{ marginBottom: 16 }}>팀장이 작성한 공통 체크리스트입니다. 확인 후 체크하고, 항목별 결과를 보고해 주세요.</p>
      <div className="col" style={{ gap: 12 }}>
        {items.map((it: any) => {
          const s = w.cl[it.id] || (w.cl[it.id] = { checked: false, report: '', files: [] });
          return (
            <div key={it.id} className={'cl-box' + (s.checked ? ' on' : '')}>
              <div className="row" style={{ cursor: 'pointer' }} onClick={() => { s.checked = !s.checked; App.markDirty(); App.render(); }}>
                <span className={'cl-check' + (s.checked ? ' on' : '')}>✓</span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{it.text}</span>
                <span className="grow" />
                {it.required ? <Badge tone="neutral">보고 필수</Badge> : null}
              </div>
              {s.checked ? (
                <div style={{ margin: '10px 0 0 32px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <MarkdownEditor key={it.id} rows={2} ariaLabel="확인 결과 보고" placeholder="확인 결과를 입력해 주세요" defaultValue={s.report} onInput={(v) => { s.report = v; App.markDirty(); }} hint="입력하면 바로 서식 적용 — ‘# ’ 제목 · ‘- ’ 목록 · **굵게**" />
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <Btn variant="subtle" size="sm" onClick={() => pickFiles('', true, (arr) => { attachFiles(s.files, arr); App.markDirty(); App.render(); })}>📎 파일 첨부</Btn>
                    <FileChips files={s.files} onRemove={(i) => { s.files.splice(i, 1); App.markDirty(); App.render(); }} />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// STEP 2 알림장
function Step2() {
  const { App } = useApp();
  const S = App.state, w = App.ui.wizard;
  const reportDate = App.reportDate();
  const past = reportDate < S.today; // 지난 보고면 '오늘' 대신 '해당일'로 표기
  const cls = todayClasses(App);
  const group = groupOf(reportDate);
  const written = cls.filter((c) => (w.nbByClass[c] || {}).written).length;

  const header = (
    <div className="col" style={{ gap: 14 }}>
      <Alert tone="info">통통통 알림장(앱관리 과제)과 연동됩니다 — 매핑된 반마다 알림장을 게시해야 완료됩니다.</Alert>
      <div className="muted-box" style={{ gridTemplateColumns: 'auto 1fr' }}>
        <span className="muted">담당 반</span>
        <span style={{ fontWeight: 600 }}>{cls.join(' · ') || '없음'}<span className="muted" style={{ fontWeight: 400 }}>{` — ${group || '해당 없음'} 기준 · ${cls.length}개 반`}</span></span>
        <span className="muted">마감일</span>
        <span style={{ fontWeight: 600 }}>{koDate(nextDay(reportDate))}<span className="muted" style={{ fontWeight: 400 }}> — 다음 날로 자동 지정</span></span>
      </div>
    </div>
  );

  return (
    <Card title="2단계 · 알림장 확인" action={
      <div className="row" style={{ gap: 8 }}>
        {cls.length && w.nbSync === 'done' ? <Btn variant="ghost" size="sm" onClick={() => App.syncNotebooks()}>↻ 다시 동기화</Btn> : null}
        <Badge tone={written === cls.length && cls.length ? 'success' : 'warning'}>{`${written}/${cls.length}개 반 게시`}</Badge>
      </div>
    }>
      {header}
      {!cls.length ? (
        <div className="dashed-box">{`${past ? '해당일' : '오늘'} 담당 반이 없습니다 — 강사 현황에서 담당 반을 지정해 주세요.`}</div>
      ) : w.nbSync !== 'done' ? (
        <div style={{ border: '1px dashed var(--border)', borderRadius: 12, padding: '26px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>통통통 동기화가 필요합니다</span>
          <span className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>반별 알림장 작성 여부를 확인합니다. 이미 작성된 알림장은 불러와 수정하고, 없으면 새로 작성합니다.</span>
          <Btn variant="primary" loading={w.nbSync === 'loading'} loadingLabel="동기화 중..." onClick={() => App.syncNotebooks()}>통통통 동기화</Btn>
        </div>
      ) : (
        cls.map((c) => <NbBlock key={c} c={c} />)
      )}
    </Card>
  );
}

function NbBlock({ c }: { c: string }) {
  const { App } = useApp();
  const S = App.state, w = App.ui.wizard;
  const reportDate = App.reportDate();
  const past = reportDate < S.today; // 지난 보고면 '오늘' 대신 '해당일'로 표기
  const b = w.nbByClass[c] || (w.nbByClass[c] = { written: false, editing: true, title: '', body: '', files: [], titleDraft: `${koDate(reportDate)} ${c} 알림장`, bodyDraft: '', urlDrafts: [], imageDrafts: [], fileDrafts: [] });

  const head = (
    <div className="row">
      <Badge tone="brand">{c}</Badge>
      <span className="muted" style={{ fontSize: 12 }}>{b.written ? (b.source || '통통통에 게시됨') : '작성된 알림장이 없습니다 — 새로 작성해 주세요'}</span>
      <span className="grow" />
      <Badge tone={b.written ? 'success' : 'destructive'} icon={b.written ? '✓' : ''}>{b.written ? '게시됨' : (past ? '해당일 미작성' : '오늘 미작성')}</Badge>
    </div>
  );

  if (b.written && !b.editing) {
    return (
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {head}
        <div className="col" style={{ gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{b.title}</span>
          <p style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{b.body}</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{(b.files || []).map((f: string, i: number) => <span key={i} className="file-chip">{f}</span>)}</div>
          <div><Btn variant="secondary" size="sm" onClick={() => { b.editing = true; b.titleDraft = b.title; b.bodyDraft = b.body; App.render(); }}>수정하기</Btn></div>
        </div>
      </div>
    );
  }

  b.urlDrafts = b.urlDrafts || []; b.imageDrafts = b.imageDrafts || []; b.fileDrafts = b.fileDrafts || [];
  const chip = (label: string, onX: () => void, key: string) => <span key={key} className="file-chip">{label}<span style={{ cursor: 'pointer', color: 'var(--muted-foreground)' }} onClick={onX}>✕</span></span>;
  const anyAttach = b.urlDrafts.length || b.imageDrafts.length || b.fileDrafts.length;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {head}
      <div className="col" style={{ gap: 14 }}>
        <DraftField key={c + '-t'} label="제목" required placeholder={`예: ${koDate(reportDate)} 수업 안내`} defaultValue={b.titleDraft} onInput={(v) => { b.titleDraft = v; }} />
        <DraftTextArea key={c + '-b'} label="내용" required rows={4} placeholder={past ? '해당일 수업 내용, 과제, 전달 사항을 입력해 주세요' : '오늘 수업 내용, 과제, 전달 사항을 입력해 주세요'} defaultValue={b.bodyDraft} onInput={(v) => { b.bodyDraft = v; }} />
        <div className="col" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Btn variant="subtle" size="sm" disabled={b.urlDrafts.length >= 2} onClick={() => { b.addingUrl = true; App.render(); }}>URL 추가</Btn>
            <Btn variant="subtle" size="sm" disabled={b.imageDrafts.length >= 5} onClick={() => pickFiles('image/*', true, (arr) => { b.imageDrafts.push(...arr); App.render(); })}>이미지 첨부</Btn>
            <Btn variant="subtle" size="sm" disabled={b.fileDrafts.length >= 2} onClick={() => pickFiles('', true, (arr) => { b.fileDrafts.push(...arr); App.render(); })}>파일 첨부</Btn>
          </div>
          {b.addingUrl ? (
            <div className="row" style={{ gap: 8 }}>
              <div style={{ flex: 1 }}><DraftField key={c + '-u'} placeholder="https:// 링크 주소" defaultValue={b.urlInput || ''} onInput={(v) => { b.urlInput = v; }} /></div>
              <Btn variant="secondary" size="md" onClick={() => { if (!(b.urlInput || '').trim()) return; b.urlDrafts.push(b.urlInput.trim()); b.urlInput = ''; b.addingUrl = false; App.render(); }}>추가</Btn>
            </div>
          ) : null}
          {anyAttach ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {b.urlDrafts.map((u: string, i: number) => chip('🔗 ' + u, () => { b.urlDrafts.splice(i, 1); App.render(); }, 'u' + i))}
              {b.imageDrafts.map((im: any, i: number) => chip('🖼 ' + im.filename, () => { b.imageDrafts.splice(i, 1); App.render(); }, 'im' + i))}
              {b.fileDrafts.map((f: any, i: number) => chip('📎 ' + f.filename, () => { b.fileDrafts.splice(i, 1); App.render(); }, 'f' + i))}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Btn variant="primary" loading={b.posting} loadingLabel="게시 중..." onClick={() => App.postNotebook(c)}>알림장 게시</Btn>
        </div>
      </div>
    </div>
  );
}

// STEP 3 상담
function Step3() {
  const { App } = useApp();
  const w = App.ui.wizard, rows = App.counselRows || [];
  const past = App.reportDate() < App.state.today; // 지난 보고면 '오늘' 대신 '해당일'로 표기
  return (
    <Card title="3단계 · 상담 내용 확인" action={
      <div className="row" style={{ gap: 8 }}>
        <Btn variant="ghost" size="sm" loading={w.counselSync === 'loading'} loadingLabel="동기화 중..." onClick={() => App.syncCounsel()}>↻ 다시 동기화</Btn>
        <span style={{ fontSize: 13, fontWeight: 700, color: w.counselOk ? 'var(--primary)' : 'var(--muted-foreground)' }}>{`${rows.length}건`}</span>
      </div>
    }>
      <div className="col" style={{ gap: 12 }}>
        <p className="cap">{`통통통에서 불러온 ${past ? '해당일' : '오늘'}의 상담 기록입니다 (학생 · 상담 주제 · 내용). 들어올 때마다 자동 동기화되며, 우측 버튼으로 언제든 다시 불러올 수 있습니다.`}</p>
        {rows.map((r: any, i: number) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }}>
            <div className="row" style={{ marginBottom: 6 }}><span style={{ fontSize: 14, fontWeight: 700 }}>{r.student}</span><Badge tone="neutral">{r.topic}</Badge></div>
            <p style={{ fontSize: 13.5, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.body}</p>
          </div>
        ))}
        <Toggle boxed checked={w.counselOk} label={past ? '해당일 상담 내용을 모두 확인했습니다' : '오늘 상담 내용을 모두 확인했습니다'} description="확인 처리하면 3단계가 완료됩니다." onChange={(v) => { w.counselOk = v; App.markDirty(); App.render(); }} />
      </div>
    </Card>
  );
}

// 과제 이행 → 등급(문제없음=A, 과제미흡=B, 과제미이행=C). C는 빨강.
function hwGrade(v?: string): { label: string; red: boolean; dim: boolean } {
  const s = (v || '').trim();
  if (!s) return { label: '—', red: false, dim: true };
  if (s.indexOf('미이행') >= 0) return { label: 'C', red: true, dim: false };
  if (s.indexOf('미흡') >= 0) return { label: 'B', red: false, dim: false };
  if (s.indexOf('없음') >= 0 || s.indexOf('문제') >= 0) return { label: 'A', red: false, dim: false };
  return { label: s, red: false, dim: false };
}
function HwCell({ v }: { v?: string }) {
  const g = hwGrade(v);
  const label = g.dim ? '미입력' : g.label; // 아직 입력 안 된 과제는 '미입력'
  return <b title={(v || '').trim() || undefined} style={{ color: g.red ? 'var(--destructive)' : g.dim ? 'var(--muted-foreground)' : 'var(--foreground)', fontWeight: g.dim ? 400 : 700, fontSize: g.dim ? 11 : undefined }}>{label}</b>;
}

// STEP 4 출결
function Step4() {
  const { App } = useApp();
  const w = App.ui.wizard, cls = todayClasses(App);
  const reportDate = App.reportDate();
  const past = reportDate < App.state.today; // 지난 보고면 '오늘' 대신 '해당일'로 표기
  const cur = cls.includes(w.attClass) ? w.attClass : cls[0];
  const rows = (App.attByClass && App.attByClass[cur]) || [];
  const scoreData = (App.scoresByClass && App.scoresByClass[cur]) || null;
  const scoreMap: Record<string, any> = {};
  (scoreData?.rows || []).forEach((r: any) => { scoreMap[r.student] = r; });
  const hasScore = !!(scoreData && scoreData.scoreDate);   // 주간테스트 점수(설정 날짜)
  const hasHw = !!(scoreData && rows.length);              // 선행/심화 과제 — 일일보고 날짜 기준, 미입력이면 '미입력' 표시
  // 학생 이름 호버 툴팁(학교 | 어머니 번호) — 테이블 overflow에 안 잘리게 position:fixed
  const [tip, setTip] = useState<{ name: string; school: string; phone: string; left: number; top: number } | null>(null);
  const showTip = (e: React.MouseEvent, r: any) => { const rc = (e.currentTarget as HTMLElement).getBoundingClientRect(); setTip({ name: r.name, school: (r.school || '').trim(), phone: (r.motherPhone || '').trim(), left: rc.left, top: rc.bottom + 7 }); };
  const action = (
    <div className="row" style={{ gap: 8 }}>
      {cur ? <Btn variant="ghost" size="sm" loading={w.attSync === cur} loadingLabel="동기화 중..." onClick={() => App.syncAttendance(cur)}>↻ 다시 동기화</Btn> : null}
      <Badge tone="neutral">{rows.length ? `출석 ${rows.filter((r: any) => r.st === '출석').length} · 지각 ${rows.filter((r: any) => r.st === '지각').length} · 결석 ${rows.filter((r: any) => r.st.indexOf('결석') === 0).length}` : '기록 없음'}</Badge>
    </div>
  );
  return (
    <Card title="4단계 · 출결 확인" action={action}>
      <div className="row" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
        {cls.map((c) => <span key={c} className={'chip' + (c === cur ? ' on' : '')} onClick={() => { w.attClass = c; App.loadAttendance(c); }}>{c}</span>)}
        <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{koDateFull(reportDate).replace(/^\d+년 /, '') + ' 기준'}</span>
      </div>
      {rows.length ? (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
          <table className="tbl">
            <thead><tr>{['학생', '상태'].concat(hasHw ? ['선행', '심화'] : []).concat(hasScore ? ['주간테스트'] : []).map((x) => <th key={x}>{x}</th>)}</tr></thead>
            <tbody>
              {rows.map((r: any, i: number) => {
                const sc = scoreMap[r.name];
                const totalNum = sc && sc.total !== '' ? Number(sc.total) : NaN;
                const lowScore = !Number.isNaN(totalNum) && totalNum < 70;
                return (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>
                      <span className="stu-name" onMouseEnter={(e) => showTip(e, r)} onMouseLeave={() => setTip(null)}>{r.name}</span>
                    </td>
                    <td><Badge tone={r.tone}>{r.st}</Badge></td>
                    {hasHw ? (
                      <>
                        <td><HwCell v={sc?.hwAhead} /></td>
                        <td><HwCell v={sc?.hwDeepen} /></td>
                      </>
                    ) : null}
                    {hasScore ? (
                      <td>{sc && sc.total !== '' ? (
                        <span title={`평균 ${sc.avg || '—'} · 석차 ${sc.rank || '—'}/${sc.examinees || '—'}${sc.opinion ? ' · ' + sc.opinion : ''}`}>
                          <b style={{ color: lowScore ? 'var(--destructive)' : 'var(--primary)' }}>{sc.total}</b>
                          {sc.rank ? <span className="muted" style={{ fontSize: 11, marginLeft: 5 }}>{`${sc.rank}등`}</span> : null}
                        </span>
                      ) : <span className="muted">—</span>}</td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="dashed-box" style={{ marginBottom: 14 }}>통통통에 이 반의 출결 기록이 아직 없습니다.</div>
      )}
      {rows.length && (hasHw || hasScore) ? (
        <p className="muted" style={{ fontSize: 11.5, marginTop: -6, marginBottom: 14 }}>{`${hasHw ? '선행·심화 과제(일일보고일 ' + scoreData!.hwDate + '): A 문제없음·B 미흡·C 미이행(빨강)·미입력' : ''}${hasHw && hasScore ? ' · ' : ''}${hasScore ? '주간테스트(' + scoreData!.scoreDate + ') 70점 미만 빨강' : ''}`}</p>
      ) : rows.length && !hasScore ? (
        <p className="muted" style={{ fontSize: 11.5, marginTop: -6, marginBottom: 14 }}>주간테스트 기간이 설정되지 않았습니다. (팀장 · 일일보고 관리에서 M반/T반 날짜 설정)</p>
      ) : null}
      <Toggle boxed checked={w.attOk} label={past ? '해당일 담당 반의 출결 기록을 모두 확인했습니다' : '오늘 담당 반의 출결 기록을 모두 확인했습니다'} description="결석·지각 학생은 필요 시 1단계 보고에 남겨 주세요." onChange={(v) => { w.attOk = v; App.markDirty(); App.render(); }} />
      {tip ? (
        <div className="stu-tip" style={{ left: tip.left, top: tip.top }}>
          <span className="stu-tip-item"><span className="k">학교</span><b>{tip.school || '—'}</b></span>
          <span className="stu-tip-div" />
          <span className="stu-tip-item"><span className="k">어머니</span><b className="ph">{tip.phone || '—'}</b></span>
        </div>
      ) : null}
    </Card>
  );
}

// STEP 5 업무 확인
function Step5() {
  const { App } = useApp();
  const S = App.state, w = App.ui.wizard;
  const reportDate = App.reportDate();
  const tasks = reportTasks(App); // 보고 날짜(오늘/지난 보고) 기간에 해당하는 업무만
  const marked = tasks.filter((t: any) => taskGateDone(t, w.myStatus)).length; // stepDone(5)과 동일 판정(BR-GATE-1)
  return (
    <Card title="5단계 · 업무 확인" action={<span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>{`${marked}/${tasks.length}`}</span>}>
      <p className="cap" style={{ marginBottom: 12 }}>{`${koDateFull(reportDate).replace(/^\d+년 /, '')} 기간에 해당하는 업무입니다. 처리 여부를 표시하면 제출할 수 있습니다.`}</p>
      {tasks.map((t: any) => {
        const st = w.myStatus[t.id];
        const me = S.me.name;
        const rep = (t.statuses[me] || {});
        const unmet = t.reportReq && !(rep.reportText || '').trim() ? '텍스트 보고' : (t.attachReq && (rep.reportFiles || []).length === 0 ? '첨부파일' : null);
        const line = st === 'done' ? '완료로 표시됨' : st === 'undone' ? '미완료로 표시됨' : (unmet ? unmet + ' 필수 — 내 업무에서 작성' : '아직 표시하지 않음');
        return (
          <div key={t.id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <div className="row"><span style={{ fontSize: 14, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--border)', textUnderlineOffset: 3 }} title="업무 상세 · 수정" onClick={() => App.openModal({ type: 'task', id: t.id })}>{t.title}</span><Badge tone={ddayTone(t.dday)}>{ddayLabel(t.dday)}</Badge><span className="grow" /><span className="muted" style={{ fontSize: 12 }}>{'마감 ' + t.dueLabel}</span></div>
            <Markdown text={t.descr} className="muted" style={{ fontSize: 13, lineHeight: 1.6 }} />
            {(t.links || []).length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{t.links.map((l: any, i: number) => <a key={i} className="link-chip" href={l.url} target="_blank" rel="noreferrer">{'🔗 ' + l.label}</a>)}</div> : null}
            {(t.counsel || t.specialCounsel) ? (() => {
              const cProg = t.counselProg?.[me];
              const cAbs = counselAbsenceStats(cProg);
              const cNoTarget = !!t.specialCounsel && !!cProg?.noTarget;
              return (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {t.specialCounsel ? <Badge tone="brand" icon="✦">특강상담</Badge> : <Badge tone="brand">전체 상담</Badge>}
                  <Badge tone={counselComplete(cProg, !!t.specialCounsel) ? 'success' : 'neutral'}>{counselCountLabel(cProg, !!t.specialCounsel, '상담 전송')}</Badge>
                  {!cNoTarget ? <Badge tone="neutral">{`부재 ${cAbs.absenceCount}회`}</Badge> : null}
                  {cAbs.absencePendingCount ? <Badge tone="warning">{`확인 대기 ${cAbs.absencePendingCount}`}</Badge> : null}
                  {!cNoTarget ? <Btn variant="secondary" size="sm" onClick={() => App.openModal({ type: 'counselStatus', taskId: t.id })}>학생 상세</Btn> : null}
                  <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--muted-foreground)' }}>학생별 상담 전송으로 자동 집계됩니다 — 일일보고 제출을 막지 않습니다.</span>
                </div>
              );
            })() : t.mt ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: 12, marginRight: 2 }}>MT 업무</span>
                <Btn variant={rep.mDone ? 'primary' : 'secondary'} size="sm" onClick={() => App.markTaskMt(t.id, 'm', !rep.mDone)}>{(rep.mDone ? '✓ ' : '') + 'M(월수금)'}</Btn>
                <Btn variant={rep.tDone ? 'primary' : 'secondary'} size="sm" onClick={() => App.markTaskMt(t.id, 't', !rep.tDone)}>{(rep.tDone ? '✓ ' : '') + 'T(화목토)'}</Btn>
                <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--muted-foreground)' }}>{rep.mDone && rep.tDone ? '모두 완료' : rep.mDone ? 'M 완료' : rep.tDone ? 'T 완료' : '미완료'}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn variant={st === 'done' ? 'primary' : 'secondary'} size="sm" disabled={!!unmet && st !== 'done'} onClick={() => App.wizMark(t.id, 'done')}>V 완료</Btn>
                <Btn variant={st === 'undone' ? 'destructive' : 'secondary'} size="sm" onClick={() => App.wizMark(t.id, 'undone')}>X 미완료</Btn>
                <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--muted-foreground)' }}>{line}</span>
              </div>
            )}
          </div>
        );
      })}
    </Card>
  );
}

function SubmittedView() {
  const { App } = useApp();
  const S = App.state;
  const reportDate = App.reportDate();
  const special = !!(App.ui.wizard && App.ui.wizard.specialPeriod);
  return (
    <div style={{ maxWidth: 520, margin: '48px auto 0' }}>
      <Card emphasis>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', padding: '16px 8px' }}>
          <IconCircle tone="success" size="lg">✓</IconCircle>
          <h2 style={{ fontSize: 20, fontWeight: 700 }}>일일보고가 제출되었습니다</h2>
          {special ? <Badge tone="brand" icon="✦">특강기간 보고</Badge> : null}
          <p className="muted" style={{ fontSize: 14 }}>{`${S.me.name} · ${koDateFull(reportDate)}`}<br />팀장 대시보드에 실시간 반영되었습니다.</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <Btn variant="primary" onClick={() => App.exitWizard()}>일일보고 목록으로</Btn>
            <Btn variant="secondary" disabled={S.myReport && S.myReport.confirmed} onClick={() => { App.ui.wizard.view = 'edit'; App.render(); }}>제출 내용 수정</Btn>
          </div>
        </div>
      </Card>
    </div>
  );
}
