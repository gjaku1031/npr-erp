import React, { useState, useRef } from 'react';
import { useApp } from '@/lib/state';
import { Btn, Card, Badge, Field, Alert, Toggle } from '@/components/ui';
import { Bubble } from '@/components/screens/shared';
import { koDate } from '@/lib/helpers';

export function LeadJournal() {
  const { App } = useApp();
  const S = App.state, u = App.ui;
  const reportTeachers = S.teachers.filter((t: any) => !t.isOtherTeam);
  const settings = S.settings || {};
  const specialOn = !!settings.specialPeriodEnabled;
  const [jDraft, setJDraft] = useState('');
  const [jNewDate, setJNewDate] = useState(specialOn && settings.specialSyncDate ? settings.specialSyncDate : S.today);
  // 체크리스트 항목 인라인 수정 — 한 번에 한 줄만 편집. savingId로 저장 중 연타·중복 저장을 막는다.
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  // 저장 완료 시점에 여전히 같은 항목을 편집 중인지 확인하는 ref — 저장 중 다른 편집 시작은 막지만,
  // 혹시 편집 대상이 바뀌었다면 완료 콜백이 새 편집 상태를 덮어쓰지 않도록 방어한다.
  const editIdRef = useRef<string | null>(null);

  if (!u.jSel) u.jSel = S.today;
  const sel = S.journals.find((j: any) => j.date === u.jSel) || S.journals[0];
  const editable = sel && sel.kind !== 'past';

  // 특강기간: 선택한 생성일이 곧 동기화 기준일. 켜져 있으면 날짜 변경도 즉시 저장한다.
  const saving = !!u.specialPeriodSaving;
  const saveError = u.specialPeriodSaveError;
  const validIso = (v: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return false;
    const d = new Date(v + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return false;
    const p = (n: number) => String(n).padStart(2, '0');
    // JS Date는 2026-02-31을 3월로 정규화하므로, 파싱 결과를 다시 직렬화해 원본과 일치할 때만 유효.
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` === v;
  };
  const dateValid = validIso(jNewDate);
  // 유효한 날짜에서만 저장/포맷한다. 빈·잘못된 날짜는 조용한 대체 저장 없이 컨트롤을 비활성화한다.
  const onDateChange = (v: string) => { setJNewDate(v); if (specialOn && validIso(v)) App.setSpecialPeriod(true, v); };
  const onToggleSpecial = (v: boolean) => { if (!dateValid) return; App.setSpecialPeriod(v, jNewDate); };
  const specialBadge = <Badge tone="brand" icon="✦">특강</Badge>;

  const listCard = (
    <Card flush title="날짜별 일일보고" action={<Badge tone="neutral">{`${S.journals.length}일`}</Badge>}>
      {S.journals.map((j: any) => {
        const reps = j.reports || {};
        const subs = reportTeachers.filter((t: any) => reps[t.name]?.submitted).length; // 다른 팀을 제외한 실제 제출 인원(날짜별)
        const tone = j.kind === 'future' ? 'info' : j.date === S.today ? 'brand' : 'success';
        const badge = j.kind === 'future' ? '예정' : j.date === S.today ? '오늘 · 진행 중' : '마감';
        const isSel = !!(sel && j.date === sel.date);
        // 저장 중에는 선택 날짜 변경을 막는다(편집 중인 항목이 사라지는 경합 방지). 레이아웃은 그대로 두고 aria로만 비활성 표시.
        const selectRow = () => { if (savingId) return; u.jSel = j.date; App.render(); };
        return (
          <div
            className={'lrow' + (isSel ? ' sel' : '')}
            key={j.date}
            role="button"
            tabIndex={0}
            aria-current={isSel ? 'true' : undefined}
            aria-disabled={savingId ? true : undefined}
            onClick={selectRow}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRow(); } }}
          >
            <div className="row">
              <span style={{ fontSize: 14, fontWeight: 600 }}>{j.label}</span>
              {j.specialPeriod ? specialBadge : null}
              <span className="grow" />
              <Badge tone={tone}>{badge}</Badge>
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>{`체크리스트 ${j.items.length}항목 · 제출 ${subs}/${reportTeachers.length}명`}</div>
          </div>
        );
      })}
    </Card>
  );

  const startEdit = (it: any) => { if (savingId) return; editIdRef.current = it.id; setEditId(it.id); setEditText(it.text || ''); }; // 원문으로 시작 · 저장 중엔 다른 행 편집 시작 금지
  const cancelEdit = () => { editIdRef.current = null; setEditId(null); setEditText(''); };
  // 저장: 기존 App.updateJournalItemText(id,text)를 호출(같은 item id 유지, Promise<boolean> 반환).
  // 성공(true)일 때만 편집기를 닫고, 실패(false)·throw 시 입력·편집 상태를 보존해 재시도할 수 있게 한다.
  const saveEdit = async (id: string) => {
    if (savingId) return;               // 저장 중 연타 방지
    const text = editText.trim();
    if (!text) return;                  // 빈값 저장 금지
    setSavingId(id);
    try {
      const ok = await App.updateJournalItemText(id, text);
      // 성공이어도 완료 시점에 여전히 같은 항목을 편집 중일 때만 종료한다(그 사이 대상이 바뀌었으면 입력 보존).
      if (ok && editIdRef.current === id) { editIdRef.current = null; setEditId(null); setEditText(''); }
      // false·throw면 editId/editText를 그대로 두어 입력을 잃지 않는다.
    } finally {
      setSavingId(null);                // 성공·실패와 무관하게 항상 해제
    }
  };

  const detailCard = (
    <Card
      flush
      title={sel ? sel.label + ' 체크리스트' : '체크리스트'}
      action={sel ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {sel.specialPeriod ? specialBadge : null}
          {sel.kind === 'future' ? <Badge tone="info">예정</Badge> : null}
          <Btn variant="ghost" size="sm" disabled={!!savingId} onClick={() => { if (savingId) return; App.deleteJournal(sel.date); }}>삭제</Btn>
        </span>
      ) : null}
    >
      {(sel ? sel.items : []).map((it: any) => {
        if (editable && editId === it.id) {
          const isSaving = savingId === it.id;
          const canSave = !isSaving && editText.trim().length > 0;
          return (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '13px 20px', borderBottom: '1px solid var(--border)' }}>
              <input
                className="inp"
                style={{ flex: 1, minWidth: 180 }}
                autoFocus
                maxLength={300}
                disabled={isSaving}
                aria-label="체크리스트 항목 수정"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;   // 한글 조합 중 Enter/Escape는 조합 확정·취소용
                  if (e.key === 'Enter') { e.preventDefault(); saveEdit(it.id); }
                  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                }}
              />
              <Btn variant="primary" size="sm" disabled={!canSave} loading={isSaving} loadingLabel="저장 중" onClick={() => saveEdit(it.id)}>저장</Btn>
              <Btn variant="ghost" size="sm" disabled={isSaving} onClick={cancelEdit}>취소</Btn>
            </div>
          );
        }
        const busy = !!savingId; // 저장 중에는 다른 항목의 토글·수정·삭제도 막는다
        return (
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 20px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{it.text}</span>
            {editable ? (
              // 보고 필수/선택 토글 — 키보드로도 조작 가능한 버튼. 저장 중에는 레이아웃은 그대로 두고 aria로만 비활성 표시.
              <span
                className={'badge ' + (it.required ? 'brand' : 'neutral')}
                role="button"
                tabIndex={0}
                aria-pressed={it.required}
                aria-disabled={busy ? true : undefined}
                aria-label={it.required ? '보고 필수 — 눌러서 보고 선택으로 변경' : '보고 선택 — 눌러서 보고 필수로 변경'}
                style={{ cursor: 'pointer' }}
                onClick={() => { if (busy) return; App.toggleJournalItemReq(it.id); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!busy) App.toggleJournalItemReq(it.id); } }}
              >{it.required ? '보고 필수' : '보고 선택'}</span>
            ) : (
              <span className={'badge ' + (it.required ? 'brand' : 'neutral')} style={{ cursor: 'default' }}>{it.required ? '보고 필수' : '보고 선택'}</span>
            )}
            {editable ? <Btn variant="ghost" size="sm" disabled={busy} onClick={() => startEdit(it)}>수정</Btn> : null}
            {editable ? <button className="x-btn" title="항목 삭제" disabled={busy} onClick={() => { if (busy) return; App.removeJournalItem(it.id); }}>✕</button> : null}
          </div>
        );
      })}
      {editable ? (
        <div style={{ display: 'flex', gap: 8, padding: '14px 20px' }}>
          <div style={{ flex: 1 }}>
            <Field placeholder="새 항목 입력 — 예: 강의실 소등·잠금 확인" value={jDraft} onInput={setJDraft} />
          </div>
          <Btn variant="secondary" onClick={() => { if (jDraft.trim()) { App.addJournalItem(sel.date, jDraft.trim()); setJDraft(''); } }}>+ 항목 추가</Btn>
        </div>
      ) : null}
    </Card>
  );

  const wtestCard = (
    <Card flush title="주간테스트 기간" action={<Badge tone="neutral">성적 연동</Badge>}>
      <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p className="cap" style={{ margin: 0 }}>강사 일일보고 4단계 출결표에 함께 표시할 주간테스트 성적의 시행일을 반 유형별로 지정합니다. (통통통 성적1관리 연동)</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Field label="M반 (월수금)" type="date" value={S.settings?.wtestM || ''} onInput={(v: string) => App.setSetting('wtest_m', v)} />
          </div>
          <div style={{ flex: 1 }}>
            <Field label="T반 (화목토)" type="date" value={S.settings?.wtestT || ''} onInput={(v: string) => App.setSetting('wtest_t', v)} />
          </div>
        </div>
      </div>
    </Card>
  );

  const subCard = (
    <Card title="제출 현황" action={sel && sel.specialPeriod ? specialBadge : null}>
      {sel && sel.kind === 'future' ? (
        <div className="dashed-box">아직 시작 전 — 해당 날짜가 되면 강사 화면에 적용됩니다.</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {reportTeachers.map((t: any) => {
            const rep = (sel?.reports || {})[t.name] || {};
            return <Bubble key={t.tid} name={t.name} submitted={!!rep.submitted} confirmed={!!rep.confirmed} date={sel ? sel.date : S.today} />;
          })}
        </div>
      )}
    </Card>
  );

  const right = (
    <div className="col" style={{ gap: 16 }}>
      {detailCard}
      {sel && sel.kind !== 'past' ? <Alert tone="info">{sel.kind === 'future' ? '해당 날짜에 강사 화면에 적용됩니다.' : '오늘 체크리스트입니다 — 수정은 즉시 강사에게 반영됩니다.'}</Alert> : null}
      {subCard}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
        <h1 className="page-title">일일보고</h1>
        <span className="grow" />
        <div className="special-switch">
          <Toggle checked={specialOn} label="특강기간" onChange={onToggleSpecial} disabled={!dateValid} />
          <span className={'special-status' + (saveError || (specialOn && !dateValid) ? ' err' : '')} aria-live={saveError ? 'assertive' : 'polite'}>
            {saving ? <><span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />저장 중…</>
              : saveError ? '저장 실패 · 특강 반·기록은 유지됩니다'
              : specialOn ? (dateValid ? `기준일 ${koDate(jNewDate)}` : '생성일을 선택해 주세요') : ''}
          </span>
        </div>
        <div style={{ width: 150 }}>
          <Field type="date" ariaLabel="일일보고 생성일" value={jNewDate} onInput={onDateChange} />
        </div>
        <Btn variant="primary" disabled={!dateValid} onClick={() => App.createJournal(jNewDate)}>+ 일일보고 생성</Btn>
      </div>
      <p className="cap" style={{ marginBottom: specialOn ? 6 : 20 }}>매일 작성하는 체크리스트를 날짜별로 생성하고 제출 현황을 확인합니다.</p>
      {specialOn ? <p className="cap" style={{ marginBottom: 20, color: 'var(--primary)' }}>특강기간이 켜져 있습니다 — 강사 현황의 반 관리에서 선택한 통통통 특강 분류 반이 해당 날짜의 일일보고와 특강 상담에 포함됩니다.</p> : null}
      <div className="feature-grid cols-journal">
        <div className="col" style={{ gap: 16 }}>
          {listCard}
          {wtestCard}
        </div>
        {right}
      </div>
    </div>
  );
}
