import React, { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '@/lib/state';
import { Btn, Badge, Field, Select, Toggle, Alert, FileChips, TextArea, counselComplete, counselCountLabel, counselAbsenceStats } from '@/components/ui';
import { Markdown, MarkdownEditor } from '@/components/Markdown';
import { tagMeta, ddayLabel, ddayTone, koDate, koDateFull, groupOf, PRESETS, COLORS, toast } from '@/lib/helpers';
import { counselReconcileSummary } from '@/lib/counsel-sync';

// 이름 변경·삭제가 불가능한 시스템 상담 태그. 업무 종류(일반/특강 상담)는 이 태그로만 결정된다.
const COUNSEL_TAG = '상담';
const SPECIAL_COUNSEL_TAG = '특강 상담';

export function ModalHost() {
  const { App } = useApp();
  const m = App.ui.modal;
  const root = typeof document !== 'undefined' ? document.getElementById('modal-root') : null;
  if (!m || !root) return null;
  let content: React.ReactNode = null;
  if (m.type === 'taskCreate') content = <TaskCreateModal editId={m.editId} dateInit={m.dateInit} />;
  else if (m.type === 'otherCounselCreate') content = <OtherCounselCreateModal />;
  else if (m.type === 'task') content = <TaskDetailModal id={m.id} />;
  else if (m.type === 'log') content = <LogViewModal m={m} />;
  else if (m.type === 'tags') content = <TagManagerModal />;
  else if (m.type === 'eventCreate') content = <EventCreateModal mode={m.mode} editId={m.editId} dateInit={m.dateInit} />;
  else if (m.type === 'eventView') content = <EventViewModal id={m.id} />;
  else if (m.type === 'dayAdd') content = <DayAddModal date={m.date} />;
  else if (m.type === 'counselSend') content = <CounselSendModal m={m} />;
  else if (m.type === 'counselStatus') content = <CounselStatusModal m={m} />;
  else if (m.type === 'counselAbsence') content = <CounselAbsenceModal m={m} />;
  return createPortal(content, root);
}

function OtherCounselCreateModal() {
  const { App } = useApp();
  const S = App.state;
  const requestIdRef = useRef('');
  if (!requestIdRef.current) requestIdRef.current = 'other-counsel-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const [title, setTitle] = useState('');
  const [descr, setDescr] = useState('');
  const [start, setStart] = useState(S.today);
  const [due, setDue] = useState(S.today);
  const [submitting, setSubmitting] = useState(false);
  const submit = async () => {
    if (!title.trim()) return toast('상담일정 이름을 입력해 주세요.');
    if (!start || !due || due < start) return toast('시작일과 마감일을 확인해 주세요.');
    setSubmitting(true);
    try {
      const ok = await App.createOtherCounsel({
        title: title.trim(), descr: descr.trim(), start, due, requestId: requestIdRef.current,
      });
      if (ok) App.closeModal();
    } finally {
      setSubmitting(false);
    }
  };
  const roster = App.otherTeamRoster;
  return (
    <Shell title="상담일정 만들기" foot={
      <>
        <Btn variant="secondary" full disabled={submitting} onClick={() => App.closeModal()}>취소</Btn>
        <Btn variant="primary" full disabled={!roster?.sourceMonth} loading={submitting} loadingLabel="만드는 중..." onClick={submit}>상담일정 만들기</Btn>
      </>
    }>
      <Alert tone="info">본인 반 관리에서 선택한 학생을 상담 대상으로 고정합니다. 만든 뒤 학생별 상담 작성·통통통 전송 현황을 직접 확인할 수 있습니다.</Alert>
      {roster?.sourceMonth ? (
        <div className="muted-box" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <span className="muted">상담 대상</span>
          <span style={{ fontWeight: 600 }}>{`${roster.classCount || 0}개 반 · ${roster.studentCount || 0}명`}
            <span className="muted" style={{ fontWeight: 400 }}>{` · 수강년월 ${roster.sourceMonth} 기준`}</span>
          </span>
        </div>
      ) : (
        <div className="col" style={{ gap: 10 }}>
          <Alert tone="warning">본인 반 관리에서 사용할 반을 먼저 선택해야 상담 대상 학생이 정해집니다.</Alert>
          <div><Btn variant="secondary" size="sm" onClick={() => { App.closeModal(); App.go('classes'); }}>본인 반 관리로 이동</Btn></div>
        </div>
      )}
      <Field label="일정 이름" required placeholder="예: 9월 정기 상담" value={title} onInput={setTitle} />
      <TextArea label="메모" rows={3} placeholder="상담 목표나 기간 중 확인할 내용을 적어 주세요." value={descr} onInput={setDescr} />
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}><Field label="시작일" required type="date" value={start} onInput={setStart} /></div>
        <div style={{ flex: 1 }}><Field label="마감일" required type="date" value={due} onInput={setDue} /></div>
      </div>
    </Shell>
  );
}

// 다이얼로그 공통 접근성 훅 — 열릴 때 포커스를 대화상자 안으로 옮기고 닫힐 때 이전 포커스를 복원한다.
// Escape는 X·오버레이와 같은 close 동작을 호출하므로, close가 잠긴 동안(예: 전송 중)은 Escape도 닫지 않는다.
function useDialogA11y(close: () => void) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing) closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, []);
  return dialogRef;
}

// onClose를 주면 오버레이/X/Escape 닫기가 기본 전체 닫기 대신 그 동작을 따른다(예: 상담 현황으로 복귀).
// bodyRef를 주면 본문(.modal-bd) DOM에 접근할 수 있다 — TaskCreateModal이 저장 중 본문을 inert로 잠그는 데 쓴다(넘기지 않는 호출부는 영향 없음).
function Shell({ title, children, foot, onClose, bodyRef }: { title: React.ReactNode; children: React.ReactNode; foot?: React.ReactNode; onClose?: () => void; bodyRef?: React.RefObject<HTMLDivElement> }) {
  const { App } = useApp();
  const close = onClose || (() => App.closeModal());
  const titleId = useId();
  const dialogRef = useDialogA11y(close);
  return (
    <div>
      <div className="overlay" onClick={close} />
      <div className="modal-wrap">
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={dialogRef}>
          <div className="modal-hd"><h2 id={titleId}>{title}</h2><button className="x-btn" aria-label="닫기" onClick={close}>✕</button></div>
          <div className="modal-bd" ref={bodyRef}>{children}</div>
          {foot ? <div className="modal-ft">{foot}</div> : null}
        </div>
      </div>
    </div>
  );
}

// ── 태그 선택: 네이티브 셀렉트 대신 태그 색·이모지가 그대로 보이는 칩 라디오그룹 ──
// 시스템 상담 태그(상담/특강 상담)는 '시스템' 표식으로 구분한다. 선택지 목록(options)은
// 호출부가 기존 규칙(특강기간에만 '특강 상담' 노출 등)대로 걸러서 넘긴다.
function TagField({ tags, options, value, onChange, hint }: { tags: any[]; options: string[]; value: string; onChange: (v: string) => void; hint?: string }) {
  const labelId = useId();
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, dir: number) => {
    if (!options.length) return;
    const to = (from + dir + options.length) % options.length;
    onChange(options[to]);
    btnRefs.current[to]?.focus();
  };
  return (
    <div className="field">
      <label id={labelId}>태그<span className="req">*</span></label>
      <div role="radiogroup" aria-labelledby={labelId} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map((name, i) => {
          const meta = tagMeta(name, tags);
          const def = (tags || []).find((x: any) => x.name === name);
          const on = name === value;
          return (
            <button
              key={name}
              ref={(el) => { btnRefs.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (!options.includes(value) && i === 0) ? 0 : -1}
              className={'chip' + (on ? ' on' : '')}
              onClick={() => onChange(name)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i, 1); }
                else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i, -1); }
              }}
            >
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: meta.edge, flex: 'none' }} />
              {meta.emoji ? <span aria-hidden="true">{meta.emoji}</span> : null}
              {name}
              {def?.fixed ? <span style={{ fontSize: 10, fontWeight: 700, border: '1px solid currentColor', opacity: 0.75, borderRadius: 999, padding: '0 5px', lineHeight: 1.5 }}>시스템</span> : null}
            </button>
          );
        })}
      </div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

