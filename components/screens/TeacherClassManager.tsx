import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/lib/state';
import { api } from '@/lib/api';
import { Alert, Badge, Btn, Card, Field } from '@/components/ui';
import { PageTitle } from '@/components/screens/shared';
import { toast } from '@/lib/helpers';
import { counselRecency } from '@/lib/counsel-recency';

function formatSyncedAt(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function dayLabel(cls: any) {
  if (cls.dayGroup === 'M') return '월수금';
  if (cls.dayGroup === 'T') return '화목토';
  return '기타 요일';
}

function categoryLabel(cls: any) {
  return [cls.topName, cls.middleName].filter(Boolean).join(' · ') || '분류 없음';
}

export function TeacherClassManager({
  teacherTid,
  teacherName,
  embedded = false,
}: {
  teacherTid?: string;
  teacherName?: string;
  embedded?: boolean;
}) {
  const { App } = useApp();
  const targetTid = teacherTid || App.ui.tid;
  const ownScreen = !teacherTid || teacherTid === App.ui.tid;
  const [targetDate, setTargetDate] = useState(App.state.today);
  const [roster, setRoster] = useState<any>(null);
  const [catalog, setCatalog] = useState<any>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeCode, setActiveCode] = useState('');
  const [query, setQuery] = useState('');
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [studentDetails, setStudentDetails] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [detailsRefresh, setDetailsRefresh] = useState(0);
  const forceDetailsRefresh = useRef(false);
  const requestVersion = useRef(0);
  const detailsCache = useRef(new Map<string, { expiresAt: number; value: any }>());

  useEffect(() => {
    let cancelled = false;
    requestVersion.current += 1;
    detailsCache.current.clear();
    forceDetailsRefresh.current = false;
    setRoster(null);
    setCatalog(null);
    setSelected(new Set());
    setActiveCode('');
    setQuery('');
    setLoadingRoster(true);
    setLoadingCatalog(false);
    setApplying(false);
    setError('');
    void api.get(`/api/class-management?teacherTid=${encodeURIComponent(targetTid)}`)
      .then((result) => {
        if (cancelled) return;
        setRoster(result);
        if (ownScreen) App.otherTeamRoster = result;
        setActiveCode(String(result.classes?.[0]?.classCode || ''));
      })
      .catch((cause: any) => {
        if (!cancelled) setError(cause?.message || '저장된 반 현황을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!cancelled) setLoadingRoster(false);
      });
    return () => { cancelled = true; };
  }, [App, ownScreen, targetTid]);

  const loadCatalog = async (forceRefresh = false) => {
    const version = requestVersion.current;
    setLoadingCatalog(true);
    setError('');
    try {
      const result = await api.post('/api/class-management/catalog', { teacherTid: targetTid, targetDate, forceRefresh });
      if (version !== requestVersion.current) return;
      setCatalog(result);
      setSelected(new Set(result.selectedClassCodes || []));
    } catch (cause: any) {
      if (version === requestVersion.current) setError(cause?.message || '통통통 반 목록을 불러오지 못했습니다.');
    } finally {
      if (version === requestVersion.current) setLoadingCatalog(false);
    }
  };

  const toggleClass = (classCode: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(classCode)) next.delete(classCode);
      else next.add(classCode);
      return next;
    });
  };

  const applySelection = async () => {
    const version = requestVersion.current;
    if (!catalog || selected.size === 0) {
      setError('적용할 반을 한 개 이상 선택해 주세요.');
      return;
    }
    const existing = new Set<string>((roster?.classes || []).map((cls: any) => String(cls.classCode)));
    const removedCount = [...existing].filter((code) => !selected.has(code)).length;
    if (removedCount > 0 && typeof window !== 'undefined' && !window.confirm(
      `${removedCount}개 기존 반이 선택에서 빠집니다. 현재 선택으로 적용할까요?`,
    )) return;

    setApplying(true);
    setError('');
    try {
      const result = await api.post('/api/class-management/apply', {
        teacherTid: targetTid,
        targetDate,
        catalogFingerprint: catalog.catalogFingerprint,
        catalogProof: catalog.catalogProof,
        selectionRevision: catalog.selectionRevision,
        selectedClassCodes: [...selected],
      });
      if (version !== requestVersion.current) return;
      detailsCache.current.clear();
      setRoster(result);
      setCatalog(null);
      setSelected(new Set());
      setActiveCode(String(result.classes?.[0]?.classCode || ''));
      if (ownScreen) {
        App.otherTeamRoster = result;
        App.ui.otherNotebook = { nbByClass: {}, nbSync: 'idle' };
      }
      toast(`${result.classCount || 0}개 반 · ${result.studentCount || 0}명으로 반 현황을 적용했습니다.`);
      void App.reload().catch(() => toast('반 선택은 저장됐습니다. 화면 새로고침이 필요합니다.'));
    } catch (cause: any) {
      if (version === requestVersion.current) setError(cause?.message || '반 선택을 적용하지 못했습니다.');
    } finally {
      if (version === requestVersion.current) setApplying(false);
    }
  };

  const candidates = catalog?.classes || [];
  const filteredCandidates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ko');
    if (!needle) return candidates;
    return candidates.filter((cls: any) => (
      `${cls.className} ${cls.topName} ${cls.middleName}`.toLocaleLowerCase('ko').includes(needle)
    ));
  }, [catalog, query]);
  const savedClasses = roster?.classes || [];
  const activeClass = savedClasses.find((cls: any) => cls.classCode === activeCode);
  const detailsKey = JSON.stringify([targetTid, roster?.selectionRevision, activeCode, App.state.today]);

  useEffect(() => {
    let cancelled = false;
    setStudentDetails(null);
    setDetailsError('');
    if (!activeCode || !roster?.selectionRevision) { setDetailsLoading(false); return; }
    const cached = detailsCache.current.get(detailsKey);
    if (cached && cached.expiresAt > Date.now()) {
      setStudentDetails(cached.value);
      setDetailsLoading(false);
      return;
    }
    setDetailsLoading(true);
    const params = new URLSearchParams({
      teacherTid: targetTid, classCode: activeCode, selectionRevision: roster.selectionRevision,
      forceRefresh: forceDetailsRefresh.current ? '1' : '0',
    });
    forceDetailsRefresh.current = false;
    void api.get(`/api/class-management/student-details?${params}`)
      .then((result) => {
        if (cancelled) return;
        setStudentDetails(result);
        detailsCache.current.set(detailsKey, { expiresAt: Date.now() + 60_000, value: result });
      })
      .catch((cause: any) => { if (!cancelled) setDetailsError(cause?.message || '연락처와 상담 기록을 확인하지 못했습니다.'); })
      .finally(() => { if (!cancelled) setDetailsLoading(false); });
    return () => { cancelled = true; };
  }, [detailsKey, detailsRefresh]);
  const detailsByCode = useMemo(() => new Map<string, any>(
    (studentDetails?.students || []).map((student: any) => [student.scode, student]),
  ), [studentDetails]);

  const controls = (
    <div className="row class-manager-controls">
      <div className="page-hd-date">
        <Field label="수강 기준일" ariaLabel="수강 기준일" type="date" value={targetDate} onInput={setTargetDate} />
      </div>
      <Btn
        variant="primary"
        loading={loadingCatalog}
        loadingLabel="통통통 조회 중..."
        disabled={applying}
        onClick={() => loadCatalog()}
      >↻ 통통통 반 불러오기</Btn>
      {catalog ? <Btn size="sm" variant="ghost" disabled={loadingCatalog || applying} onClick={() => loadCatalog(true)}>최신 목록 다시 조회</Btn> : null}
    </div>
  );

  const content = (
    <div className={`class-manager${embedded ? ' embedded' : ''}`}>
      {embedded ? (
        <div className="class-manager-heading">
          <div>
            <h3>반 현황 관리</h3>
            <p>{`${teacherName || targetTid} 강사의 통통통 담당 반에서 사용할 반을 직접 선택합니다.`}</p>
          </div>
          {controls}
        </div>
      ) : null}

      <Alert tone="info">
        통통통에서 주담임으로 확인되는 모든 반을 반명·분류와 관계없이 가져옵니다. 목록을 불러오는 것만으로는 저장값이 바뀌지 않으며, 선택 후 「선택한 반 적용」을 눌러야 반 현황에 반영됩니다. 특강 분류 반은 선택해도 특강기간인 날의 일일보고와 특강 상담에만 합쳐집니다.
      </Alert>
      <div className="class-manager-status" role="status" aria-live="polite">
        {error ? <Alert tone="warning">{`${error} · 저장된 반 선택은 변경되지 않았습니다.`}</Alert> : null}
      </div>

      {catalog ? (
        <Card
          className="class-cart"
          title={<span className="row"><span>통통통 반 목록</span><Badge tone="neutral">{`${catalog.sourceMonth} · ${candidates.length}개`}</Badge></span>}
          action={<Btn variant="primary" size="sm" loading={applying} loadingLabel="선택한 반 확인 중..." disabled={selected.size === 0 || loadingCatalog} onClick={applySelection}>{`선택한 반 적용 · ${selected.size}개`}</Btn>}
        >
          <div className="class-cart-toolbar">
            <Field ariaLabel="반 이름 또는 분류 검색" placeholder="반 이름 또는 분류 검색" value={query} onInput={setQuery} />
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <Btn variant="ghost" size="sm" disabled={applying} onClick={() => setSelected(new Set(candidates.map((cls: any) => cls.classCode)))}>전체 선택</Btn>
              <Btn variant="ghost" size="sm" disabled={applying} onClick={() => setSelected(new Set())}>선택 해제</Btn>
            </div>
          </div>
          {selected.size === 0 ? <p className="class-cart-selection-note">적용할 반을 한 개 이상 선택해 주세요.</p> : null}
          <div className="class-cart-grid" aria-busy={applying}>
            {filteredCandidates.map((cls: any) => {
              const checked = selected.has(cls.classCode);
              return (
                <label key={cls.classCode} className={`class-cart-item${checked ? ' selected' : ''}`}>
                  <input type="checkbox" checked={checked} disabled={applying} onChange={() => toggleClass(cls.classCode)} />
                  <span className="class-cart-copy">
                    <strong title={cls.className}>{cls.className}</strong>
                    <span title={categoryLabel(cls)}>{categoryLabel(cls)}</span>
                  </span>
                  <span className="class-cart-meta">
                    <Badge tone={cls.topName === '특강' ? 'brand' : 'neutral'}>{dayLabel(cls)}</Badge>
                    <span>{`${cls.studentCount || 0}명`}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {!filteredCandidates.length ? (
            <div className="dashed-box">
              {candidates.length ? '검색 조건에 맞는 반이 없습니다.' : '이 강사의 통통통 담당 반이 없습니다. 수강 기준일을 확인해 주세요.'}
            </div>
          ) : null}
        </Card>
      ) : null}

      <div className="class-roster-summary" aria-busy={loadingRoster} aria-live="polite">
        {loadingRoster && !roster ? <div className="dashed-box">저장된 반 현황을 불러오는 중…</div> : !roster?.sourceMonth ? (
          <div className="dashed-box">아직 저장된 반이 없습니다. 통통통 반을 불러온 뒤 사용할 반을 선택해 주세요.</div>
        ) : (
          <>
            <div className="muted-box class-manager-stats">
              <span className="muted">적용 수강년월</span>
              <strong>{roster.sourceMonth}</strong>
              <span className="muted">현재 반 현황</span>
              <strong>{`${roster.classCount || 0}개 반 · 학생 ${roster.studentCount || 0}명`}</strong>
              <span className="muted">마지막 적용</span>
              <strong>{formatSyncedAt(roster.syncedAt) || '기록 없음'}</strong>
            </div>
            {(roster.warnings || []).map((warning: string, index: number) => (
              <div key={index} style={{ marginTop: 10 }}><Alert tone="warning">{warning}</Alert></div>
            ))}
            <div className="feature-grid cols-map class-roster-grid">
              <Card flush title="선택한 반" action={<Badge tone="neutral">{`${savedClasses.length}개`}</Badge>}>
                {savedClasses.map((cls: any) => {
                  const active = cls.classCode === activeCode;
                  const select = () => setActiveCode(cls.classCode);
                  return (
                    <button key={cls.classCode} type="button" className={`lrow class-roster-row${active ? ' sel' : ''}`} aria-pressed={active} onClick={select}>
                      <span className="row">
                        <span className="class-roster-name" title={cls.className}>{cls.className}</span>
                        {cls.topName ? <Badge tone={cls.topName === '특강' ? 'brand' : 'neutral'}>{cls.topName}</Badge> : null}
                        <span className="grow" />
                        <span className="muted">{`${dayLabel(cls)} · ${cls.students?.length || 0}명`}</span>
                      </span>
                    </button>
                  );
                })}
              </Card>
              {activeClass ? (
                <Card title={<span className="ellipsis" title={activeClass.className}>{activeClass.className}</span>} action={<Badge tone="neutral">{`${activeClass.students?.length || 0}명`}</Badge>}>
                  {activeClass.students?.length ? (
                    <div className="tbl-scroll">
                      <table className="tbl">
                        <thead><tr><th style={{ width: 56 }}>번호</th><th>이름</th><th>모번호</th><th style={{ width: 80 }}>학년</th><th>마지막 상담 D-day</th></tr></thead>
                        <tbody>{activeClass.students.map((student: any, index: number) => {
                          const detail = detailsByCode.get(student.scode);
                          const age = counselRecency(detail?.lastCounselDate, studentDetails?.today || App.state.today, detail?.counselState === 'ok' ? 'ok' : 'error');
                          return (
                            <tr key={student.scode}>
                              <td className="muted">{index + 1}</td>
                              <td style={{ fontWeight: 600 }}>{student.student}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>{detailsLoading ? '조회 중…' : detail?.motherPhone || (detail?.phoneState === 'ok' ? '미등록' : '확인 필요')}</td>
                              <td>{student.grade || '—'}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <Badge tone={detailsLoading ? 'neutral' : age.tone}>{detailsLoading ? '조회 중…' : age.label}</Badge>
                                {!detailsLoading && detail?.lastCounselDate ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{detail.lastCounselDate}</div> : null}
                              </td>
                            </tr>
                          );
                        })}</tbody>
                      </table>
                    </div>
                  ) : <div className="dashed-box">현재 수강 학생이 없는 반입니다.</div>}
                  <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>부재/문자를 제외한 마지막 상담 기준 · 0~13일 초록 / 14~20일 노랑 / 21일부터 빨강 · 기록 없음은 회색</p>
                  {detailsError ? <Alert tone="warning">{detailsError}</Alert> : null}
                  {(studentDetails?.warnings || []).map((warning: string) => <Alert key={warning} tone="warning">{warning}</Alert>)}
                  <Btn size="sm" variant="ghost" disabled={detailsLoading} onClick={() => { detailsCache.current.delete(detailsKey); forceDetailsRefresh.current = true; setDetailsRefresh((value) => value + 1); }}>연락처·상담 새로고침</Btn>
                </Card>
              ) : <Card><div className="dashed-box">왼쪽에서 확인할 반을 선택해 주세요.</div></Card>}
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (embedded) return content;
  return (
    <div>
      <PageTitle title="본인 반 관리" cap="통통통 전체 담당 반에서 직접 선택" action={controls} />
      {content}
    </div>
  );
}