// ── 업무 생성/수정 ──
function TaskCreateModal({ editId, dateInit }: { editId?: string; dateInit?: string }) {
  const { App } = useApp();
  const S = App.state;
  // 모달 인스턴스당 고정 requestId — 전송 실패로 다시 시도해도 값이 유지돼 같은 키로 재전송(멱등)된다.
  const requestIdRef = useRef<string>('');
  if (!requestIdRef.current) requestIdRef.current = 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const [submitting, setSubmitting] = useState(false);
  const [d, setD] = useState<any>(() => {
    if (editId) {
      const t = S.tasks.find((x: any) => x.id === editId);
      if (t) return { title: t.title, desc: t.descr, tag: t.tag, all: t.scope === 'all', pick: t.scope === 'all' ? [] : t.scope.slice(), start: t.start, due: t.due, links: (t.links || []).slice(), linkLabel: '', linkUrl: '', reportReq: t.reportReq, attachReq: t.attachReq, mt: t.mt, counsel: t.counsel, specialCounsel: t.specialCounsel };
    }
    return { title: '', desc: '', tag: S.tags[0] ? S.tags[0].name : '행정', all: true, pick: [], start: dateInit || S.today, due: dateInit || S.today, links: [], linkLabel: '', linkUrl: '', reportReq: false, attachReq: false, mt: false, counsel: false, specialCounsel: false };
  });
  const set = (k: string, v: any) => setD((x: any) => ({ ...x, [k]: v }));
  const editing = !!editId;
  const orig = editId ? S.tasks.find((x: any) => x.id === editId) : null;
  // 상담 종류는 오직 태그로 결정한다. 시스템 태그 도입 전 커스텀 태그로 만든 기존 상담은
  // 태그를 바꾸지 않는 한 종류를 보존한다(백엔드 updateTask의 legacyMode와 일치).
  const legacyCounsel = !!(orig && (orig.counsel || orig.specialCounsel)
    && orig.tag !== COUNSEL_TAG && orig.tag !== SPECIAL_COUNSEL_TAG && d.tag === orig.tag);
  const counselMode: 'none' | 'regular' | 'special' =
    d.tag === COUNSEL_TAG ? 'regular'
      : d.tag === SPECIAL_COUNSEL_TAG ? 'special'
        : legacyCounsel ? (orig!.specialCounsel ? 'special' : 'regular')
          : 'none';
  const counselLike = counselMode !== 'none';
  const isSpecial = counselMode === 'special';
  const specialEnabled = !!(S.settings && S.settings.specialPeriodEnabled);
  // 특강 상담 태그는 특강기간에만 새 업무에서 선택할 수 있다. 단, 이미 그 태그인 업무를 수정할 땐 계속 노출한다.
  const tagOptions = S.tags
    .map((t: any) => t.name)
    .filter((name: string) => name !== SPECIAL_COUNSEL_TAG || specialEnabled || d.tag === SPECIAL_COUNSEL_TAG || (orig && orig.tag === SPECIAL_COUNSEL_TAG));
  // 신규 특강상담 생성은 대상 확정·원자 저장 때문에 다른 저장보다 오래 걸릴 수 있다.
  // 서버가 진행률을 주지 않으므로 퍼센트 대신 경과 시간과 처리 순서만 보여준다(불확정 진행 표시).
  const creatingSpecial = !editing && counselMode === 'special';
  // 진행 UI는 매 render 파생값(creatingSpecial)이 아니라 submit 시작 순간에 고정한 값을 쓴다 —
  // 느린 저장 중 사용자가 태그를 바꿔도(요청은 이미 특강으로 전송됨) 경과시간·진행 표시가 사라지지 않는다.
  const [savingSpecial, setSavingSpecial] = useState(false);
  const [saveElapsed, setSaveElapsed] = useState(0);
  useEffect(() => {
    if (!(submitting && savingSpecial)) { setSaveElapsed(0); return; }
    const started = Date.now();
    const iv = setInterval(() => setSaveElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(iv);
  }, [submitting, savingSpecial]);
  // 저장 중(느린 특강상담 저장 포함)에는 본문(.modal-bd) 전체를 inert로 잠근다 — 모든 입력·토글·칩·링크가
  // 클릭/키보드/포커스를 받지 못한다. 딤이나 스타일 변화 없이 상호작용만 차단하며, 푸터의 진행 표시·취소/생성
  // 버튼과 Escape·X·오버레이 close 잠금은 그대로 동작한다. inert는 DOM 프로퍼티로 직접 토글한다(접근성·크로스브라우저 견고).
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.inert = submitting; }, [submitting]);
  const submit = async () => {
    if (submitting) return; // 더블클릭 차단(버튼 disabled와 이중 방어)
    if (!(d.title || '').trim()) { toast('업무 이름을 입력해 주세요.'); return; }
    if (!d.tag) { toast('태그를 선택해 주세요.'); return; }
    if (!d.all && (d.pick || []).length === 0) { toast('담당 강사를 선택해 주세요.'); return; }
    setSubmitting(true);
    // 이 요청이 신규 특강상담인지 지금 고정한다 — 아래 payload와 같은 시점의 값이라, 저장이 끝날 때까지 진행 UI가 요청과 일치한다.
    setSavingSpecial(creatingSpecial);
    let ok = false;
    // 상담/특강상담 여부는 선택한 태그로부터 파생해 보낸다. 서버도 태그를 진실로 삼는다.
    const payload = { ...d, counsel: counselMode === 'regular', specialCounsel: counselMode === 'special' };
    try { ok = editing ? await App.updateTask(editId, payload) : await App.createTask(payload, requestIdRef.current); }
    catch { ok = false; }
    finally { setSavingSpecial(false); }
    // 성공(true)일 때만 닫는다. 실패 시 입력과 requestId를 유지하고 버튼을 다시 활성화한다.
    if (ok) App.closeModal(); else setSubmitting(false);
  };
  const addLink = () => { if (!(d.linkUrl || '').trim()) return; set('links', [...d.links, { label: d.linkLabel || d.linkUrl, url: d.linkUrl }]); set('linkLabel', ''); set('linkUrl', ''); };

  const foot = (
    <div className="col" style={{ flex: 1, gap: 10 }}>
      {submitting && savingSpecial ? (
        <div style={{ border: '1px solid var(--border)', background: 'var(--muted)', borderRadius: 12, padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row" style={{ gap: 10 }}>
            {/* aria-valuenow 없음 = 불확정 진행 — 서버가 퍼센트를 주지 않아 수치로 표기하지 않는다. */}
            <div className="bar" role="progressbar" aria-label="특강상담 업무 생성 진행 중">
              <i style={{ width: '32%', marginLeft: saveElapsed % 2 ? '68%' : '0%', transition: 'margin-left 1s ease-in-out' }} />
            </div>
            <span aria-hidden="true" style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>{`${saveElapsed}초 경과`}</span>
          </div>
          <span role="status" style={{ fontSize: 12.5, color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
            특강상담 대상을 확정해 생성하고 있습니다 — <b>대상 확인 › 안전하게 저장 › 목록 반영</b> 순서로 처리되며, 완료되면 창이 자동으로 닫힙니다.
          </span>
        </div>
      ) : null}
      <div className="row" style={{ gap: 8 }}>
        <Btn variant="secondary" full disabled={submitting} onClick={() => App.closeModal()}>취소</Btn>
        <Btn variant="primary" full loading={submitting} loadingLabel={editing ? '저장 중…' : '생성 중…'} onClick={submit}>{editing ? '수정 저장' : '업무 생성'}</Btn>
      </div>
    </div>
  );

  // 저장 중에는 Escape·X·오버레이 닫기도 잠근다 — 응답 유실 시 같은 requestId로 재시도할 수 있게 폼을 유지한다.
  return (
    <Shell title={editing ? '업무 수정' : '업무 생성'} foot={foot} bodyRef={bodyRef} onClose={() => { if (!submitting) App.closeModal(); }}>
      <Field label="업무 이름" required placeholder="예: 7월 모의고사 채점 및 성적 입력" value={d.title} onInput={(v) => set('title', v)} />
      <MarkdownEditor label="업무 내용" rows={4} placeholder="강사가 확인할 상세 내용을 입력해 주세요" defaultValue={d.desc} onInput={(v) => set('desc', v)} hint="입력하면 바로 서식 적용 — ‘# ’ 제목 · ‘- ’ 목록 · ‘1. ’ 번호 · **굵게**" />
      <TagField tags={S.tags} options={tagOptions} value={d.tag} onChange={(v) => set('tag', v)}
        hint={counselLike
          ? (d.tag === COUNSEL_TAG || d.tag === SPECIAL_COUNSEL_TAG
            ? `‘${d.tag}’ 시스템 태그 — 상담 업무로 처리됩니다.`
            : '기존 상담 업무 — 태그를 바꾸지 않으면 상담 유형이 유지됩니다.')
          : '캘린더·목록의 색상 구분 · ‘상담’·‘특강 상담’을 고르면 상담 업무가 됩니다.'} />
      <Toggle boxed checked={d.all} label="전체 강사에게 배정" description="끄면 담당 강사를 개별 선택합니다." onChange={(v) => set('all', v)} />
      {!d.all ? (
        <div className="col" style={{ gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>담당 강사 <span className="muted" style={{ fontWeight: 400 }}>{`— ${d.pick.length}명 선택`}</span></span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {S.teacherNames.map((n: string) => (
              <span className={'chip' + (d.pick.includes(n) ? ' on' : '')} key={n} onClick={() => set('pick', d.pick.includes(n) ? d.pick.filter((x: string) => x !== n) : [...d.pick, n])}>{n}</span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}><Field label="시작일" required type="date" value={d.start} onInput={(v) => set('start', v)} /></div>
        <div style={{ flex: 1 }}><Field label="마감 기한" required type="date" value={d.due} onInput={(v) => set('due', v)} /></div>
      </div>
      <div className="col" style={{ gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>링크 <span className="muted" style={{ fontWeight: 400 }}>— 스프레드시트·문서 등 참고 주소</span></span>
        <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <div style={{ width: 128 }}><Field placeholder="이름 (선택)" value={d.linkLabel} onInput={(v) => set('linkLabel', v)} /></div>
          <div style={{ flex: 1 }}><Field placeholder="https:// 주소" value={d.linkUrl} onInput={(v) => set('linkUrl', v)} /></div>
          <Btn variant="secondary" onClick={addLink}>추가</Btn>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {d.links.map((l: any, i: number) => (
            <span className="link-chip" key={i}>{'🔗 ' + (l.label || l.url)}<span style={{ cursor: 'pointer', color: 'var(--muted-foreground)' }} onClick={() => set('links', d.links.filter((_: any, j: number) => j !== i))}>✕</span></span>
          ))}
        </div>
      </div>
      {counselLike ? (
        <div className="col" style={{ gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>완료 조건 <span className="muted" style={{ fontWeight: 400 }}>— 상담 전송 현황으로 자동 집계</span></span>
          <Alert tone="info">{isSpecial ? '특강 상담' : '상담'} 업무의 이행은 강사가 학생별 상담을 통통통에 전송하면 <b>자동 집계</b>됩니다. 업무 보고(텍스트·첨부)는 선택으로 남길 수 있지만 완료 조건이 아닙니다.</Alert>
        </div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>완료 조건 <span className="muted" style={{ fontWeight: 400 }}>— 강사가 V 완료할 때 요구되는 값</span></span>
          <Toggle checked={d.reportReq} label="텍스트 보고 필수" onChange={(v) => set('reportReq', v)} />
          <Toggle checked={d.attachReq} label="첨부파일 필수" onChange={(v) => set('attachReq', v)} />
          {editing && d.mt ? <span className="hint" style={{ marginTop: 2 }}>기존 MT 업무입니다 — 강사가 M(월수금)·T(화목토)를 따로 완료합니다. 새 MT 업무는 만들 수 없습니다.</span> : null}
        </div>
      )}
    </Shell>
  );
}

// ── 업무 상세 ──
function TaskDetailModal({ id }: { id: string }) {
  const { App } = useApp();
  const t = App.state.tasks.find((x: any) => x.id === id);
  if (!t) return <Shell title="업무"><p>업무를 찾을 수 없습니다.</p></Shell>;
  const meta = tagMeta(t.tag, App.state.tags);
  const pct = t.total ? Math.round((t.doneCount / t.total) * 100) : 0;
  const viewNames = App.ui.role === 'lead' ? t.assignees : t.assignees.filter((n: string) => n === App.state.me.name);
  const isLead = App.ui.role === 'lead';
  // 팀장에게만 수정/삭제 푸터를 노출한다(기존과 동일). 끝의 grow로 두 버튼을 왼쪽에 정렬한다.
  const foot = isLead ? (
    <>
      <Btn variant="secondary" onClick={() => App.openTaskEdit(t.id)}>수정</Btn>
      <Btn variant="destructive" onClick={() => App.deleteTask(t.id)}>삭제</Btn>
      <span className="grow" />
    </>
  ) : undefined;
  // 손수 만든 오버레이/모달 대신 공용 Shell로 전환 — dialog role·포커스 트랩/복원·Escape·오버레이 닫기·접근 가능한 닫기(X)를 얻는다.
  // 헤더의 날짜·담당/태그/D-day는 제목 아래 본문 상단 행으로 옮겨 그대로 표시한다(EventViewModal과 같은 패턴).
  return (
    <Shell title={t.title} foot={foot}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="cap">{`${t.startLabel} ~ ${t.dueLabel} · 담당 ${t.scope === 'all' ? '전체' : t.assignees.length + '명'}`}</span>
        <span className="grow" />
        <Badge tone={meta.tone} icon={meta.emoji}>{t.tag}</Badge>
        <Badge tone={ddayTone(t.dday, t.archived)}>{ddayLabel(t.dday)}</Badge>
      </div>
      <Markdown text={t.descr} style={{ fontSize: 14, lineHeight: 1.7 }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {t.reportReq ? <Badge tone="warning">텍스트 보고 필수</Badge> : null}
        {t.attachReq ? <Badge tone="warning">첨부파일 필수</Badge> : null}
        {t.mt ? <Badge tone="brand">MT 업무</Badge> : null}
        {t.counsel ? <Badge tone="brand">전체 상담 업무</Badge> : null}
        {t.specialCounsel ? <Badge tone="brand" icon="✦">특강상담 업무</Badge> : null}
        {(t.links || []).map((l: any, i: number) => <a className="link-chip" key={'l' + i} href={l.url} target="_blank" rel="noreferrer">{'🔗 ' + l.label}</a>)}
        {(t.atts || []).map((a: string, i: number) => <span className="file-chip" key={'a' + i}>{'📎 ' + a}</span>)}
      </div>
      <div className="row" style={{ gap: 10 }}><div className="bar"><i style={{ width: pct + '%' }} /></div><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)' }}>{`${t.doneCount}/${t.total}명`}</span></div>
      {(t.counsel || t.specialCounsel) ? (
        <span className="muted" style={{ fontSize: 12 }}>{isLead ? '강사를 누르면 학생별 상담 전송·부재/문자 현황이 열립니다.' : '이름을 누르면 학생별 상담을 작성·전송하고 부재/문자를 기록할 수 있습니다.'}</span>
      ) : null}
      <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 16px', background: 'var(--muted)', fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-foreground)' }}><span>강사</span><span>상태</span></div>
        <div>
          {viewNames.map((name: string) => {
            const st = t.statuses[name] || { status: 'none' };
            const counselLike = t.counsel || t.specialCounsel;
            const cp = counselLike ? t.counselProg?.[name] : null;
            const tone = counselLike
              ? (counselComplete(cp, !!t.specialCounsel) ? 'success' : 'neutral')
              : st.status === 'done' ? 'success' : st.status === 'undone' ? 'destructive' : 'neutral';
            const label = counselLike
              ? counselCountLabel(cp, !!t.specialCounsel)
              : t.mt
              ? (st.mDone && st.tDone ? '완료' : `M ${st.mDone ? '✓' : '·'}  T ${st.tDone ? '✓' : '·'}`)
              : (st.status === 'done' ? '완료' : st.status === 'undone' ? '미완료' : '미표시');
            const icon = !t.mt && !counselLike && st.status === 'done' ? '✓' : !t.mt && !counselLike && st.status === 'undone' ? '✕' : '';
            const abs = counselAbsenceStats(cp);
            const noTargetRow = counselLike && !!t.specialCounsel && !!cp?.noTarget;
            return (
              <div style={{ borderTop: '1px solid var(--border)' }} key={name}>
                {counselLike ? (
                  // 강사 행 자체가 상담 개요다 — 누르면 그 강사의 학생 상담 상세로 들어가고, 닫으면 이 업무 상세로 복귀한다.
                  <button type="button" className="btn ghost" title={`${name} 학생 상담 상세 열기`}
                    style={{ width: '100%', justifyContent: 'flex-start', gap: 8, flexWrap: 'wrap', padding: '9px 16px', borderRadius: 0, fontSize: 13 }}
                    onClick={() => App.openModal({ type: 'counselStatus', taskId: t.id, teacher: name, returnModal: { type: 'task', id: t.id } })}>
                    <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>{name}</span>
                    <span aria-hidden="true" style={{ fontSize: 12 }}>›</span>
                    <span className="grow" />
                    <Badge tone={tone}>{label}</Badge>
                    {!noTargetRow ? <Badge tone="neutral">{`부재 ${abs.absenceCount}회`}</Badge> : null}
                    {abs.absencePendingCount ? <Badge tone="warning">{`확인 대기 ${abs.absencePendingCount}`}</Badge> : null}
                  </button>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px', fontSize: 13 }}><span style={{ fontWeight: 500 }}>{name}</span><Badge tone={tone} icon={icon}>{label}</Badge></div>
                )}
                {st.reportText ? (
                  <div style={{ padding: '0 16px 10px', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    <span style={{ flex: 'none', fontSize: 12.5, fontWeight: 600, color: 'var(--muted-foreground)', lineHeight: 1.6 }}>보고</span>
                    <Markdown text={st.reportText} style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--muted-foreground)', lineHeight: 1.6 }} />
                  </div>
                ) : null}
                {(st.reportFiles && st.reportFiles.length) ? <div style={{ padding: '0 16px 10px', display: 'flex', gap: 6, flexWrap: 'wrap' }}><FileChips files={st.reportFiles} /></div> : null}
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}

// ── 일지 열람 ──
function LogViewModal({ m }: { m: any }) {
  const { App } = useApp();
  const S = App.state;
  const teacher = S.teachers.find((t: any) => t.name === m.name) || { name: m.name, classes: {} };
  const rep = App.viewReport;
  const confirmed = rep ? rep.confirmed : (m.confirmed || false);
  const viewDate = m.rawDate || S.today;
  const group = groupOf(viewDate);
  // 제출된 보고는 제출 시점의 반 스냅샷/특강 여부를 사용한다(현재 매핑이 아님). 구버전 보고는 스냅샷이 없어 현재 매핑으로 대체.
  const savedSnapshot: string[] | null = rep && rep.payload && Array.isArray(rep.payload.classSnapshot) ? rep.payload.classSnapshot : null;
  const clsArr = savedSnapshot || ((teacher.classes && teacher.classes[group as string]) || []);
  const reportSpecial = !!(rep && rep.payload && rep.payload.specialPeriod);
  const okMark: React.CSSProperties = { color: 'var(--success)', fontWeight: 700 };
  const items = (S.journals.find((j: any) => j.date === viewDate) || S.journals.find((j: any) => j.date === S.today) || { items: [] }).items;
  const counsel = App.counselRows || [];

  const section = (no: string, title: string, tone: string, icon: string, badge: string, lines: any[], key: string) => (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px' }} key={key}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="section-label">{`${no} · ${title}`}</span><span className="grow" /><Badge tone={tone} icon={icon}>{badge}</Badge>
      </div>
      <div className="col">
        {lines.map((l: any, i: number) => (
          <div style={{ display: 'grid', gridTemplateColumns: '18px 1fr auto', gap: '2px 8px', padding: '9px 2px', borderTop: '1px solid var(--border)', fontSize: 13, lineHeight: 1.6, alignItems: 'baseline' }} key={i}>
            <span style={l.mkStyle || okMark}>{l.mk || '·'}</span>
            <b style={{ fontWeight: 600 }}>{l.head}</b>
            <span style={{ color: 'var(--muted-foreground)', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }}>{l.sub || ''}</span>
            {l.body ? (l.md
              ? <div style={{ gridColumn: '2 / -1', minWidth: 0 }}><Markdown text={l.body} style={{ fontSize: 12.5, color: 'var(--muted-foreground)', lineHeight: 1.6 }} /></div>
              : <span style={{ gridColumn: '2 / -1', color: 'var(--muted-foreground)', fontSize: 12.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{l.body}</span>) : null}
            {l.action ? <span style={{ gridColumn: '2 / -1', marginTop: 4 }}>{l.action}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );

  const canConfirm = App.ui.role === 'lead' && !confirmed && (rep ? rep.status === 'submitted' : true);
  const stTone = confirmed ? 'success' : 'warning';
  const stLabel = confirmed ? '확인 완료' : '확인 대기';
  return (
    <div>
      <div className="overlay" onClick={() => App.closeModal()} />
      <div className="modal-wrap">
        <div className="modal">
          <div className="modal-hd">
            <div style={{ flex: 1 }}><h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>{`${m.name} · 일일보고`}</h2><span className="cap">{m.date || koDateFull(S.today)}</span></div>
            {reportSpecial ? <Badge tone="brand" icon="✦">특강</Badge> : null}
            <Badge tone={stTone} icon={confirmed ? '✓' : ''}>{stLabel}</Badge>
            <button className="x-btn" onClick={() => App.closeModal()}>✕</button>
          </div>
          <div className="modal-bd">
            {(() => {
              // 실제 제출 payload를 반영(하드코딩 ✓ 아님). draft/부분제출도 정확히 표시.
              const P: any = (rep && rep.payload) || {};
              const cl = P.cl || {}, nbByClass = P.nbByClass || {}, myStatus = P.myStatus || {};
              const muted: React.CSSProperties = { color: 'var(--muted-foreground)', fontWeight: 700 };
              const bad: React.CSSProperties = { color: 'var(--destructive)', fontWeight: 700 };
              const clDone = items.filter((it: any) => (cl[it.id] || {}).checked).length;
              const nbDone = clsArr.filter((c: string) => (nbByClass[c] || {}).written).length;
              const myTasks = S.tasks.filter((t: any) => t.assignees.includes(m.name) && !t.archived);
              // 상담·특강상담 업무의 이행은 표시(myStatus)가 아닌 전송 진행도(counselProg)로 집계한다.
              // 특강상담 대상 없음(noTarget)은 V·'대상 없음'으로 완료 표기한다.
              const taskMark = (t: any) => {
                if (t.counsel || t.specialCounsel) {
                  const c = t.counselProg?.[m.name];
                  const done = counselComplete(c, !!t.specialCounsel);
                  // 팀장은 해당 보고 교사의 학생 상담 상세를 읽기 전용으로 연다(teacher=m.name). 닫으면 이 일일보고로 복귀.
                  const action = App.ui.role === 'lead'
                    ? <Btn variant="ghost" size="sm" onClick={() => App.openModal({ type: 'counselStatus', taskId: t.id, teacher: m.name, returnModal: m })}>학생 상세</Btn>
                    : undefined;
                  return { mk: done ? 'V' : '·', mkStyle: done ? okMark : muted, head: t.title, sub: `— ${counselCountLabel(c, !!t.specialCounsel, '상담 전송')}`, action };
                }
                const st = myStatus[t.id];
                return { mk: st === 'done' ? 'V' : st === 'undone' ? 'X' : '·', mkStyle: st === 'done' ? okMark : st === 'undone' ? bad : muted, head: t.title, sub: st === 'done' ? '— 완료' : st === 'undone' ? '— 미완료' : '— 미표시' };
              };
              const taskMarked = myTasks.filter((t: any) => (t.counsel || t.specialCounsel) ? counselComplete(t.counselProg?.[m.name], !!t.specialCounsel) : myStatus[t.id]).length;
              const okTone = (a: number, b: number) => (b > 0 && a >= b ? 'success' : 'warning');
              const okIcon = (a: number, b: number) => (b > 0 && a >= b ? '✓' : '!');
              return (<>
                {section('1단계', '체크리스트', okTone(clDone, items.length), okIcon(clDone, items.length), `${clDone}/${items.length} 확인`,
                  // 체크리스트 결과 보고는 서식 편집기로 작성되므로 마크다운으로 렌더한다(md). '미확인' 등 상태 문구는 평문 유지.
                  items.map((it: any) => { const c = cl[it.id] || {}; const rep = (c.report || '').trim(); return { mk: c.checked ? '✓' : '·', mkStyle: c.checked ? okMark : muted, head: it.text, sub: it.required ? '— 보고 필수' : '', body: rep || (c.checked ? '' : '미확인'), md: !!rep }; }), 's1')}
                {section('2단계', '알림장', okTone(nbDone, clsArr.length), okIcon(nbDone, clsArr.length), `${nbDone}/${clsArr.length}개 반 게시`,
                  (clsArr.length ? clsArr : ['담당 반 없음']).map((c: string) => { const nb = nbByClass[c] || {}; return { mk: nb.written ? '✓' : '·', mkStyle: nb.written ? okMark : muted, head: `${c} 알림장`, sub: nb.written ? '— 게시됨' : '— 미게시', body: (nb.title || '').trim() }; }), 's2')}
                {section('3단계', '상담 확인', P.counselOk ? 'success' : 'warning', P.counselOk ? '✓' : '!', P.counselOk ? `${counsel.length}건 확인` : '미확인',
                  counsel.map((r: any) => ({ head: `${r.student} — ${r.topic}`, body: r.body })), 's3')}
                {section('4단계', '출결 확인', P.attOk ? 'success' : 'warning', P.attOk ? '✓' : '!', P.attOk ? '확인함' : '미확인', [], 's4')}
                {section('5단계', '업무 확인', okTone(taskMarked, myTasks.length), okIcon(taskMarked, myTasks.length), `${taskMarked}/${myTasks.length} 표시`,
                  myTasks.map((t: any) => taskMark(t)), 's5')}
              </>);
            })()}
          </div>
          {canConfirm ? (
            <div className="modal-ft">
              <Btn variant="secondary" full onClick={() => App.closeModal()}>닫기</Btn>
              <Btn variant="primary" full onClick={() => App.confirmReport(m.name, m.rawDate)}>보고 확인 처리</Btn>
            </div>
          ) : null}
          {!canConfirm && confirmed ? <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', fontSize: 12.5, color: 'var(--muted-foreground)' }}>확인 완료된 보고입니다 — 강사는 더 이상 수정할 수 없습니다.</div> : null}
        </div>
      </div>
    </div>
  );
}

// ── 태그 관리 ──
function TagManagerModal() {
  const { App } = useApp();
  const S = App.state;
  const [tagName, setTagName] = useState('');
  const foot = <Btn variant="primary" full onClick={() => App.closeModal()}>완료</Btn>;
  return (
    <Shell title="태그 관리" foot={foot}>
      <p className="cap">태그의 색상·이모지는 캘린더와 업무 목록에 바로 반영됩니다.</p>
      <Alert tone="info">‘{COUNSEL_TAG}’과 ‘{SPECIAL_COUNSEL_TAG}’은 시스템 상담 태그입니다 — 이름 변경·삭제는 할 수 없고, 색상과 이모지만 바꿀 수 있습니다.</Alert>
      {S.tags.map((tag: any) => {
        const isHex = String(tag.color).indexOf('#') === 0;
        return (
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }} key={tag.name}>
            <div className="row">
              <span style={{ fontSize: 16 }}>{tag.emoji}</span>
              {tag.fixed ? (
                <>
                  <span style={{ fontSize: 14, fontWeight: 700, flex: 1, padding: '5px 8px' }}>{tag.name}</span>
                  <Badge tone="neutral" title="상담 업무에 쓰이는 시스템 태그 — 이름 변경·삭제 불가, 색상·이모지만 편집 가능">🔒 시스템 상담 태그</Badge>
                </>
              ) : (
                <>
                  <input className="inp" defaultValue={tag.name} key={'nm-' + tag.name} title="이름 수정(Enter/포커스 해제 시 저장)"
                    style={{ fontSize: 14, fontWeight: 700, flex: 1, padding: '5px 8px' }}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== tag.name) App.updateTag(tag.name, { name: v }); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                  <button className="x-btn" title="태그 삭제" onClick={() => App.deleteTag(tag.name)}>✕</button>
                </>
              )}
            </div>
            <div className="row">
              <span className="section-label" style={{ width: 36 }}>색상</span>
              <div className="row" style={{ gap: 8 }}>
                {PRESETS.map((ck) => (
                  <span key={ck} title={ck} onClick={() => App.updateTag(tag.name, { color: ck })}
                    style={{ width: 18, height: 18, borderRadius: 999, cursor: 'pointer', background: COLORS[ck].edge, flex: 'none', ...(tag.color === ck ? { boxShadow: '0 0 0 2px var(--card),0 0 0 4px var(--ring)' } : {}) }} />
                ))}
                <label style={{ position: 'relative', width: 22, height: 22, borderRadius: 999, border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', ...(isHex ? { background: tag.color } : {}) }}>
                  <span style={{ fontSize: 10, lineHeight: 1 }}>{isHex ? '' : '🎨'}</span>
                  <input type="color" value={isHex ? tag.color : '#638402'} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }} onChange={(e) => App.updateTag(tag.name, { color: e.target.value })} />
                </label>
                <span className="muted" style={{ fontSize: 11.5 }}>직접 선택</span>
              </div>
            </div>
            <div className="row">
              <span className="section-label" style={{ width: 36 }}>이모지</span>
              <div style={{ width: 64 }}><Field value={tag.emoji} placeholder="😀" onInput={(v) => { const e = [...v]; App.updateTag(tag.name, { emoji: e[e.length - 1] || '' }); }} /></div>
              <span className="muted" style={{ fontSize: 11.5 }}>이모지 1개만 입력</span>
            </div>
          </div>
        );
      })}
      <div className="row" style={{ gap: 8, marginTop: 4, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}><Field placeholder="새 태그 이름 — 예: 시설" value={tagName} onInput={setTagName} /></div>
        <Btn variant="secondary" onClick={() => { if (tagName.trim()) { App.addTag(tagName); setTagName(''); } }}>+ 태그 추가</Btn>
      </div>
    </Shell>
  );
}

// ── 일정 등록 ──
function EventCreateModal({ mode, editId, dateInit }: { mode?: string; editId?: string; dateInit?: string }) {
  const { App } = useApp();
  const S = App.state;
  const ev = editId ? (S.events || []).find((x: any) => x.id === editId) : null;
  const evMode = ev ? (ev.owner === 'team' ? 'team' : 'personal') : (mode || 'personal');
  const isTeam = evMode === 'team';
  const tagOpts = [...(S.tags || []).map((t: any) => t.name), isTeam ? '일정' : '개인일정'];
  const [d, setD] = useState<any>(ev
    ? { title: ev.title, desc: ev.descr || '', start: ev.start, end: ev.end, tag: isTeam ? ev.tag : '개인일정' }
    : { title: '', desc: '', start: dateInit || S.today, end: dateInit || S.today, tag: isTeam ? '일정' : '개인일정' });
  const [submitting, setSubmitting] = useState(false);
  const set = (k: string, v: any) => setD((x: any) => ({ ...x, [k]: v }));
  // 엄격한 실제 날짜 검사 — JS Date는 2026-02-31을 3월로 정규화하므로, 파싱 결과를 다시 직렬화해 원본과 일치할 때만 유효.
  const validIso = (v: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return false;
    const dt = new Date(v + 'T00:00:00');
    if (Number.isNaN(dt.getTime())) return false;
    const p = (n: number) => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}` === v;
  };
  const submit = async () => {
    if (submitting) return; // 더블클릭·중복 저장 차단(버튼 loading과 이중 방어)
    if (!(d.title || '').trim()) { toast('일정 이름을 입력해 주세요.'); return; }
    if (!validIso(d.start)) { toast('시작일을 정확히 입력해 주세요.'); return; }
    if (!validIso(d.end)) { toast('종료일을 정확히 입력해 주세요.'); return; }
    if (d.end < d.start) { toast('종료일은 시작일과 같거나 이후여야 합니다.'); return; } // 두 값 모두 YYYY-MM-DD라 문자열 비교=날짜 비교
    setSubmitting(true);
    let ok = false;
    try { ok = editId ? await App.updateEvent(editId, evMode, d) : await App.createEvent(evMode, d); }
    catch { ok = false; }
    // 성공(true)일 때만 닫는다. 실패 시 입력·모달을 모두 유지하고 버튼을 다시 활성화한다.
    if (ok) App.closeModal(); else setSubmitting(false);
  };
  const foot = (<>
    <Btn variant="secondary" full disabled={submitting} onClick={() => App.closeModal()}>취소</Btn>
    <Btn variant="primary" full loading={submitting} loadingLabel={editId ? '저장 중…' : '등록 중…'} onClick={submit}>{editId ? '수정 저장' : '일정 등록'}</Btn>
  </>);
  // 저장 중에는 Escape·X·오버레이 닫기도 잠근다 — 실패 시 입력을 유지해 재시도할 수 있게 한다.
  return (
    <Shell title={`${isTeam ? '팀 일정' : '개인일정'} ${editId ? '수정' : '등록'}`} foot={foot} onClose={() => { if (!submitting) App.closeModal(); }}>
      <Alert tone="info">{isTeam ? '팀 일정은 전 강사 캘린더에 노출됩니다.' : '개인일정은 본인 캘린더에만 표시됩니다.'}</Alert>
      <Field label="일정 이름" required placeholder="예: 교육지원청 회의" value={d.title} onInput={(v) => set('title', v)} />
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}><Field label="시작일" required type="date" value={d.start} onInput={(v) => set('start', v)} /></div>
        <div style={{ flex: 1 }}><Field label="종료일" required type="date" value={d.end} onInput={(v) => set('end', v)} /></div>
      </div>
      {isTeam ? <Select label="태그" options={tagOpts} value={d.tag} onChange={(v) => set('tag', v)} hint="색상·분류에 사용 — 업무 태그를 재사용합니다." /> : null}
      {/* 개인일정 메모만 todo 편집('[ ]' 입력·'체크 항목 추가') 허용 — 팀 일정에는 두 prop을 넘기지 않아 기존 편집 그대로다. */}
      <MarkdownEditor label="메모" rows={3} placeholder="시간·장소 등을 남겨 주세요" defaultValue={d.desc} onInput={(v) => set('desc', v)} {...(!isTeam ? { allowTodo: true, showTodoButton: true } : {})} hint="입력하면 바로 서식 적용 — ‘# ’ 제목 · ‘- ’ 목록 · **굵게**" />
    </Shell>
  );
}

// ── 일정 보기 ──
function EventViewModal({ id }: { id: string }) {
  const { App } = useApp();
  const e = App.state.events.find((x: any) => x.id === id);
  if (!e) return <Shell title="일정"><p>일정을 찾을 수 없습니다.</p></Shell>;
  // 소유자(e.mine)에게만 수정/삭제 푸터를 노출한다.
  const foot = e.mine ? (<>
    <Btn variant="secondary" full onClick={() => App.openEventEdit(e.id)}>수정</Btn>
    <Btn variant="destructive" full onClick={() => App.deleteEvent(e.id)}>삭제</Btn>
  </>) : undefined;
  // Shell로 전환해 dialog role·포커스 복원·Escape·접근 가능한 닫기를 얻는다. 날짜/태그는 본문 상단 행으로 옮겨 그대로 표시한다.
  return (
    <Shell title={e.title} foot={foot}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="cap">{`${koDate(e.start)} ~ ${koDate(e.end)}`}</span>
        <span className="grow" />
        <Badge tone="neutral">{e.tag}</Badge>
      </div>
      {/* 개인일정 소유자(e.type==='personal' && e.mine)에게만 onTodoChange를 넘겨 체크박스를 활성화한다 — 팀 일정·다른 사람 일정은 기본 disabled 읽기 전용. */}
      {e.descr
        ? <Markdown text={e.descr} style={{ fontSize: 14, lineHeight: 1.7 }} {...(e.type === 'personal' && e.mine ? { onTodoChange: (next: any) => App.updateEventTodo(e.id, next) } : {})} />
        : <p className="muted" style={{ fontSize: 14, lineHeight: 1.7 }}>메모 없음</p>}
    </Shell>
  );
}

// ── 날짜 클릭 → 추가 선택 ──
function DayAddModal({ date }: { date: string }) {
  const { App } = useApp();
  const isLead = App.ui.role === 'lead';
  const foot = <Btn variant="secondary" full onClick={() => App.closeModal()}>닫기</Btn>;
  return (
    <Shell title={`${koDate(date)}에 추가`} foot={foot}>
      <p className="cap" style={{ marginBottom: 4 }}>이 날짜에 무엇을 추가할까요?</p>
      <div className="col" style={{ gap: 8 }}>
        {isLead ? <Btn variant="primary" full onClick={() => App.openTaskCreate(date)}>+ 업무 생성</Btn> : null}
        {isLead ? <Btn variant="secondary" full onClick={() => App.openEventCreate('team', date)}>+ 팀 일정</Btn> : null}
        <Btn variant="secondary" full onClick={() => App.openEventCreate('personal', date)}>+ 개인일정</Btn>
      </div>
    </Shell>
  );
}

// ── 상담 전송: 주제 + 내용 작성 후 동기화(통통통 전송) ──
function CounselSendModal({ m }: { m: any }) {
  const { App } = useApp();
  const [subject, setSubject] = useState(m.subject || '상담');
  const [content, setContent] = useState(m.content || '');
  const sending = App.ui.counselWriting === m.entryId;
  // 1회성 제출 — 전송 중 재클릭은 무시(App.sendCounsel의 inflight 가드와 이중 방어). 전송 중엔 취소·X·오버레이 닫기도 잠근다.
  const submit = () => { if (sending) return; App.sendCounsel(m.taskId, m.entryId, subject, content); };
  // 상담 현황에서 진입(returnModal)했으면 취소/닫기는 같은 업무·강사의 현황으로 복귀한다. 직접 연 경우는 기존대로 전체 닫기.
  const close = () => { if (sending) return; if (m.returnModal) App.openModal(m.returnModal); else App.closeModal(); };
  const foot = (<>
    <Btn variant="secondary" full disabled={sending} onClick={close}>취소</Btn>
    <Btn variant="primary" full loading={sending} loadingLabel="전송 중..." onClick={submit}>동기화(통통통 전송)</Btn>
  </>);
  return (
    <Shell title={`${m.student} 상담 작성`} foot={foot} onClose={close}>
      <div className="muted-box" style={{ gridTemplateColumns: 'auto 1fr', marginBottom: 12 }}>
        <span className="muted">학생</span><span style={{ fontWeight: 600 }}>{m.student}</span>
        <span className="muted">어머니 전화</span><span style={{ fontWeight: 600 }}>{m.phone || '—'}</span>
      </div>
      <Field label="상담 주제" value={subject} onInput={setSubject} placeholder="예: 7월 정기상담" />
      <div className="field">
        <label>상담 내용</label>
        <textarea className="ta" rows={5} placeholder="학부모께 전달할 상담 내용을 작성해 주세요." value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      <p className="cap" style={{ marginTop: 2 }}>동기화를 누르면 통통통 상담자료에 <b>비공개</b>로 그대로 전송됩니다. 전송 결과가 불확실할 때는 재전송하지 않고 「전송 결과 확인」으로 저장 여부만 확인합니다.</p>
    </Shell>
  );
}

// ── 학생 상담 상세: 선택한 강사의 학생별 상담 전송·부재/문자 현황 (팀장 읽기 전용 / 강사 작성·전송) ──
function CounselStatusModal({ m }: { m: any }) {
  const { App } = useApp();
  const S = App.state, u = App.ui;
  const taskId = m.taskId;
  const t = S.tasks.find((x: any) => x.id === taskId);
  const isLead = u.role === 'lead';
  // 업무 상세·일일보고에서 진입(m.returnModal)했으면 닫기/뒤로가 그 모달로 복귀한다. 직접 연 경우는 전체 닫기.
  const back = () => { if (m.returnModal) App.openModal(m.returnModal); else App.closeModal(); };
  // 팀장은 m.teacher(일일보고에서 진입) 또는 첫 담당자부터 확인하고, 강사는 본인으로 고정된다.
  const [pick, setPick] = useState<string>(() => (isLead ? (m.teacher || (t?.assignees || [])[0] || '') : S.me.name));
  const teacher = isLead ? pick : S.me.name;
  const [clsPick, setClsPick] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // 로딩/오류·요청 최신성은 App.loadCounselEntries가 전역 요청 토큰(counselRequestByTask)으로만 관리한다
  // (강사 전환 시 이전 학생 정보 즉시 삭제 포함). 모달 인스턴스가 로딩/오류를 따로 기록하면 닫힌 인스턴스의
  // 늦은 응답이 새 인스턴스 상태를 덮어쓸 수 있어 위임만 하고, 거부는 meta.error에 이미 반영돼 있어 흡수한다.
  const load = (name: string) => { App.loadCounselEntries(taskId, name, { throwOnError: true }).catch(() => { /* noop */ }); };
  // 편집 모달(전송/부재)에서 복귀(reuseCache)한 경우 같은 업무·강사의 완료된 캐시가 이미 최신이므로
  // 자동 재조회를 건너뛴다. 업무/일일보고에서의 첫 진입, 강사 전환, 「다시 불러오기」는 그대로 조회한다.
  useEffect(() => {
    if (!teacher) return;
    const cached = App.counselMetaByTask[taskId] || {};
    if (m.reuseCache && cached.teacher === teacher && cached.loading === false && !cached.error) return;
    load(teacher);
    /* eslint-disable-next-line */
  }, [taskId, teacher]);
  if (!t) return <Shell title="학생 상담 상세" onClose={back}><p>업무를 찾을 수 없습니다.</p></Shell>;

  const special = !!t.specialCounsel;
  const meta = App.counselMetaByTask[taskId] || {};
  const loading = meta.loading !== false; // 최초 로드 전(undefined)도 로딩으로 취급
  const error: string = meta.error || '';
  const entriesAll = (App.counselByTask[taskId] || []).filter((e: any) => !e.teacher || e.teacher === teacher);
  const classes: string[] = Array.from(new Set<string>([
    ...((Array.isArray(meta.classes) ? meta.classes : []) as string[]),
    ...entriesAll.map((e: any) => String(e.cls || '')),
  ].filter(Boolean)));
  const cur = classes.includes(clsPick) ? clsPick : ''; // 강사 전환으로 사라진 반 선택은 '전체'로 복귀
  const entries = cur ? entriesAll.filter((e: any) => e.cls === cur) : entriesAll;
  const prog = t.counselProg?.[teacher] || { synced: entriesAll.filter((e: any) => e.synced).length, total: entriesAll.length };
  const teacherOptions: string[] = Array.from(new Set<string>([...(t.assignees || []), ...(teacher ? [teacher] : [])]));
  const sp = u.counselSyncProgress && u.counselSyncProgress.taskId === taskId ? u.counselSyncProgress : null;
  // 명단 확인(preparing)과 반별 새로고침(running) 두 단계 모두 버튼을 로딩 상태로 잠근다.
  const syncingAll = !!(sp && (sp.status === 'preparing' || sp.status === 'running'));
  const noPhoneCount = entries.filter((e: any) => !(e.phone || '').trim()).length;
  // 특강상담 대상 없음 — 이번 달 현재 월 명단에 대상 학생이 없는 상태. 강사에게는 전체 동기화 버튼을 계속 노출해 재확인할 수 있게 한다.
  const noTarget = special && !!prog.noTarget;
  // 반별 연락처 경고(동기화 자체는 성공했지만 일부 조회 실패) — 하드 실패(sp.failures)·'모 번호 없음' 배지와는 별개다.
  // 반 필터 중엔 그 반만, 전체 보기에선 모든 반을 반 이름을 붙여 보여준다.
  const warningsByClass: Record<string, string[]> = meta.warningsByClass || {};
  const contactWarnings = (cur ? [cur] : classes).flatMap((c) => (warningsByClass[c] || []).map((w: string) => `${c}: ${w}`));
  const warnedClassCount = classes.filter((c) => (warningsByClass[c] || []).length > 0).length;
  // 마지막 prepare가 남긴 추가/수정/비활성/복원 요약(있을 때만). 정기·특강 모두 노출한다.
  const reconcileText = counselReconcileSummary(meta.reconcile);
  // 이번 세션에서 prepare가 성공했는지 — 재조정 수치는 성공한 전체 동기화에서만 심긴다. loadCounselEntries는 심지 않는다.
  // '한 번도 동기화 안 함'과 '동기화했는데 이번 달 대상 0명'을 구분하는 신호다.
  const rosterSynced = !!meta.reconcile;
  // 현재 월 명단 기준 대상 0명 상태: 특강 noTarget이거나, 방금 동기화한 정기/특강 로스터가 비어 있는 경우.
  // 정기 상담은 noTarget 플래그가 없으므로 rosterSynced로 '동기화 완료·대상 없음'을 구분해 같은 현재-월 안내를 준다.
  const emptyCurrentRoster = !entriesAll.length && (noTarget || rosterSynced);
  // 편집 모달에서 취소/닫기·전송 완료 시 이 상세(같은 업무·강사)로 복귀하기 위한 페이로드.
  // reuseCache — 전송 성공 응답은 이미 로컬 항목에 반영돼 있으므로 복귀 시 자동 재조회 없이 캐시를 그대로 쓴다.
  const returnModal = { type: 'counselStatus', taskId, teacher, reuseCache: true };
  // 바깥 returnModal을 그대로 이어받아, 편집 → 이 상세 → (닫기) → 업무 상세/일일보고 순으로 돌아갈 수 있게 한다.
  if (m.returnModal) (returnModal as any).returnModal = m.returnModal;

  const attemptDateLabel = (a: any) => {
    const d = String(a.attemptedDate || a.date || '');
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? koDate(d) : (d || '—');
  };

  // 수동 종결 가능 조건: ERP POST 경계를 넘긴(posting) 전송이 2분 넘게 확정되지 않은 경우.
  // 갓 시작한 전송은 자동 확인으로 끝나는 경우가 대부분이라 성급한 판단을 유도하지 않는다.
  const MANUAL_RESOLVE_AFTER_MS = 120000;
  const manualResolvable = (e: any) => {
    if (!e?.deliveryPending) return false;
    const stage = String(e.delivery?.stage || '');
    if (stage && stage !== 'posting') return false;
    const attemptedAt = Date.parse(String(e.delivery?.attemptedAt || ''));
    return Number.isFinite(attemptedAt) ? Date.now() - attemptedAt >= MANUAL_RESOLVE_AFTER_MS : true;
  };

  const table = (
    <div className="tbl-scroll">
      <table className="tbl">
        <thead><tr>
          <th style={{ width: 90 }}>학생</th><th style={{ width: 130 }}>어머니 전화</th><th>상담 전송 (통통통)</th><th>부재/문자</th><th style={{ width: 110 }}>이력</th>
        </tr></thead>
        <tbody>
          {entries.map((e: any) => {
            const atts = e.absenceAttempts || [];
            const open = !!expanded[e.id];
            return (
              <React.Fragment key={e.id}>
                <tr>
                  <td style={{ fontWeight: 600 }}>{e.student}</td>
                  <td style={{ fontSize: 12.5 }}>{e.phone ? <span className="muted">{e.phone}</span> : <span style={{ color: 'var(--destructive)' }} title="통통통 원부에 어머니(HP모) 번호가 없습니다">없음</span>}</td>
                  <td>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      {e.deliveryPending ? (
                        <>
                          {!isLead ? <Btn variant="secondary" size="sm" loading={u.counselReconciling === e.id} loadingLabel="확인 중..." onClick={() => App.reconcileCounsel(taskId, e.id)}>전송 결과 확인</Btn> : null}
                          <Badge tone="warning" title={e.deliveryMessage || '통통통 전송 결과를 확인하는 중입니다.'}>{isLead ? '확인 대기' : '재전송 금지'}</Badge>
                          {/* 자동 확인으로는 저장 실패와 조회 실패를 구분할 수 없다. 통통통을 직접 확인한 강사만 종결할 수 있게 한다. */}
                          {!isLead && manualResolvable(e) ? (
                            <>
                              <Btn variant="secondary" size="sm" loading={u.counselResolving === e.id} loadingLabel="처리 중..."
                                onClick={() => App.resolveCounselDelivery(taskId, e.id, 'not-sent')}>통통통에 없음 · 재전송 허용</Btn>
                              <Btn variant="ghost" size="sm" disabled={u.counselResolving === e.id}
                                onClick={() => App.resolveCounselDelivery(taskId, e.id, 'sent')}>통통통에 있음 · 전송 완료</Btn>
                            </>
                          ) : null}
                          {e.deliveryMessage ? (
                            <div className="muted" style={{ width: '100%', fontSize: 12, lineHeight: 1.5, wordBreak: 'break-word' }}>{e.deliveryMessage}</div>
                          ) : null}
                        </>
                      ) : (
                        <>
                          {!isLead ? <Btn variant={e.synced ? 'subtle' : 'primary'} size="sm" disabled={u.counselWriting === e.id} onClick={() => App.openCounselSend(taskId, e.id, returnModal)}>{e.synced ? '수정·재전송' : '상담 작성·전송'}</Btn> : null}
                          {e.synced ? <Badge tone="success" icon="✓">전송 완료</Badge> : <Badge tone="neutral" title={e.deliveryMessage || undefined}>미전송</Badge>}
                        </>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{`부재 ${e.absenceCount || 0}회`}</span>
                      {e.absencePendingCount ? <Badge tone="warning">{`확인 대기 ${e.absencePendingCount}`}</Badge> : null}
                      {!isLead ? <Btn variant="secondary" size="sm" disabled={u.counselAbsenceWriting === e.id} onClick={() => App.openCounselAbsence(taskId, e.id, returnModal)}>부재/문자 기록</Btn> : null}
                    </div>
                  </td>
                  <td>
                    <button className="btn ghost sm" aria-expanded={open} aria-controls={'absence-hist-' + e.id} disabled={!atts.length}
                      onClick={() => setExpanded((x) => ({ ...x, [e.id]: !x[e.id] }))}>
                      {atts.length ? `이력 ${atts.length}건 ${open ? '접기' : '펼치기'}` : '이력 없음'}
                    </button>
                  </td>
                </tr>
                {open && atts.length ? (
                  <tr id={'absence-hist-' + e.id}>
                    <td colSpan={5} style={{ background: 'var(--muted)' }}>
                      <div className="col" style={{ gap: 8 }}>
                        {atts.map((a: any) => (
                          <div className="row" style={{ gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }} key={a.id}>
                            <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{attemptDateLabel(a)}</span>
                            {a.deliveryConfirmed ? <Badge tone="success" icon="✓">전송 확인</Badge> : <Badge tone="warning" title={a.deliveryMessage || undefined}>확인 대기</Badge>}
                            <span style={{ flex: 1, minWidth: 160, fontSize: 12.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{a.content}</span>
                            {!isLead && a.deliveryPending ? (
                              <Btn variant="secondary" size="sm" loading={u.counselAbsenceReconciling === a.id} loadingLabel="확인 중..." onClick={() => App.reconcileCounselAbsence(taskId, a.id)}>전송 결과 확인</Btn>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const foot = <Btn variant="secondary" full onClick={back}>{m.returnModal ? (m.returnModal.type === 'task' ? '‹ 업무 상세로 돌아가기' : '‹ 돌아가기') : '닫기'}</Btn>;
  return (
    <Shell title={`${teacher ? teacher + ' · ' : ''}학생 상담 상세`} foot={foot} onClose={back}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {special ? <Badge tone="brand" icon="✦">특강상담</Badge> : <Badge tone="brand">전체 상담</Badge>}
        <Badge tone={counselComplete(prog, special) ? 'success' : 'neutral'}>{counselCountLabel(prog, special)}</Badge>
        {meta.sourceMonth ? <span className="muted" style={{ fontSize: 12 }}>{`${special ? '특강 수강년월' : '기준 월'} ${meta.sourceMonth}`}</span> : null}
        {reconcileText ? <span className="muted" style={{ fontSize: 12 }}>{`명단 반영 · ${reconcileText}`}</span> : null}
        <span className="grow" />
        <span className="muted" style={{ fontSize: 12 }}>{`업무: ${t.title}`}</span>
      </div>
      {isLead ? (
        <>
          <Alert tone="info">팀장은 읽기 전용으로 확인합니다 — 로스터 동기화·상담 작성·전송 결과 확인은 강사 본인 화면에서 진행됩니다.</Alert>
          <div className="col" style={{ gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>강사 선택 <span className="muted" style={{ fontWeight: 400 }}>— 선택한 강사의 학생 상담 상세를 불러옵니다</span></span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {teacherOptions.map((n) => (
                <button type="button" key={n} className={'chip' + (n === teacher ? ' on' : '')} aria-pressed={n === teacher} onClick={() => { if (n !== teacher) setPick(n); }}>{n}</button>
              ))}
            </div>
          </div>
        </>
      ) : (
        // 강사는 '대상 없음'(noTarget) 특강을 포함해 항상 전체 동기화 버튼을 볼 수 있다 — 현재 월 명단으로 언제든 재확인.
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <Btn variant="secondary" size="sm" loading={syncingAll} loadingLabel="동기화 중..." disabled={loading} onClick={() => App.syncAllCounselRosters(taskId)}>학생 로스터 전체 동기화</Btn>
          <span className="muted" style={{ fontSize: 12 }}>현재 월 학생 명단을 확인한 뒤 담당 반 어머니 전화를 순서대로 새로고침합니다.</span>
        </div>
      )}
      {sp ? (
        <div className="col" style={{ gap: 6 }} aria-live="polite">
          {sp.status === 'preparing' ? (
            // 1단계: 현재 월 학생 명단 확인 — 가짜 경과시간 진행률 없이 상태 문구만. 버튼 스피너가 진행을 알린다.
            <span className="muted" style={{ fontSize: 12 }}>① 현재 월 학생 명단을 확인하는 중…</span>
          ) : sp.status === 'failed' ? (
            <Alert tone="warning">{`학생 명단 확인 실패 — ${sp.message || '잠시 후 다시 시도해 주세요.'} 기존 로스터는 그대로 유지됩니다.`}</Alert>
          ) : sp.total === 0 ? (
            // prepare는 성공했지만 이번 달 대상이 0명/0반 — 오류가 아니라 이미 최신(100%)이다.
            <span className="muted" style={{ fontSize: 12 }}>{`동기화 완료 — 이번 달 상담 대상 학생이 없어 로스터가 최신입니다.${reconcileText ? ` (${reconcileText})` : ''}`}</span>
          ) : (
            // 2단계: 반별 어머니 전화 새로고침 — 실제 완료/전체 반 수와 퍼센트로만 진행률을 표시한다.
            <>
              <div className="row" style={{ gap: 10 }}>
                <div className="bar" role="progressbar" aria-label="반별 어머니 전화 새로고침 진행률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={sp.percent || 0} aria-valuetext={`${sp.completed}/${sp.total}개 반 (${sp.percent || 0}%)`}>
                  <i style={{ width: (sp.percent || 0) + '%' }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>{`${sp.completed}/${sp.total}개 반`}</span>
              </div>
              <span className="muted" style={{ fontSize: 12 }}>
                {sp.status === 'running'
                  ? (sp.currentClass ? `② 어머니 전화 새로고침 중 — ${sp.currentClass}` : '② 어머니 전화 새로고침 중…')
                  : sp.status === 'partial' ? `동기화 종료 — 실패 ${(sp.failures || []).length}개 반`
                  : warnedClassCount ? `동기화 완료 — 연락처 경고 ${warnedClassCount}개 반`
                  : '동기화 완료'}
              </span>
            </>
          )}
          {(sp.failures || []).length ? <Alert tone="warning">{'반 동기화 실패 — ' + (sp.failures || []).map((f: any) => `${f.cls}: ${f.message}`).join(' · ')}</Alert> : null}
        </div>
      ) : null}
      {!teacher ? (
        <Alert tone="warning">담당 강사가 없습니다 — 업무에 강사를 배정한 뒤 확인해 주세요.</Alert>
      ) : loading ? (
        <div className="dashed-box">학생 상담 상세를 불러오는 중…</div>
      ) : error ? (
        <>
          <Alert tone="warning">{error}</Alert>
          <Btn variant="secondary" onClick={() => load(teacher)}>다시 불러오기</Btn>
        </>
      ) : emptyCurrentRoster ? (
        // 현재 월 명단 기준 대상 0명(정기·특강 공통) — 생성 시점 고정과 무관하며 언제든 다시 동기화할 수 있다.
        // '대상 없음'(완료) 집계 안내는 특강 상담에만 적용되므로 그때만 덧붙인다.
        <div className="dashed-box">{isLead
          ? `이번 달 상담 대상 학생이 없습니다 — 강사가 「학생 로스터 전체 동기화」로 현재 월 명단을 다시 확인하면 대상이 나타날 수 있습니다.${special ? ' 현재는 ‘대상 없음’(완료)으로 집계됩니다.' : ''}`
          : `이번 달 상담 대상 학생이 없습니다 — 「학생 로스터 전체 동기화」로 언제든 현재 월 명단을 다시 확인할 수 있습니다.${special ? ' 현재는 ‘대상 없음’(완료)으로 집계됩니다.' : ''}`}</div>
      ) : !entriesAll.length ? (
        // 아직 한 번도 동기화하지 않은 로스터 — 통통통에서 처음 불러오도록 안내한다.
        <div className="dashed-box">{isLead ? '동기화된 학생 로스터가 없습니다 — 강사가 로스터를 동기화하면 표시됩니다.' : '학생 로스터가 없습니다 — 「학생 로스터 전체 동기화」를 눌러 통통통에서 불러오세요.'}</div>
      ) : (
        <>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button type="button" className={'chip' + (cur === '' ? ' on' : '')} aria-pressed={cur === ''} onClick={() => setClsPick('')}>전체</button>
            {classes.map((c) => <button type="button" key={c} className={'chip' + (c === cur ? ' on' : '')} aria-pressed={c === cur} onClick={() => setClsPick(c)}>{c}</button>)}
          </div>
          <div className="row">
            <span className="muted" style={{ fontSize: 12 }}>{`${teacher} · ${cur || '전체'} · ${entries.length}명 · 전송 ${entries.filter((e: any) => e.synced).length}/${entries.length} · 부재 ${entries.reduce((s: number, e: any) => s + Number(e.absenceCount || 0), 0)}회`}</span>
            {noPhoneCount ? <Badge tone="destructive">{`모 번호 없음 ${noPhoneCount}명`}</Badge> : null}
          </div>
          {contactWarnings.length ? <Alert tone="warning">{'연락처 경고 — ' + contactWarnings.join(' · ')}</Alert> : null}
          {table}
        </>
      )}
    </Shell>
  );
}

// ── 부재/문자 기록: 통화 부재·문자 안내 내용을 통통통에 전송 ──
function CounselAbsenceModal({ m }: { m: any }) {
  const { App } = useApp();
  const [content, setContent] = useState(m.content || '');
  const [submitting, setSubmitting] = useState(false);
  // 모달 인스턴스당 고정 requestId — 실패 후 재시도해도 같은 키로 전송(멱등)된다.
  const requestIdRef = useRef<string>(m.requestId || '');
  if (!requestIdRef.current) requestIdRef.current = 'absence-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const sending = submitting || App.ui.counselAbsenceWriting === m.entryId;
  // 성공 시 닫기는 App.sendCounselAbsence가 처리한다(여기서 closeModal 호출 금지).
  // 실패/미전송이면 모달과 내용·requestId를 유지해 같은 키로 재시도할 수 있게 한다.
  const submit = async () => {
    if (sending) return; // 더블클릭 차단(버튼 disabled와 이중 방어)
    if (!content.trim()) { toast('부재/문자 내용을 입력해 주세요.'); return; }
    setSubmitting(true);
    try { await App.sendCounselAbsence(m.taskId, m.entryId, content, requestIdRef.current); }
    finally { setSubmitting(false); }
  };
  // 상담 현황에서 진입(returnModal)했으면 취소/닫기는 같은 업무·강사의 현황으로 복귀한다. 직접 연 경우는 기존대로 전체 닫기.
  // Escape도 같은 close를 타므로 전송 중(sending)에는 닫히지 않는다.
  const close = () => { if (sending) return; if (m.returnModal) App.openModal(m.returnModal); else App.closeModal(); };
  const titleId = useId();
  const contentId = useId();
  const dialogRef = useDialogA11y(close);
  return (
    <div>
      <div className="overlay" onClick={close} />
      <div className="modal-wrap">
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={dialogRef}>
          <div className="modal-hd">
            <h2 id={titleId}>{`${m.student} 부재/문자 기록`}</h2>
            <Badge tone="warning">부재/문자</Badge>
            <button className="x-btn" aria-label="닫기" disabled={sending} onClick={close}>✕</button>
          </div>
          <div className="modal-bd">
            <div className="muted-box" style={{ gridTemplateColumns: 'auto 1fr', marginBottom: 12 }}>
              <span className="muted">학생</span><span style={{ fontWeight: 600 }}>{m.student}</span>
              <span className="muted">어머니 전화</span><span style={{ fontWeight: 600 }}>{m.phone || '—'}</span>
            </div>
            <div className="field">
              <label htmlFor={contentId}>부재/문자 내용<span className="req">*</span></label>
              <textarea id={contentId} className="ta" rows={5} required placeholder="예: 통화 부재로 문자 안내드렸습니다." value={content} onChange={(e) => setContent(e.target.value)} />
            </div>
            <p className="cap" style={{ marginTop: 2 }}>전송하면 통통통 상담자료에 <b>부재/문자</b> 기록으로 남습니다. 전송 결과가 불확실할 때는 재전송하지 않고 이력의 「전송 결과 확인」으로 저장 여부만 확인합니다.</p>
          </div>
          <div className="modal-ft">
            <Btn variant="secondary" full disabled={sending} onClick={close}>취소</Btn>
            <Btn variant="primary" full loading={sending} loadingLabel="전송 중..." onClick={submit}>부재/문자 전송</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}
