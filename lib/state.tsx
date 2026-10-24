import React, { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react';
import { api, onUnauthorized, setAuthCtx } from './api';
import { classesForDate, isSpecialJournal, koDate, koDateFull, toast } from './helpers';
import { runCounselRosterRefresh, pickCounselReconcile, counselReconcileSummary } from './counsel-sync';

const AppContext = createContext<any>(null);
export const useApp = () => useContext(AppContext);

// ── 다크모드 설정(브라우저 기억) ──
function readDarkPref(): boolean {
  return typeof window !== 'undefined' && localStorage.getItem('npr_dark') === '1';
}
function applyDark(v: boolean) {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle('dark', v);
}

function freshUi(role: string, tid: string, name: string) {
  return {
    role, tid, name,
    page: role === 'lead' ? 'dashboard' : role === 'other' ? 'classes' : 'dash',
    logMode: 'list' as 'list' | 'wizard',
    taskFilter: 'all', tagFilter: '전체', myFilter: 'all',
    jSel: null as string | null, jNewDate: null as string | null,
    tSel: null as string | null, selTask: null as string | null,
    otherClassSel: null as string | null,
    noticeEditId: null as string | null, noticeDraft: '', noticeFormKey: 0,
    modal: null as any, wizard: null as any,
    otherNotebookDate: '' as string,
    otherNotebook: { nbByClass: {}, nbSync: 'idle' } as any,
    dark: readDarkPref(),
    booting: true,
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [, setTick] = useState(0);
  const render = useCallback(() => setTick((t) => (t + 1) % 1000000000), []);
  const ref = useRef<any>(null);

  if (!ref.current) {
    const App: any = {
      session: null, state: null, ui: null, viewReport: null, counselRows: [], attByClass: {}, scoresByClass: {}, counselByTask: {}, counselMetaByTask: {}, counselRequestByTask: {}, specialSyncResult: null, regularSyncResult: null, regularQuarterStartResult: null, otherTeamRoster: null,
      render,
    };

    // ── 부트/세션 ──
    App.boot = async function () {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('npr_session') : null;
      if (saved) {
        try {
          App.session = JSON.parse(saved);
          App.ui = freshUi(App.session.role, App.session.tid, App.session.name);
          setAuthCtx(App.session.role, App.session.tid);
          render();
          await App.reload();
          App.ui.booting = false; render();
          return;
        } catch (e: any) {
          if ((e.message || '').indexOf('JSON') >= 0) { localStorage.removeItem('npr_session'); App.session = null; App.ui = null; render(); return; }
          App.ui && (App.ui.bootError = e.message); render(); return;
        }
      }
      App.session = null; App.ui = null; render();
    };
    App.reload = async function () {
      App.state = await api.get(`/api/state?role=${App.ui.role}&tid=${encodeURIComponent(App.ui.tid)}`);
      render();
    };
    App.login = async function (id: string, pw: string) {
      const r = await api.post('/api/login', { id, pw });
      App.session = r; localStorage.setItem('npr_session', JSON.stringify(r));
      App.ui = freshUi(r.role, r.tid, r.name); setAuthCtx(r.role, r.tid); render();
      await App.reload();
      App.ui.booting = false; render();
    };
    App.logout = function () {
      // 세션 쿠키는 HttpOnly라 서버가 지운다. 응답을 기다리지 않고 화면은 바로 로그인으로 돌린다.
      api.post('/api/logout').catch(() => { /* 이미 만료된 세션 */ });
      localStorage.removeItem('npr_session'); App.session = null; App.state = null; App.ui = null; render();
    };
    // 서버가 401을 돌려주면(쿠키 만료·로그아웃된 다른 탭) 저장된 화면 정보도 지우고 로그인으로 돌아간다.
    onUnauthorized(() => {
      if (!App.session) return;
      localStorage.removeItem('npr_session'); App.session = null; App.state = null; App.ui = null; render();
    });
    // 권한을 함께 가진 계정의 관리/강사/다른 팀 화면 전환. 다른 팀은 일일보고 대상이 아니다.
    App.switchRole = async function (role: 'lead' | 'teacher' | 'other') {
      if (!App.session || App.ui.role === role) return;
      if (role === 'lead' && !App.session.canLead) return;
      if (role === 'teacher' && !App.session.isTeacher) return;
      if (role === 'other' && !App.session.canOtherTeam) return;
      App.ui.role = role;
      App.ui.page = role === 'lead' ? 'dashboard' : role === 'other' ? 'classes' : 'dash';
      App.ui.logMode = 'list'; App.ui.modal = null;
      App.otherTeamRoster = null;
      setAuthCtx(role, App.ui.tid);
      App.state = null; render(); // 역할별 상태 형태가 달라 재조회 전까지 스플래시
      await App.reload();
    };

    App.go = function (page: string) { App.ui.page = page; App.ui.logMode = 'list'; App.ui.modal = null; render(); };
    App.setDark = function (v: boolean) {
      App.ui.dark = v;
      if (typeof window !== 'undefined') localStorage.setItem('npr_dark', v ? '1' : '0');
      applyDark(v);
      render();
    };

    // ── 모달 ──
    App.openModal = function (m: any) { App.ui.modal = m; render(); };
    App.closeModal = function () { App.ui.modal = null; render(); };
    App.openTaskCreate = function (date?: string) { App.openModal({ type: 'taskCreate', dateInit: date }); };
    App.openOtherCounselCreate = function () { App.openModal({ type: 'otherCounselCreate' }); };
    App.openDayAdd = function (date: string) { App.openModal({ type: 'dayAdd', date }); };
    App.openTaskEdit = function (id: string) { App.openModal({ type: 'taskCreate', editId: id }); };
    App.openTaskDetail = function (id: string) { App.openModal({ type: 'taskDetail', id }); };
    App.openTagManager = function () { App.openModal({ type: 'tags' }); };
    App.openEventCreate = function (mode: string, date?: string) { App.openModal({ type: 'eventCreate', mode, dateInit: date }); };
    App.openEventEdit = function (id: string) { App.openModal({ type: 'eventCreate', editId: id }); };
    App.openLogView = async function (name: string, date?: string) {
      const rawDate = date || App.state.today;
      App.viewReport = await api.get(`/api/reports/${encodeURIComponent(name)}/${rawDate}`);
      const vt = (App.state.teachers || []).find((x: any) => x.name === name);
      const vtid = vt ? vt.tid : App.ui.tid;
      try { App.counselRows = await api.get(`/api/ttt/counsel?date=${rawDate}&classes=&tid=${encodeURIComponent(vtid)}`); } catch { App.counselRows = []; }
      App.openModal({ type: 'log', name, rawDate, date: koDateFull(rawDate), confirmed: App.viewReport && App.viewReport.confirmed });
    };

    // ── 액션 헬퍼(낙관적 + 연타 방지) ──
    // lockKey를 주면 같은 작업이 처리 중일 땐 중복 호출을 무시(멱등성 — 공지 등 이중 등록 방지).
    const inflight = new Set<string>();
    function act(fn: () => Promise<any>, msg?: string | null, optimistic?: () => void, lockKey?: string) {
      if (lockKey) { if (inflight.has(lockKey)) return; inflight.add(lockKey); }
      if (optimistic) { try { optimistic(); } catch { /* noop */ } render(); }
      return (async () => {
        try {
          const r = await fn();
          if (msg) toast(msg);
          if (r && r.state) { App.state = r.state; render(); } // fold-state: 변경 응답의 최신 상태를 즉시 반영(별도 GET 생략)
          else await App.reload(); // 폴백: 상태 미첨부면 재조회
        }
        catch (e: any) { toast('오류: ' + e.message); try { await App.reload(); } catch { /* noop */ } }
        finally { if (lockKey) inflight.delete(lockKey); }
      })();
    }
    App._inflight = inflight; // 비-act 액션(saveTtt/submitWizard 등)도 공유
    const recountDone = (t: any) => { t.doneCount = (t.assignees || []).filter((n: string) => (t.statuses[n] || {}).status === 'done').length; };

    // ── 업무 ──  (act 안 화살표는 api 응답(fold된 state)을 반환하도록 return)
    // 업무 저장 — 낙관적 모달 닫기 없이 성공 여부(boolean)를 반환한다.
    // 모달이 결과를 받아 성공(true)일 때만 닫고, 실패 시 입력과 requestId를 유지해 재시도할 수 있게 한다.
    async function saveTask(call: () => Promise<any>, msg: string): Promise<boolean> {
      const key = 'task-save';
      if (inflight.has(key)) return false; // 연타/중복 제출 즉시 차단
      inflight.add(key);
      try {
        const r = await call();
        toast(msg);
        if (r && r.state) { App.state = r.state; render(); } // fold-state: 최신 상태 즉시 반영
        else if (r && r.task) {
          // 특강상담 생성은 Turso primary의 원자적 결과를 PII 없는 업무 델타로 반환한다.
          // 270명 스냅샷을 embedded replica로 다시 pull하는 전체 /state 왕복 없이 즉시 목록에 반영한다.
          const tasks = Array.isArray(App.state.tasks) ? App.state.tasks : (App.state.tasks = []);
          const index = tasks.findIndex((task: any) => task.id === r.task.id);
          if (index >= 0) tasks[index] = r.task; else tasks.push(r.task);
          render();
        } else await App.reload();                           // 구 응답 호환 폴백
        return true;
      } catch (e: any) {
        toast('오류: ' + e.message);
        // 입력과 멱등 requestId를 그대로 유지한다. 오류 뒤 전체 상태 재조회까지 기다리게 하면
        // 버튼이 최대 타임아웃만큼 더 잠기므로 사용자가 명시적으로 재시도할 수 있게 즉시 돌려준다.
        return false;
      } finally {
        inflight.delete(key);
      }
    }
    // requestId: 모달 인스턴스당 고정된 값 — 응답 유실 후 재시도해도 같은 키로 전송돼 서버가 중복 생성을 걸러낼 수 있는 멱등 키.
    App.createTask = function (d: any, requestId?: string): Promise<boolean> {
      return saveTask(async () => api.post('/api/tasks', { title: d.title, descr: d.desc, tag: d.tag, start: d.start, due: d.due, all: d.all, pick: d.pick, links: d.links, reportReq: d.reportReq, attachReq: d.attachReq, mt: d.mt, counsel: d.counsel, specialCounsel: !!d.specialCounsel, requestId }), '업무가 생성되었습니다.');
    };
    App.updateTask = function (editId: string, d: any): Promise<boolean> {
      return saveTask(async () => api.post(`/api/tasks/${editId}/edit`, { title: d.title, descr: d.desc, tag: d.tag, start: d.start, due: d.due, all: d.all, pick: d.pick, links: d.links, reportReq: d.reportReq, attachReq: d.attachReq, mt: d.mt, counsel: d.counsel, specialCounsel: !!d.specialCounsel }), '업무를 수정했습니다.');
    };
    // MT 업무: 강사가 M(월수금)/T(화목토) 완료를 따로 토글
    App.markTaskMt = function (id: string, part: 'm' | 't', value: boolean) {
      const me = App.state.me.name;
      act(async () => api.post(`/api/tasks/${id}/mt`, { teacher: me, part, value }), null, () => {
        const t = App.state.tasks.find((x: any) => x.id === id);
        if (t) { const cur = Object.assign({}, t.statuses[me] || {}); if (part === 'm') cur.mDone = value; else cur.tDone = value; cur.status = cur.mDone && cur.tDone ? 'done' : (cur.mDone || cur.tDone ? 'undone' : 'none'); t.statuses[me] = cur; recountDone(t); }
      }, 'mt-' + id + '-' + part);
    };
    App.deleteTask = function (id: string) {
      if (!window.confirm('이 업무를 삭제할까요? 강사들의 처리 상태도 함께 삭제됩니다.')) return;
      act(async () => api.del(`/api/tasks/${id}`), '업무를 삭제했습니다.', () => { App.state.tasks = App.state.tasks.filter((t: any) => t.id !== id); App.ui.modal = null; }, 'del-task-' + id);
    };
    App.markTask = function (id: string, status: string) {
      const me = App.state.me.name;
      act(async () => api.post(`/api/tasks/${id}/status`, { teacher: me, status }), status === 'done' ? '완료로 표시했습니다.' : '미완료로 표시했습니다.', () => { const t = App.state.tasks.find((x: any) => x.id === id); if (t) { t.statuses[me] = Object.assign({}, t.statuses[me] || {}, { status }); recountDone(t); } }, 'mark-' + id + '-' + status);
    };
    const repT: any = {};
    App.saveTaskReport = function (id: string, text: string, files: string[]) {
      const me = App.state.me.name;
      const t = App.state.tasks.find((x: any) => x.id === id);
      if (t) t.statuses[me] = Object.assign({}, t.statuses[me], { reportText: text, reportFiles: files });
      clearTimeout(repT[id]);
      repT[id] = setTimeout(async () => { try { await api.post(`/api/tasks/${id}/report`, { teacher: me, text, files }); } catch { /* noop */ } }, 500);
    };
    // 실제 파일 선택(pickFiles → {filename,b64}) → {name, url(data)} 로 저장. 4MB 가드.
    App.addTaskFiles = function (id: string, picked: any[]) {
      const me = App.state.me.name, t = App.state.tasks.find((x: any) => x.id === id);
      if (!t || !picked || !picked.length) return;
      const MAX = 4 * 1024 * 1024;
      const entries: any[] = [];
      for (const p of picked) {
        const size = Math.floor(((p.b64 || '').length) * 0.75);
        if (size > MAX) { toast(`'${p.filename}'은(는) 너무 큽니다 (4MB 이하만 첨부).`); continue; }
        entries.push({ name: p.filename, url: `data:application/octet-stream;base64,${p.b64}` });
      }
      if (!entries.length) return;
      clearTimeout(repT[id]);
      const files = ((t.statuses[me] || {}).reportFiles || []).concat(entries);
      act(async () => api.post(`/api/tasks/${id}/report`, { teacher: me, text: (t.statuses[me] || {}).reportText || '', files }), `${entries.length}개 파일을 첨부했습니다.`, () => { t.statuses[me] = Object.assign({}, t.statuses[me] || {}, { reportFiles: files }); });
    };
    App.removeTaskFile = function (id: string, idx: number) {
      const me = App.state.me.name, t = App.state.tasks.find((x: any) => x.id === id);
      if (!t) return;
      clearTimeout(repT[id]);
      const files = ((t.statuses[me] || {}).reportFiles || []).filter((_: any, i: number) => i !== idx);
      act(async () => api.post(`/api/tasks/${id}/report`, { teacher: me, text: (t.statuses[me] || {}).reportText || '', files }), null, () => { t.statuses[me] = Object.assign({}, t.statuses[me] || {}, { reportFiles: files }); });
    };

    // ── 일정 ──
    // 개인일정 체크는 화면에 즉시 반영하고 이벤트별로 직렬 저장한다. 저장 중 여러 항목을
    // 눌러도 가장 최신 전체 메모를 이어서 보내므로 느린 Turso 응답이 새 체크를 덮지 않는다.
    const eventTodoQueues = new Map<string, { desired: string; confirmed: string; promise: Promise<boolean> | null }>();
    async function saveEvent(call: () => Promise<any>, msg: string): Promise<boolean> {
      const key = 'event-save';
      if (inflight.has(key)) return false;
      inflight.add(key);
      try {
        const response = await call();
        if (response && response.state) { App.state = response.state; render(); }
        else await App.reload();
        toast(msg);
        return true;
      } catch (e: any) {
        // 폼을 먼저 닫거나 전체 상태를 재조회하지 않는다. 호출부가 실패한 입력을 그대로
        // 보존한 채 재시도할 수 있도록 성공 여부만 돌려준다.
        toast('오류: ' + e.message);
        return false;
      } finally {
        inflight.delete(key);
      }
    }
    App.createEvent = function (mode: string, d: any): Promise<boolean> {
      return saveEvent(
        () => api.post('/api/events', { title: d.title, descr: d.desc, start: d.start, end: d.end, mode, tag: d.tag, tid: App.ui.tid, role: App.ui.role }),
        '일정이 등록되었습니다.',
      );
    };
    App.updateEvent = function (id: string, mode: string, d: any): Promise<boolean> {
      return saveEvent(async () => {
        // 읽기 화면의 체크 저장이 아직 진행 중이면 먼저 확정시킨 뒤 전체 메모를 저장한다.
        // 그렇지 않으면 늦게 끝난 todo 요청이 방금 수정한 메모를 이전 문자열로 덮을 수 있다.
        const queue = eventTodoQueues.get(id);
        if (queue?.promise) await queue.promise;
        const response = await api.post(`/api/events/${id}/edit`, { title: d.title, descr: d.desc, start: d.start, end: d.end, mode, tag: d.tag });
        if (queue) queue.desired = queue.confirmed = String(d.desc || '');
        return response;
      }, '일정을 수정했습니다.');
    };
    App.updateEventTodo = function (id: string, descr: string): Promise<boolean> {
      const event = (App.state.events || []).find((item: any) => item.id === id);
      if (!event || event.type !== 'personal' || !event.mine) return Promise.resolve(false);
      let queue = eventTodoQueues.get(id);
      if (!queue) {
        const current = String(event.descr || '');
        queue = { desired: current, confirmed: current, promise: null };
        eventTodoQueues.set(id, queue);
      } else if (!queue.promise) {
        queue.confirmed = String(event.descr || '');
      }
      queue.desired = String(descr || '');
      event.descr = queue.desired;
      render();
      if (queue.promise) return queue.promise;

      const active = queue;
      active.promise = (async () => {
        try {
          while (active.confirmed !== active.desired) {
            const target = active.desired;
            await api.post(`/api/events/${encodeURIComponent(id)}/todo`, { descr: target });
            active.confirmed = target;
          }
          return true;
        } catch (e: any) {
          // 서버가 저장을 확정하지 못하면 마지막 확정 문자열로 되돌려 미저장 상태를 숨기지 않는다.
          active.desired = active.confirmed;
          const current = (App.state.events || []).find((item: any) => item.id === id);
          if (current) current.descr = active.confirmed;
          render();
          toast('체크 저장 실패: ' + (e?.message || '잠시 후 다시 시도해 주세요.'));
          return false;
        } finally {
          active.promise = null;
        }
      })();
      return active.promise;
    };
    App.deleteEvent = async function (id: string): Promise<boolean> {
      const key = 'del-event-' + id;
      if (inflight.has(key)) return false;
      inflight.add(key);
      try {
        const queue = eventTodoQueues.get(id);
        if (queue?.promise) await queue.promise;
        const response = await api.del(`/api/events/${encodeURIComponent(id)}`);
        if (response && response.state) App.state = response.state;
        else App.state.events = (App.state.events || []).filter((event: any) => event.id !== id);
        eventTodoQueues.delete(id);
        App.ui.modal = null;
        render();
        toast('일정을 삭제했습니다.');
        return true;
      } catch (e: any) {
        toast('오류: ' + e.message);
        return false;
      } finally {
        inflight.delete(key);
      }
    };


    // ── 태그 ──
    App.addTag = function (name: string) { act(async () => api.post('/api/tags', { name: name.trim() }), null, undefined, 'tag-add-' + name.trim()); };
    App.updateTag = function (name: string, patch: any) { act(async () => api.post(`/api/tags/${encodeURIComponent(name)}`, patch)); };
    App.deleteTag = function (name: string) { act(async () => api.del(`/api/tags/${encodeURIComponent(name)}`), null, () => { App.state.tags = (App.state.tags || []).filter((t: any) => t.name !== name); }, 'del-tag-' + name); };

    // ── 공지 ──
    App.publishNotice = function (text: string, editId?: string | null) {
      if (!(text || '').trim()) { toast('공지 내용을 입력해 주세요.'); return; }
      act(async () => (editId ? api.post(`/api/notices/${editId}`, { text }) : api.post('/api/notices', { text })), '공지가 게시되었습니다.', () => { App.ui.noticeEditId = null; App.ui.noticeDraft = ''; App.ui.noticeFormKey = (App.ui.noticeFormKey || 0) + 1; }, 'notice-save');
    };
    App.toggleNotice = function (n: any) { act(async () => api.post(`/api/notices/${n.id}`, { active: !n.active }), null, () => { const x = (App.state.notices || []).find((o: any) => o.id === n.id); if (x) x.active = !x.active; }, 'toggle-notice-' + n.id); };
    // 공지 노출 순서 재정렬 (드래그) — ids 순서대로 저장
    App.reorderNotices = function (ids: string[]) {
      act(async () => api.post('/api/notices/reorder', { ids }), null, () => {
        const byId: Record<string, any> = {}; (App.state.notices || []).forEach((n: any) => { byId[n.id] = n; });
        App.state.notices = ids.map((id) => byId[id]).filter(Boolean);
      }, 'notice-reorder');
    };
    App.deleteNotice = function (id: string) { act(async () => api.del(`/api/notices/${id}`), '공지를 삭제했습니다.', () => { App.state.notices = (App.state.notices || []).filter((o: any) => o.id !== id); }, 'del-notice-' + id); };

    // ── 강사 ──
    App.createTeacher = function (d: any, done?: () => void) {
      act(async () => { const r = await api.post('/api/teachers', { name: d.name, tid: d.tid, pw: d.pw }); if (done) done(); return r; }, '강사가 등록되었습니다.', undefined, 'teacher-create-' + d.tid);
    };
    App.deleteTeacher = function (tid: string, name: string) {
      if (!window.confirm(`강사 '${name}'을(를) 삭제할까요? 담당 반·처리 상태·제출 기록과 연결된 상담·학생 기록도 함께 삭제됩니다.`)) return;
      act(async () => api.del(`/api/teachers/${tid}`), '강사를 삭제했습니다.', () => { App.state.teachers = (App.state.teachers || []).filter((t: any) => t.tid !== tid); if (App.ui.tSel === tid) App.ui.tSel = null; }, 'del-teacher-' + tid);
    };
    App.saveTtt = async function (tid: string, tttId: string, tttPw: string) {
      const key = 'ttt-' + tid;
      if (inflight.has(key)) return; inflight.add(key);
      try {
        toast('통통통 로그인 확인 중...');
        const r = await api.post('/api/ttt/teacher-creds', { tid, tttId: tttId.trim(), tttPw });
        toast(`통통통 연결됨: ${r.memberName}`);
        await App.reload();
      } catch (e: any) { toast(e.message || '통통통 로그인 실패'); }
      finally { inflight.delete(key); }
    };
    App.changePassword = function (tid: string, pw: string, done?: () => void) {
      act(async () => { const r = await api.post(`/api/teachers/${tid}/password`, { pw: pw.trim() }); if (done) done(); return r; }, '비밀번호를 변경했습니다.', undefined, 'pw-' + tid);
    };
    // 팀장 임명/해제 (강사 → 팀장 권한)
    App.setTeacherLead = function (tid: string, isLead: boolean, name?: string) {
      act(async () => api.post(`/api/teachers/${tid}/lead`, { isLead }), isLead ? `${name || ''} 팀장으로 임명했습니다.`.trim() : `${name || ''} 팀장 권한을 해제했습니다.`.trim(), undefined, 'lead-' + tid);
    };
    App.setTeacherOtherTeam = function (tid: string, isOtherTeam: boolean, name?: string) {
      act(
        async () => api.post(`/api/teachers/${tid}/other-team`, { isOtherTeam }),
        isOtherTeam ? `${name || ''} 다른 팀 권한을 부여했습니다.`.trim() : `${name || ''} 다른 팀 권한을 해제했습니다.`.trim(),
        undefined,
        'other-team-' + tid,
      );
    };

    // ── 다른 팀 편의 기능 ──
    App.loadOtherTeamRoster = async function () {
      if (App.ui.role !== 'other') return null;
      const key = 'other-team-roster-load';
      if (inflight.has(key)) return App.otherTeamRoster;
      inflight.add(key);
      App.ui.otherRosterLoading = true; App.ui.otherRosterError = ''; render();
      try {
        App.otherTeamRoster = await api.get('/api/other-team/classes');
        return App.otherTeamRoster;
      } catch (e: any) {
        App.ui.otherRosterError = e.message || '본인 반을 불러오지 못했습니다.';
        return null;
      } finally {
        inflight.delete(key);
        App.ui.otherRosterLoading = false; render();
      }
    };
    App.syncOtherTeamRoster = async function (targetDate?: string) {
      const key = 'other-team-roster-sync';
      if (inflight.has(key)) return false;
      inflight.add(key);
      App.ui.otherRosterSyncing = true; App.ui.otherRosterError = ''; render();
      try {
        const r = await api.post('/api/other-team/classes/sync', { targetDate: targetDate || App.state.today });
        App.otherTeamRoster = r;
        // 반 범위가 달라질 수 있으므로 이전 반의 알림장 조회 완료 상태를 재사용하지 않는다.
        App.ui.otherNotebook = { nbByClass: {}, nbSync: 'idle' };
        toast(`${r.classCount || 0}개 반 · ${r.studentCount || 0}명 동기화를 완료했습니다.`);
        render();
        return true;
      } catch (e: any) {
        App.ui.otherRosterError = e.message || '본인 반 동기화에 실패했습니다.';
        toast('본인 반 동기화 실패: ' + App.ui.otherRosterError);
        render();
        return false;
      } finally {
        inflight.delete(key);
        App.ui.otherRosterSyncing = false; render();
      }
    };
    App.createOtherCounsel = async function (d: any): Promise<boolean> {
      const key = 'other-team-counsel-create';
      if (inflight.has(key)) return false;
      inflight.add(key);
      try {
        const r = await api.post('/api/other-team/counsel', d);
        if (r?.task) {
          const tasks = Array.isArray(App.state.tasks) ? App.state.tasks : (App.state.tasks = []);
          const index = tasks.findIndex((task: any) => task.id === r.task.id);
          if (index >= 0) tasks[index] = r.task; else tasks.push(r.task);
          App.ui.selTask = r.task.id;
        } else {
          await App.reload();
        }
        toast('상담일정을 만들었습니다.');
        render();
        return true;
      } catch (e: any) {
        toast('상담일정 생성 실패: ' + (e.message || e));
        return false;
      } finally {
        inflight.delete(key);
      }
    };
    App.deleteOtherCounsel = async function (id: string, title: string) {
      if (!window.confirm(`상담일정 '${title}'을(를) 삭제할까요? 작성한 상담 진행 기록도 함께 삭제됩니다.`)) return false;
      const key = 'other-team-counsel-delete-' + id;
      if (inflight.has(key)) return false;
      inflight.add(key);
      try {
        await api.del(`/api/other-team/counsel/${id}`);
        App.state.tasks = (App.state.tasks || []).filter((task: any) => task.id !== id);
        if (App.ui.selTask === id) App.ui.selTask = App.state.tasks[0]?.id || null;
        delete App.counselByTask[id]; delete App.counselMetaByTask[id];
        toast('상담일정을 삭제했습니다.'); render();
        return true;
      } catch (e: any) {
        toast('상담일정 삭제 실패: ' + (e.message || e));
        return false;
      } finally {
        inflight.delete(key);
      }
    };

    // ── 일일보고 정의 ──
    App.createJournal = function (date: string) {
      return act(async () => {
        // 날짜 변경 직후 생성해도 전역 특강 설정 저장이 먼저 끝나도록 순서를 보장한다.
        if (App.specialPeriodSavePromise) await App.specialPeriodSavePromise;
        if (App.ui.specialPeriodSaveError) throw new Error('특강기간 설정 저장을 확인한 뒤 다시 생성해 주세요.');
        return api.post('/api/journals', { date });
      }, '일일보고를 생성했습니다.', () => { App.ui.jSel = date; }, 'journal-create-' + date);
    };
    App.setSpecialPeriod = function (enabled: boolean, targetDate?: string) {
      const date = targetDate || App.ui.jNewDate || App.state?.settings?.specialSyncDate || App.state?.today;
      if (!date) { toast('특강 기준일을 선택해 주세요.'); return; }
      const wasEnabled = !!App.state?.settings?.specialPeriodEnabled;
      App.specialPeriodPending = { enabled: !!enabled, targetDate: date };
      App.state.settings = Object.assign({}, App.state.settings, { specialPeriodEnabled: !!enabled, specialSyncDate: date });
      App.ui.specialPeriodSaveError = null;
      render();

      // 빠른 ON→OFF/날짜 변경은 마지막 값으로 합쳐 순차 저장한다. 진행 중 요청을 버리지 않는다.
      if (!App.specialPeriodSavePromise) {
        App.ui.specialPeriodSaving = true;
        const run = (async () => {
          while (App.specialPeriodPending) {
            const desired = App.specialPeriodPending;
            App.specialPeriodPending = null;
            try {
              const response = await api.post('/api/special-period', desired);
              if (response?.state) App.state = response.state;
              const queued = App.specialPeriodPending;
              if (queued) {
                App.state.settings = Object.assign({}, App.state.settings, {
                  specialPeriodEnabled: queued.enabled,
                  specialSyncDate: queued.targetDate,
                });
              }
              App.ui.specialPeriodSaveError = null;
            } catch (error: any) {
              App.ui.specialPeriodSaveError = error?.message || '특강기간 설정 저장 실패';
              if (!App.specialPeriodPending) {
                try { await App.reload(); } catch { /* 기존 화면 유지 */ }
                toast('특강기간 설정 저장 실패: ' + App.ui.specialPeriodSaveError);
              }
            }
            render();
          }
        })();
        App.specialPeriodSavePromise = run.finally(() => {
          App.specialPeriodSavePromise = null;
          App.ui.specialPeriodSaving = false;
          render();
        });
      }
      if (wasEnabled !== !!enabled) toast(enabled ? '특강기간을 켰습니다.' : '특강기간을 껐습니다.');
      return App.specialPeriodSavePromise;
    };
    App.syncSpecialClasses = async function () {
      const key = 'special-classes-sync';
      if (inflight.has(key)) return;
      inflight.add(key);
      App.ui.specialClassSync = 'loading';
      App.specialSyncResult = null;
      render();
      try {
        // 토글/기준일 저장과 동기화가 서로 다른 서버리스 인스턴스에 도착해도 이전 날짜를 읽지 않게 순서를 고정한다.
        if (App.specialPeriodSavePromise) await App.specialPeriodSavePromise;
        if (App.ui.specialPeriodSaveError) throw new Error('특강기간 설정 저장을 확인한 뒤 다시 동기화해 주세요.');
        if (!App.state?.settings?.specialPeriodEnabled) throw new Error('특강기간을 먼저 켜 주세요.');
        const response = await api.post('/api/special-classes/sync', {});
        const { state: foldedState, ...summary } = response || {};
        App.specialSyncResult = Object.assign({ ok: true }, summary);
        if (foldedState) App.state = foldedState;
        else await App.reload();
        App.ui.specialClassSync = 'done';
        const unmatched = (summary.unmatchedTeachers || []).length + (summary.unmatchedClasses || []).length;
        toast(unmatched ? `특강 반 동기화 완료 · 미매칭 ${unmatched}건` : `특강 반 ${summary.classCount || 0}개를 동기화했습니다.`);
        return App.specialSyncResult;
      } catch (e: any) {
        const message = e?.message || '특강 반 동기화에 실패했습니다.';
        App.ui.specialClassSync = 'error';
        App.specialSyncResult = { ok: false, error: message };
        toast('특강 반 동기화 실패: ' + message);
        return null;
      } finally {
        inflight.delete(key);
        render();
      }
    };
    // 정규(일반) 반 동기화 — 등록 강사 계정 교차 확인 결과가 전체 검증을 통과했을 때만 적용된다.
    // applied=false 응답은 실패가 아니라 '안전 보류'(기존 배정 유지)이므로 오류와 구분해 알린다.
    App.syncRegularClasses = async function () {
      const key = 'regular-classes-sync';
      if (inflight.has(key) || inflight.has('regular-quarter-start-preview') || inflight.has('regular-quarter-start-apply')) return; // 연타·교차 실행 방지
      inflight.add(key);
      App.ui.regularClassSync = 'loading';
      App.regularSyncResult = null;
      App.regularQuarterStartResult = null;
      App.ui.regularQuarterStart = 'idle';
      render();
      try {
        const response = await api.post('/api/regular-classes/sync', { targetDate: App.state.today, dryRun: false });
        const { state: foldedState, ...summary } = response || {};
        App.regularSyncResult = Object.assign({ ok: true }, summary);
        if (foldedState) App.state = foldedState;
        else await App.reload();
        App.ui.regularClassSync = 'done';
        if (summary.applied) {
          toast(`정규 반 ${summary.classCount || 0}개를 강사 ${summary.matchedTeacherCount || 0}명에게 동기화했습니다.`);
        } else {
          const issues = (summary.accountFailures || []).length + (summary.ambiguousClasses || []).length + (summary.unclaimedClasses || []).length;
          toast(`정규 반 동기화 보류${issues ? ` · 확인 필요 ${issues}건` : ''} — 기존 담당 반은 변경되지 않았습니다.`);
        }
        return App.regularSyncResult;
      } catch (e: any) {
        const message = e?.message || '정규 반 동기화에 실패했습니다.';
        App.ui.regularClassSync = 'error';
        App.regularSyncResult = { ok: false, error: message };
        toast('정규 반 동기화 실패: ' + message);
        return null;
      } finally {
        inflight.delete(key);
        render();
      }
    };
    // 새 분기 시작은 반드시 사전 검증 → 변경 확인 → 같은 결과 재검증·적용의 두 단계로 실행한다.
    App.previewRegularQuarterStart = async function () {
      const key = 'regular-quarter-start-preview';
      if (inflight.has(key) || inflight.has('regular-quarter-start-apply') || inflight.has('regular-classes-sync')) return;
      inflight.add(key);
      App.ui.regularQuarterStart = 'previewing';
      App.regularQuarterStartResult = null;
      render();
      try {
        const response = await api.post('/api/regular-classes/quarter-start', {
          targetDate: App.state.today,
          dryRun: true,
        });
        const { state: foldedState, ...summary } = response || {};
        App.regularQuarterStartResult = Object.assign({ ok: true }, summary);
        if (foldedState) App.state = foldedState;
        App.ui.regularQuarterStart = summary.canApply ? 'preview' : 'done';
        if (summary.canApply) {
          toast(`새 분기 변경안 확인 완료 · 추가 ${summary.transition?.addedClassCount || 0}개 · 제외 ${summary.transition?.removedClassCount || 0}개`);
        } else {
          const issues = (summary.accountFailures || []).length + (summary.ambiguousClasses || []).length + (summary.unsupportedClasses || []).length;
          toast(`새 분기 시작 보류${issues ? ` · 확인 필요 ${issues}건` : ''} — 기존 정규 반은 변경되지 않았습니다.`);
        }
        return App.regularQuarterStartResult;
      } catch (e: any) {
        const message = e?.message || '새 분기 명단 확인에 실패했습니다.';
        App.ui.regularQuarterStart = 'error';
        App.regularQuarterStartResult = { ok: false, error: message };
        toast('새 분기 명단 확인 실패: ' + message);
        return null;
      } finally {
        inflight.delete(key);
        render();
      }
    };
    App.applyRegularQuarterStart = async function () {
      const key = 'regular-quarter-start-apply';
      if (inflight.has(key) || inflight.has('regular-quarter-start-preview') || inflight.has('regular-classes-sync')) return null;
      const preview = App.regularQuarterStartResult;
      if (!preview?.ok || !preview?.canApply || !preview?.previewFingerprint) {
        toast('먼저 새 분기 변경 내용을 확인해 주세요.');
        return null;
      }
      const transition = preview.transition || {};
      const confirmed = window.confirm(
        `${preview.previousSourceMonth || '이전 분기'} 정규 반을 ${preview.sourceMonth || '새 분기'} 명단으로 교체할까요?\n\n`
        + `강사 ${transition.changedTeacherCount || 0}명 변경 · 반 ${transition.addedClassCount || 0}개 추가 · ${transition.removedClassCount || 0}개 제외\n`
        + '특강 반은 변경되지 않습니다.\n\n이 작업은 되돌릴 수 없습니다.',
      );
      if (!confirmed) return null;
      inflight.add(key);
      App.ui.regularQuarterStart = 'applying';
      render();
      try {
        const response = await api.post('/api/regular-classes/quarter-start', {
          targetDate: App.state.today,
          dryRun: false,
          confirmQuarterStart: true,
          previewFingerprint: preview.previewFingerprint,
        });
        const { state: foldedState, ...summary } = response || {};
        App.regularQuarterStartResult = Object.assign({ ok: true }, summary);
        App.regularSyncResult = null;
        if (foldedState) App.state = foldedState;
        else await App.reload();
        App.ui.regularQuarterStart = summary.applied ? 'done' : 'error';
        if (summary.applied) {
          toast(`새 분기 시작 완료 · 정규 반 ${summary.classCount || 0}개를 강사 ${summary.matchedTeacherCount || 0}명에게 반영했습니다.`);
        } else {
          toast('새 분기 시작이 보류되어 기존 정규 반을 유지했습니다.');
        }
        return App.regularQuarterStartResult;
      } catch (e: any) {
        const message = e?.message || '새 분기 적용에 실패했습니다.';
        App.ui.regularQuarterStart = 'error';
        App.regularQuarterStartResult = Object.assign({}, preview, { ok: false, error: message });
        toast('새 분기 적용 실패: ' + message);
        return null;
      } finally {
        inflight.delete(key);
        render();
      }
    };
    App.cancelRegularQuarterStart = function () {
      if (App.ui.regularQuarterStart === 'applying' || App.ui.regularQuarterStart === 'previewing') return;
      App.regularQuarterStartResult = null;
      App.ui.regularQuarterStart = 'idle';
      render();
    };
    App.deleteJournal = function (date: string) {
      if (!window.confirm('이 날짜의 일일보고를 삭제할까요? 체크리스트와 제출 기록도 함께 삭제됩니다.')) return;
      act(async () => api.del(`/api/journals/${date}`), '일일보고를 삭제했습니다.', () => { App.state.journals = (App.state.journals || []).filter((j: any) => j.date !== date); if (App.ui.jSel === date) App.ui.jSel = null; }, 'del-journal-' + date);
    };
    App.addJournalItem = function (date: string, text: string) {
      act(async () => api.post(`/api/journals/${date}/items`, { text, required: false }), null, () => { const j = (App.state.journals || []).find((x: any) => x.date === date); if (j) j.items = (j.items || []).concat({ id: 'tmp-' + Math.random().toString(36).slice(2), text, required: false }); }, 'jitem-add-' + date + '-' + text);
    };
    App.updateJournalItemText = async function (id: string, text: string): Promise<boolean> {
      const normalized = text.trim();
      const key = 'edit-jitem-' + id;
      if (inflight.has(key)) return false;
      inflight.add(key);
      try {
        const response = await api.post(`/api/journal-items/${encodeURIComponent(id)}/edit`, { text: normalized });
        toast('체크리스트 항목을 수정했습니다.');
        if (response && response.state) { App.state = response.state; render(); }
        else await App.reload();
        return true;
      } catch (e: any) {
        // 낙관적으로 문구를 덮어쓰지 않았으므로 실패 시 기존 화면 상태와 사용자 입력을 보존할 수 있다.
        toast('오류: ' + e.message);
        return false;
      } finally {
        inflight.delete(key);
      }
    };
    App.removeJournalItem = function (id: string) { act(async () => api.del(`/api/journal-items/${id}`), null, () => { (App.state.journals || []).forEach((j: any) => { j.items = (j.items || []).filter((i: any) => i.id !== id); }); }, 'del-jitem-' + id); };
    App.toggleJournalItemReq = function (id: string) { act(async () => api.post(`/api/journal-items/${id}/toggle-req`, {}), null, () => { (App.state.journals || []).forEach((j: any) => (j.items || []).forEach((i: any) => { if (i.id === id) i.required = !i.required; })); }, 'toggle-jitem-' + id); };

    // ── 확인 ──
    App.confirmReport = function (name: string, date?: string) { const d = date || App.state.today; act(async () => api.post(`/api/reports/${encodeURIComponent(name)}/${d}/confirm`, {}), '보고를 확인 처리했습니다.', () => { App.ui.modal = null; }, 'confirm-' + name + '-' + d); };
    App.reopenLog = function () { act(async () => api.post(`/api/reports/${encodeURIComponent(App.state.me.name)}/${App.state.today}/reopen`, {}), '제출을 취소하고 수정 모드로 전환했습니다.', undefined, 'reopen'); };

    // ── 위저드 ──
    App.classesForDate = function (date?: string, teacher?: any) {
      return classesForDate(App.state, date || App.state.today, teacher || App.state.me);
    };
    // 위저드가 작성 중인 일일보고 날짜(정본). 지난 보고 작성 시 state.today가 아니라 이 날짜로 모든 날짜 의존 동작을 건다.
    App.reportDate = function () {
      return (App.ui && App.ui.wizard && App.ui.wizard.reportDate) || App.state.today;
    };
    App.todayClasses = function () {
      const snapshot = App.ui?.wizard?.classSnapshot;
      return Array.isArray(snapshot) ? snapshot : App.classesForDate(App.reportDate(), App.state.me);
    };
    // date 미지정 시 오늘 보고. 지난 날짜는 선택 보고를 조회해 초안을 이어 쓰고(없으면 빈 보고), 제출 완료본은 읽기 전용 모달로 넘긴다.
    App.enterWizard = async function (date?: string) {
      const S = App.state;
      const reportDate = date || S.today;
      const isToday = reportDate === S.today;
      // 선택 날짜에 생성된 일일보고(체크리스트 정본)가 없으면 작성 대상이 없으므로 토스트만 띄우고 진입하지 않는다.
      const journal = S.journals.find((j: any) => j.date === reportDate);
      if (!journal) { toast('해당 날짜의 일일보고가 아직 생성되지 않았습니다.'); return; }
      // 날짜 의존 위저드 캐시(상담/출결/성적)는 이전 날짜 값을 남기지 않도록 진입 전 모두 비운다.
      App.counselRows = []; App.attByClass = {}; App.scoresByClass = {};
      let report = isToday ? S.myReport : null;
      if (!isToday) {
        // 조회 자체가 실패하면 기존 초안 여부를 알 수 없으므로, 빈 편집기로 진입해 초안을 덮어쓰지 않도록 토스트만 띄우고 중단한다.
        // (성공 200 + null 응답은 예외가 아니라 "초안 없음"이므로 아래 빈 지난 보고 흐름으로 계속 진행된다.)
        try { report = await api.get(`/api/reports/${encodeURIComponent(S.me.name)}/${reportDate}`); }
        catch (e: any) { toast('지난 일일보고를 불러오지 못했습니다: ' + e.message); return; }
      }
      // 제출 완료본은 위저드가 아니라 기존 읽기 전용 보고 모달로 연다.
      if (report && report.status === 'submitted') { App.openLogView(S.me.name, reportDate); return; }
      const payload = (report && report.payload) || {};
      const items = journal.items || [];
      const cl: any = {}; items.forEach((it: any) => { cl[it.id] = (payload.cl && payload.cl[it.id]) || { checked: false, report: '', files: [] }; });
      const myStatus: any = {};
      S.tasks.forEach((t: any) => { myStatus[t.id] = (t.statuses[S.me.name] || {}).status || null; });
      const specialPeriod = typeof payload.specialPeriod === 'boolean' ? payload.specialPeriod : isSpecialJournal(S, reportDate);
      const classSnapshot = Array.isArray(payload.classSnapshot)
        ? payload.classSnapshot.map((c: any) => String(c || '').trim()).filter(Boolean)
        : classesForDate(S, reportDate, S.me, specialPeriod);
      App.ui.wizard = { step: 1, reportDate, cl, nbByClass: payload.nbByClass || {}, nbSync: payload.nbSync || 'idle', counselOk: payload.counselOk || false, attOk: payload.attOk || false, attClass: null, myStatus, specialPeriod, classSnapshot: Array.from(new Set(classSnapshot)), view: 'edit', dirty: false };
      App.ui.logMode = 'wizard'; render();
    };
    App.exitWizard = function () { App.ui.logMode = 'list'; App.ui.wizard = null; App.reload(); };
    App.markDirty = function () { if (App.ui.wizard) App.ui.wizard.dirty = true; };
    App.setWizStep = function (n: number) { App.ui.wizard.step = n; App.enterStep(n); };
    App.enterStep = async function (n: number) {
      render();
      if (n === 3) App.syncCounsel(); // 상담: 들어갈 때마다 통통통에서 재조회
      if (n === 4) { const cls = App.todayClasses(); if (cls[0]) App.loadAttendance(App.ui.wizard.attClass || cls[0]); }
    };
    // 상담 재동기화 — 언제든 다시 눌러 통통통에서 최신 상담 기록을 다시 불러옴.
    App.syncCounsel = async function () {
      const w = App.ui.wizard; if (!w) return;
      w.counselSync = 'loading'; render();
      try { App.counselRows = await api.get(`/api/ttt/counsel?date=${App.reportDate()}&classes=&tid=${encodeURIComponent(App.ui.tid)}`); }
      catch { /* 실패 시 이전 데이터 유지 */ }
      w.counselSync = 'done'; render();
    };
    App.loadAttendance = async function (cls: string) {
      App.ui.wizard.attClass = cls;
      App.loadScores(cls); // 주간테스트 성적도 같이
      if (!App.attByClass[cls]) { try { App.attByClass[cls] = await api.get(`/api/ttt/attendance?cls=${encodeURIComponent(cls)}&date=${App.reportDate()}&tid=${encodeURIComponent(App.ui.tid)}`); } catch { App.attByClass[cls] = []; } }
      render();
    };
    // 출결 재동기화 — 캐시 무효화 후 통통통에서 다시 조회
    App.syncAttendance = async function (cls: string) {
      const w = App.ui.wizard; if (w) { w.attClass = cls; w.attSync = cls; }
      delete App.attByClass[cls]; delete App.scoresByClass[cls]; render();
      try { App.attByClass[cls] = await api.get(`/api/ttt/attendance?cls=${encodeURIComponent(cls)}&date=${App.reportDate()}&tid=${encodeURIComponent(App.ui.tid)}`); } catch { App.attByClass[cls] = []; }
      App.loadScores(cls);
      if (w) w.attSync = null; render();
    };
    // 성적/과제 — 점수는 주간테스트 날짜(설정), 선행/심화 과제는 출결 확인 날짜(오늘)로 각각 조회 후 이름으로 조인.
    App.loadScores = async function (cls: string) {
      const S = App.state;
      const isT = /T/i.test(cls);
      const scoreDate = (isT ? S.settings?.wtestT : S.settings?.wtestM) || ''; // 주간테스트 점수 날짜
      const hwDate = App.reportDate();                                          // 과제 이행 = 일일보고 날짜
      const key = scoreDate + '|' + hwDate;
      if (!scoreDate && !hwDate) { App.scoresByClass[cls] = { key, scoreDate: '', hwDate: '', rows: [] }; render(); return; }
      if (App.scoresByClass[cls] && App.scoresByClass[cls].key === key) return;
      try { const rows = await api.get(`/api/ttt/scores?cls=${encodeURIComponent(cls)}&date=${scoreDate}&hwdate=${hwDate}&tid=${encodeURIComponent(App.ui.tid)}`); App.scoresByClass[cls] = { key, scoreDate, hwDate, rows: rows || [] }; }
      catch { App.scoresByClass[cls] = { key, scoreDate, hwDate, rows: [] }; }
      render();
    };
    App.setSetting = function (key: string, value: string) { act(async () => api.post('/api/settings', { key, value }), '저장되었습니다.', () => { App.state.settings = Object.assign({}, App.state.settings, key === 'wtest_m' ? { wtestM: value } : key === 'wtest_t' ? { wtestT: value } : {}); }, 'set-' + key); };

    // ── 전체 상담 업무 ──
    const refreshCounselProgressFromCache = (taskId: string, teacher: string) => {
      const task = (App.state.tasks || []).find((item: any) => item.id === taskId);
      if (!task || !(task.counsel || task.specialCounsel) || !teacher) return;
      const entries = (App.counselByTask[taskId] || []).filter((entry: any) => !entry.teacher || entry.teacher === teacher);
      const absenceCount = entries.reduce((sum: number, entry: any) => sum + Number(entry.absenceCount || 0), 0);
      const absencePendingCount = entries.reduce((sum: number, entry: any) => sum + Number(entry.absencePendingCount || 0), 0);
      task.counselProg = task.counselProg || {};
      task.counselProg[teacher] = {
        ...(task.counselProg[teacher] || {}),
        synced: entries.filter((entry: any) => entry.synced).length,
        total: entries.length,
        absenceCount,
        absencePendingCount,
        ...(task.specialCounsel ? { noTarget: entries.length === 0 } : {}),
      };
    };
    App.loadCounselEntries = async function (taskId: string, teacherName?: string, options: any = {}) {
      const teacher = String(teacherName || App.state.me.name || '').trim();
      const previousMeta = App.counselMetaByTask[taskId] || {};
      const teacherChanged = previousMeta.teacher && previousMeta.teacher !== teacher;
      const requestId = `${teacher}\n${Date.now()}\n${Math.random()}`;
      App.counselRequestByTask[taskId] = requestId;
      // 팀장이 강사 탭을 바꾼 직후에는 이전 강사의 학생·전화번호를 한 프레임도 남기지 않는다.
      if (teacherChanged) App.counselByTask[taskId] = [];
      App.counselMetaByTask[taskId] = teacherChanged
        ? { teacher, kind: '', sourceMonth: '', classes: [], loading: true, error: '' }
        : Object.assign({}, previousMeta, { teacher, loading: true, error: '' });
      render();
      try {
        const r = await api.get(`/api/counsel/${taskId}?teacher=${encodeURIComponent(teacher)}`);
        // 강사 A 응답이 늦게 도착해 이미 선택한 강사 B 화면을 덮지 않게 한다.
        if (App.counselRequestByTask[taskId] !== requestId) return r;
        App.counselByTask[taskId] = Array.isArray(r) ? r : (r.entries || []);
        if (!Array.isArray(r)) {
          const task = (App.state.tasks || []).find((item: any) => item.id === taskId);
          App.counselMetaByTask[taskId] = Object.assign({}, App.counselMetaByTask[taskId], {
            teacher,
            kind: r.kind || (task?.specialCounsel ? 'special' : 'regular'),
            sourceMonth: r.sourceMonth || task?.specialSourceMonth || '',
            classes: Array.isArray(r.classes) ? r.classes : [],
          });
        }
        refreshCounselProgressFromCache(taskId, teacher);
        return r;
      }
      catch (error) {
        const isCurrent = App.counselRequestByTask[taskId] === requestId;
        if (isCurrent) {
          if (teacherChanged) App.counselByTask[taskId] = [];
          App.counselMetaByTask[taskId] = Object.assign({}, App.counselMetaByTask[taskId], {
            teacher, loading: false, error: String((error as any)?.message || error || '상담 현황을 불러오지 못했습니다.'),
          });
        }
        if (options.throwOnError && isCurrent) throw error;
        return null;
      }
      finally {
        if (App.counselRequestByTask[taskId] === requestId) {
          App.counselMetaByTask[taskId] = Object.assign({}, App.counselMetaByTask[taskId], { loading: false });
          render();
        }
      }
    };
    App.syncCounselRoster = async function (taskId: string, cls: string, options: any = {}) {
      const teacher = String(options.teacher || App.state.me.name || '').trim();
      App.ui.counselSync = taskId + '|' + cls; render();
      try {
        const r = await api.post(`/api/counsel/${taskId}/sync-roster`, {
          teacher, cls, tid: App.ui.tid, date: App.state.today,
          // prepare 이후 반별 어머니 전화만 강제 새로고침한다(학생 명단은 그대로). 서버는 prepare 없이 cls만 오면 연락처 모드로 처리한다.
          ...(options.contactsOnly ? { contactsOnly: true } : {}),
          // 여러 반 일괄 동기화에서는 매 반마다 전체 앱 상태를 접어 보내지 않아 응답 크기와 DB 집계를 줄인다.
          responseMode: options.responseMode || (options.bulk ? 'delta' : 'full'),
        });
        const others = (App.counselByTask[taskId] || []).filter((e: any) => e.cls !== cls);
        App.counselByTask[taskId] = others.concat(r.entries || []);
        if (r.state) App.state = r.state;
        const warnings = Array.isArray(r.warnings) ? r.warnings.map(String) : (r.warning ? [String(r.warning)] : []);
        const previousMeta = App.counselMetaByTask[taskId] || {};
        App.counselMetaByTask[taskId] = Object.assign({}, previousMeta, {
          teacher,
          kind: r.kind || previousMeta.kind || 'regular',
          sourceMonth: r.sourceMonth || previousMeta.sourceMonth || '',
          classes: Array.isArray(r.classes) ? r.classes : (previousMeta.classes || []),
          warningsByClass: Object.assign({}, previousMeta.warningsByClass, { [cls]: warnings }),
        });
        refreshCounselProgressFromCache(taskId, teacher);
        if (!options.silent) toast(`${(r.entries || []).length}명 로스터 반영 (통통통 ${r.rosterCount || 0}명)${warnings.length ? ` · 경고 ${warnings.length}건` : ''}`);
        return r;
      } catch (e: any) {
        if (options.throwOnError) throw e;
        if (!options.silent) toast('로스터 동기화 실패: ' + (e.message || e));
        return null;
      } finally {
        App.ui.counselSync = null; render();
      }
    };
    // 한 번의 클릭으로 현재 강사의 전체 상담 로스터를 새로고침한다.
    // 1단계: 항상 prepare(현재 월 학생 명단)를 먼저 호출한다 — 기존 반 목록이 비었거나 '대상 없음'이어도 마찬가지다.
    // 2단계: prepare가 준 정본 반 목록으로 어머니 전화를 동시성 1로 순차 새로고침하고, 마지막에 canonical 상태를 한 번만 다시 읽는다.
    // ERP/서버 부하와 120초 함수 제한을 피하려고 반별 요청은 동시성 1로 처리하고, 반 하나가 끝날 때마다 실제 퍼센트를 갱신한다.
    App.syncAllCounselRosters = async function (taskId: string, teacherName?: string) {
      if (App.ui.role !== 'teacher' && App.ui.role !== 'other') { toast('팀장은 상담 현황을 읽기 전용으로 확인할 수 있습니다.'); return false; }
      const lockKey = 'counsel-sync-all-' + taskId;
      if (inflight.has(lockKey)) return false;
      inflight.add(lockKey);
      try {
        const teacher = String(teacherName || App.state.me.name || '').trim();
        const task = (App.state.tasks || []).find((item: any) => item.id === taskId);
        const special = !!task?.specialCounsel;
        // 진행 상태는 '가짜 경과시간'이 아니라 실제 단계·완료 반 수로만 채운다.
        // stage: 'prepare'(명단 확인) → 'contacts'(반별 전화 새로고침). status: preparing → running → done/partial, prepare 실패 시 failed.
        const progress: any = {
          taskId, teacher, stage: 'prepare',
          total: 0, completed: 0, percent: 0, currentClass: '',
          status: 'preparing', failures: [], reconcile: null, message: '',
        };
        App.ui.counselSyncProgress = progress; render();
        try {
          const outcome = await runCounselRosterRefresh({
            // 항상 prepare 먼저 — 서버 현재 월(YYYY-MM) 명단을 기준으로 시작한다. 실패하면 아래 catch가 기존 캐시를 그대로 보존한다.
            prepare: () => api.post(`/api/counsel/${taskId}/sync-roster`, {
              teacher, tid: App.ui.tid, date: App.state.today, prepare: true,
            }),
            onPrepared: (prepared: any, canonicalClasses: string[]) => {
              // prepare 성공 — 이 강사의 캐시 학생/반 목록을 서버 정본으로 교체하고 기준월·재조정 수치를 저장한다.
              // 반 목록이 새로 정해졌으니 이전 반 연락처 경고는 모두 비운다(obsolete 경고 제거). 다른 강사(팀장 열람) 캐시는 보존한다.
              const otherTeachers = (App.counselByTask[taskId] || []).filter((entry: any) => entry.teacher && entry.teacher !== teacher);
              App.counselByTask[taskId] = otherTeachers.concat(Array.isArray(prepared?.entries) ? prepared.entries : []);
              const reconcile = pickCounselReconcile(prepared);
              const previousMeta = App.counselMetaByTask[taskId] || {};
              App.counselMetaByTask[taskId] = Object.assign({}, previousMeta, {
                teacher,
                kind: prepared?.kind || previousMeta.kind || (special ? 'special' : 'regular'),
                sourceMonth: prepared?.sourceMonth || previousMeta.sourceMonth || '',
                classes: canonicalClasses,
                warningsByClass: {},
                reconcile,
              });
              refreshCounselProgressFromCache(taskId, teacher);
              // 명단 확인 완료 → 연락처 단계로 전환. 대상이 0개면 이미 최신(100%)이다.
              progress.reconcile = reconcile;
              progress.stage = 'contacts';
              progress.total = canonicalClasses.length;
              progress.completed = 0;
              progress.percent = canonicalClasses.length ? 0 : 100;
              progress.currentClass = canonicalClasses[0] || '';
              progress.status = canonicalClasses.length ? 'running' : 'done';
              render();
            },
            // prepare 이후 반별 어머니 전화만 강제 새로고침(연락처 모드). silent — 요약 토스트는 마지막에 한 번만 띄운다.
            syncContacts: (cls, responseMode) => App.syncCounselRoster(taskId, cls, {
              teacher, contactsOnly: true, bulk: responseMode === 'delta', responseMode, silent: true, throwOnError: true,
            }),
            onProgress: (next) => {
              progress.completed = next.processed;
              progress.total = next.total;
              progress.percent = next.percent;
              progress.currentClass = next.currentClass;
              progress.failures = next.failures;
              render();
            },
          });

          // 정본 반영 — 이 라우트는 state를 접어주지 않으므로(항상 finalStateFolded=false) 마지막에 canonical 상태를 한 번 다시 읽는다.
          if (!outcome.finalStateFolded) {
            try { await App.reload(); } catch { /* 연락처 delta는 이미 화면에 반영되어 있으므로 진행 결과는 유지 */ }
          }
          refreshCounselProgressFromCache(taskId, teacher);

          // 대상이 0명/0반이면 오류가 아니라 100% 최신 로스터다 — 성공으로 마감하고 버튼은 재시도용으로 계속 노출한다.
          if (!outcome.classes.length) {
            progress.status = 'done';
            progress.total = 0;
            progress.completed = 0;
            progress.percent = 100;
            progress.currentClass = '';
            render();
            const summary = counselReconcileSummary(progress.reconcile);
            toast('이번 달 상담 대상 학생이 없어 로스터가 최신입니다.' + (summary ? ` · ${summary}` : ''));
            return true;
          }

          progress.status = outcome.contactFailures.length ? 'partial' : 'done';
          render();
          // 연락처 경고(부분 조회 실패)가 남았으면 완료 토스트가 '모두 정상'으로 읽히지 않게 함께 알린다.
          const classCount = outcome.classes.length;
          const warnedClassCount = outcome.classes.filter((cls) => ((App.counselMetaByTask[taskId]?.warningsByClass || {})[cls] || []).length > 0).length;
          toast(outcome.contactFailures.length
            ? `연락처 ${classCount - outcome.contactFailures.length}/${classCount}개 반 새로고침 · 실패 ${outcome.contactFailures.length}개 반`
            : warnedClassCount
              ? `학생 로스터 ${classCount}개 반 동기화 완료 · 연락처 경고 ${warnedClassCount}개 반`
              : `학생 로스터 ${classCount}개 반 동기화를 완료했습니다.`);
          return outcome.contactFailures.length === 0;
        } catch (error: any) {
          // prepare 실패 — 기존 캐시(학생/전화번호/반 목록)를 절대 지우지 않고 그대로 둔다. 재시도를 위해 버튼은 계속 노출된다.
          progress.stage = 'prepare';
          progress.status = 'failed';
          progress.message = String(error?.message || error || '학생 명단을 확인하지 못했습니다.');
          render();
          toast('학생 명단 확인 실패 — 기존 로스터는 그대로 유지됩니다: ' + progress.message);
          return false;
        }
      } finally {
        inflight.delete(lockKey);
      }
    };
    // 상담 전송 모달 열기 — 저장 확인 대기(deliveryPending) 항목은 재전송 모달을 열지 않는다.
    // returnModal(선택): 상담 현황에서 진입한 경우 취소/닫기·전송 완료 시 복귀할 모달 페이로드.
    App.openCounselSend = function (taskId: string, entryId: string, returnModal?: any) {
      const e = (App.counselByTask[taskId] || []).find((x: any) => x.id === entryId);
      if (!e) return;
      if (e.deliveryPending) {
        toast(e.deliveryMessage || '통통통 전송은 확인됐지만 앱 상태 저장이 지연 중입니다. 재전송하지 말고 「전송 결과 확인」을 눌러 주세요.');
        return;
      }
      App.openModal({ type: 'counselSend', taskId, entryId, student: e.student, phone: e.phone, subject: e.subject || (App.state.tasks || []).find((t: any) => t.id === taskId)?.title || '상담', content: e.content || '', returnModal });
    };
    // '보류/확인 중'으로 안내된 오류 — 실패로 단정해 재전송을 유도하면 같은 상담이 중복 전송될 수 있다.
    const uncertainDelivery = (msg: string) => ['확인하지 못', '다시 전송하지 마', '확인 중', '지연'].some((t) => msg.indexOf(t) >= 0);
    // 전송 결과가 아직 미확정인 응답 — ERP 미확인(state=pending)이든, ERP는 확인됐지만
    // 앱 상태 저장이 지연(persistence=pending)이든 재전송을 막고 「전송 결과 확인」으로 유도한다.
    const counselDeliveryUnresolved = (r: any) => !!(r?.entry?.deliveryPending || r?.delivery?.state === 'pending' || r?.delivery?.persistence === 'pending');
    // 전송을 시작한 편집 모달 닫기 — returnModal(상담 현황 진입)이 있으면 그 현황으로 복귀한다.
    // 완료 시점에 시작 당시 모달이 아니면(이미 닫혔거나 다른 화면) 아무것도 덮어쓰지 않는다 — 늦은 완료의 재열림 방지.
    const closeCounselEditor = (opened: any) => {
      if (!opened || App.ui.modal !== opened) return;
      App.ui.modal = opened.returnModal || null;
    };
    // 주제+내용 그대로 통통통 전송(모달의 동기화 버튼). 성공 시 모달 닫고 목록 갱신.
    // 항목·날짜(taskId/cls/scode/date)를 함께 보내 서버가 어떤 학생·어느 날짜의 상담인지 검증할 수 있게 한다.
    App.sendCounsel = async function (taskId: string, entryId: string, subject: string, content: string) {
      if (!(content || '').trim()) { toast('상담 내용을 입력해 주세요.'); return; }
      const key = 'counsel-write-' + entryId;
      if (inflight.has(key)) return; inflight.add(key); // 연타 즉시 차단 — 같은 항목 중복 전송 방지
      const openedModal = App.ui.modal; // 전송을 시작한 편집 모달 — 완료 시 이 모달이 그대로 열려 있을 때만 닫거나 복귀한다
      App.ui.counselWriting = entryId; render();
      try {
        const e = (App.counselByTask[taskId] || []).find((x: any) => x.id === entryId);
        if (!e) {
          // 항목이 로컬에서 사라짐(로스터 갱신/삭제) — 전송하지 않고 목록만 다시 불러온다. 모달 작성 내용은 유지.
          await App.loadCounselEntries(taskId);
          toast('상담 항목이 갱신되어 목록을 다시 불러왔습니다. 다시 시도해 주세요.');
          return;
        }
        const r = await api.post(`/api/counsel/entry/${entryId}/write`, { taskId, cls: e.cls, scode: e.scode, tid: App.ui.tid, subject, content, date: App.state.today });
        if (r.entry) Object.assign(e, r.entry);
        if (r.state) App.state = r.state;
        refreshCounselProgressFromCache(taskId, e.teacher || App.state.me.name);
        const pending = counselDeliveryUnresolved(r);
        // ERP POST 전에 중단됐음이 증명된 응답(state=retryable/erp=not-sent) — 전송된 적이 없으므로
        // 성공으로 오인하지 않고 행을 미전송(idle)으로 되돌리며, 작성 모달은 열어 둬 명시적 재전송을 유도한다.
        // pending 신호가 함께 온 모순 응답은 pending 우선 — 재전송 유도가 중복 전송으로 이어질 수 있다.
        const notSent = !pending && (r?.delivery?.state === 'retryable' || r?.delivery?.erp === 'not-sent');
        e.deliveryPending = pending;
        if (pending) e.deliveryMessage = r.delivery?.message || e.deliveryMessage || '통통통 전송 결과를 확인 중입니다. 같은 상담을 다시 전송하지 마세요.';
        else if (notSent) e.deliveryMessage = r.delivery?.message || '통통통에는 전송되지 않았습니다. 작성 내용을 확인한 뒤 다시 전송해 주세요.';
        toast(pending
          ? (r.delivery?.message || e.deliveryMessage)
          : notSent
            ? e.deliveryMessage
            : `${(r.entry || {}).student || '학생'} 상담을 통통통에 전송했습니다.`);
        if (!notSent) closeCounselEditor(openedModal);
      } catch (err: any) {
        const msg = String((err && err.message) || err || '');
        // 항목이 사라졌다는 오류면 목록을 다시 불러온다 — 모달과 작성 내용은 그대로 유지.
        if (msg.indexOf('찾을 수 없') >= 0) { try { await App.loadCounselEntries(taskId); } catch { /* noop */ } }
        toast(uncertainDelivery(msg) ? msg : '전송 실패: ' + (msg || '요청을 처리하지 못했습니다.'));
      } finally {
        inflight.delete(key);
        App.ui.counselWriting = null;
        render();
      }
    };
    // 보류(deliveryPending) 상담의 전송 결과 확인 — 상담 본문은 다시 보내지 않고 서버 저장 상태만 재확인한다.
    App.reconcileCounsel = async function (taskId: string, entryId: string) {
      const key = 'counsel-reconcile-' + entryId;
      if (inflight.has(key)) return; inflight.add(key);
      App.ui.counselReconciling = entryId; render();
      try {
        const e = (App.counselByTask[taskId] || []).find((x: any) => x.id === entryId);
        if (!e) {
          await App.loadCounselEntries(taskId);
          toast('상담 항목이 갱신되어 목록을 다시 불러왔습니다. 다시 시도해 주세요.');
          return;
        }
        const r = await api.post(`/api/counsel/entry/${entryId}/reconcile`, { taskId, cls: e.cls, scode: e.scode, tid: App.ui.tid, date: App.state.today });
        if (r && r.entry) Object.assign(e, r.entry);
        if (r && r.state) App.state = r.state;
        refreshCounselProgressFromCache(taskId, e.teacher || App.state.me.name);
        const stillPending = counselDeliveryUnresolved(r);
        // ERP POST 전에 중단됐음이 증명된 시도(erp=not-sent/state=retryable) — 전송된 적이 없으므로
        // 확인 완료로 오인하지 않고 행을 미전송(idle)으로 되돌려 일반 「상담 작성·전송」 버튼을 다시 노출한다.
        // 초안 subject/content는 서버 entry에 보존돼 있어 그대로 유지된다.
        const notSent = !stillPending && (r?.delivery?.state === 'retryable' || r?.delivery?.erp === 'not-sent');
        e.deliveryPending = stillPending;
        if (stillPending) e.deliveryMessage = r?.delivery?.message || e.deliveryMessage || '통통통 전송 결과를 확인 중입니다. 같은 상담을 다시 전송하지 마세요.';
        else if (notSent) e.deliveryMessage = r?.delivery?.message || '통통통에는 전송되지 않았습니다. 작성 내용을 확인한 뒤 다시 전송해 주세요.';
        toast(stillPending
          ? (r?.delivery?.message || e.deliveryMessage || '아직 확인 중입니다 — 재전송하지 말고 잠시 후 다시 확인해 주세요.')
          : notSent
            ? e.deliveryMessage
            : `${e.student || '학생'} 상담 전송이 확인되었습니다 — 완료로 반영했습니다.`);
      } catch (err: any) {
        const msg = String((err && err.message) || err || '');
        // 항목이 사라졌거나(409/400) 목록 새로고침을 안내한 오류면 그 업무의 상담 목록을 다시 불러온다.
        if (msg.indexOf('찾을 수 없') >= 0 || msg.indexOf('새로고침') >= 0) { try { await App.loadCounselEntries(taskId); } catch { /* noop */ } }
        toast('전송 결과 확인 실패: ' + (msg || '요청을 처리하지 못했습니다.'));
      } finally {
        inflight.delete(key);
        App.ui.counselReconciling = null;
        render();
      }
    };
    // 통통통을 직접 확인한 뒤의 수동 종결 — 자동 확인으로는 끝내 판정되지 않는 전송의 유일한 탈출구다.
    // 'not-sent'는 재전송을 허용할 뿐 이 요청 자체가 통통통에 상담을 보내지는 않는다.
    App.resolveCounselDelivery = async function (taskId: string, entryId: string, resolution: 'not-sent' | 'sent') {
      const e = (App.counselByTask[taskId] || []).find((x: any) => x.id === entryId);
      if (!e) { await App.loadCounselEntries(taskId); toast('상담 항목이 갱신되어 목록을 다시 불러왔습니다.'); return; }
      const confirmText = resolution === 'sent'
        ? `통통통 상담현황조회에서 ${e.student || '이 학생'}의 상담이 저장된 것을 직접 확인하셨나요? 전송 완료로 표시합니다.`
        : `통통통 상담현황조회에서 ${e.student || '이 학생'}의 상담이 없는 것을 직접 확인하셨나요? 확인 없이 재전송하면 학부모에게 상담이 중복 발송될 수 있습니다.`;
      if (!window.confirm(confirmText)) return;
      const key = 'counsel-resolve-' + entryId;
      if (inflight.has(key)) return; inflight.add(key);
      App.ui.counselResolving = entryId; render();
      try {
        const r = await api.post(`/api/counsel/entry/${entryId}/resolve`, {
          taskId, cls: e.cls, scode: e.scode, tid: App.ui.tid, resolution, fingerprint: e.delivery?.fingerprint || '',
        });
        if (r && r.entry) Object.assign(e, r.entry);
        if (r && r.state) App.state = r.state;
        refreshCounselProgressFromCache(taskId, e.teacher || App.state.me.name);
        e.deliveryPending = !!r?.entry?.deliveryPending;
        e.deliveryMessage = r?.delivery?.message || e.deliveryMessage || '';
        toast(r?.delivery?.message || (resolution === 'sent' ? '전송 완료로 표시했습니다.' : '다시 전송할 수 있습니다.'));
      } catch (err: any) {
        const msg = String((err && err.message) || err || '');
        if (msg.indexOf('찾을 수 없') >= 0 || msg.indexOf('새로고침') >= 0) { try { await App.loadCounselEntries(taskId); } catch { /* noop */ } }
        toast('처리 실패: ' + (msg || '요청을 처리하지 못했습니다.'));
      } finally {
        inflight.delete(key);
        App.ui.counselResolving = null;
        render();
      }
    };
    // returnModal(선택): 상담 현황에서 진입한 경우 취소/닫기·전송 완료 시 복귀할 모달 페이로드.
    App.openCounselAbsence = function (taskId: string, entryId: string, returnModal?: any) {
      const entry = (App.counselByTask[taskId] || []).find((item: any) => item.id === entryId);
      if (!entry) return;
      const pending = (entry.absenceAttempts || []).find((attempt: any) => attempt.deliveryPending);
      if (pending) {
        toast(pending.deliveryMessage || '이 학생의 부재/문자 전송 결과를 확인 중입니다. 새 기록을 만들기 전에 결과를 확인해 주세요.');
        return;
      }
      App.openModal({
        type: 'counselAbsence', taskId, entryId,
        student: entry.student, phone: entry.phone, content: '',
        requestId: 'absence-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2),
        returnModal,
      });
    };
    App.sendCounselAbsence = async function (taskId: string, entryId: string, content: string, requestId: string) {
      if (!(content || '').trim()) { toast('부재/문자 내용을 입력해 주세요.'); return false; }
      const key = 'counsel-absence-' + entryId;
      if (inflight.has(key)) return false;
      inflight.add(key);
      const openedModal = App.ui.modal; // 전송을 시작한 편집 모달 — 완료 시 이 모달이 그대로 열려 있을 때만 닫거나 복귀한다
      App.ui.counselAbsenceWriting = entryId; render();
      try {
        const entry = (App.counselByTask[taskId] || []).find((item: any) => item.id === entryId);
        if (!entry) {
          await App.loadCounselEntries(taskId);
          toast('상담 항목이 갱신되어 목록을 다시 불러왔습니다. 다시 시도해 주세요.');
          return false;
        }
        const r = await api.post(`/api/counsel/entry/${entryId}/absence`, {
          taskId, teacher: entry.teacher, cls: entry.cls, scode: entry.scode,
          tid: App.ui.tid, content, requestId, date: App.state.today,
        });
        if (Array.isArray(r.entries)) {
          const others = (App.counselByTask[taskId] || []).filter((item: any) => item.cls !== entry.cls);
          App.counselByTask[taskId] = others.concat(r.entries);
        }
        if (r.state) App.state = r.state;
        refreshCounselProgressFromCache(taskId, entry.teacher || App.state.me.name);
        const pending = counselDeliveryUnresolved(r);
        const notSent = !pending && (r?.delivery?.state === 'retryable' || r?.delivery?.erp === 'not-sent');
        toast(pending
          ? (r?.delivery?.message || '부재/문자 전송 결과를 확인 중입니다. 다시 전송하지 마세요.')
          : notSent
            ? (r?.delivery?.message || '통통통에는 전송되지 않았습니다. 내용을 확인한 뒤 다시 시도해 주세요.')
            : `${entry.student || '학생'} 부재/문자 기록을 통통통에 전송했습니다.`);
        if (!notSent) closeCounselEditor(openedModal);
        return !notSent;
      } catch (err: any) {
        const msg = String(err?.message || err || '');
        toast(uncertainDelivery(msg) ? msg : '부재/문자 전송 실패: ' + (msg || '요청을 처리하지 못했습니다.'));
        return false;
      } finally {
        inflight.delete(key);
        App.ui.counselAbsenceWriting = null;
        render();
      }
    };
    App.reconcileCounselAbsence = async function (taskId: string, attemptId: string) {
      const key = 'counsel-absence-reconcile-' + attemptId;
      if (inflight.has(key)) return false;
      inflight.add(key);
      App.ui.counselAbsenceReconciling = attemptId; render();
      try {
        const entries = App.counselByTask[taskId] || [];
        const owner = entries.find((entry: any) => (entry.absenceAttempts || []).some((attempt: any) => attempt.id === attemptId));
        if (!owner) {
          await App.loadCounselEntries(taskId);
          toast('부재 상담 기록이 갱신되어 목록을 다시 불러왔습니다.');
          return false;
        }
        const r = await api.post(`/api/counsel/absence/${attemptId}/reconcile`, { tid: App.ui.tid });
        if (Array.isArray(r.entries)) {
          const others = entries.filter((entry: any) => entry.cls !== owner.cls);
          App.counselByTask[taskId] = others.concat(r.entries);
        }
        if (r.state) App.state = r.state;
        refreshCounselProgressFromCache(taskId, owner.teacher || App.state.me.name);
        const pending = counselDeliveryUnresolved(r);
        const notSent = !pending && (r?.delivery?.state === 'retryable' || r?.delivery?.erp === 'not-sent');
        toast(pending
          ? (r?.delivery?.message || '아직 부재/문자 전송 결과를 확인 중입니다.')
          : notSent
            ? (r?.delivery?.message || '전송 전 중단된 기록을 정리했습니다. 다시 작성해 주세요.')
            : `${owner.student || '학생'} 부재/문자 전송이 확인되었습니다.`);
        return !pending && !notSent;
      } catch (err: any) {
        toast('부재/문자 결과 확인 실패: ' + (err?.message || err || '요청을 처리하지 못했습니다.'));
        return false;
      } finally {
        inflight.delete(key);
        App.ui.counselAbsenceReconciling = null;
        render();
      }
    };
    App.syncNotebooks = async function () {
      const w = App.ui.wizard, cls = App.todayClasses();
      const date = App.reportDate();
      w.nbSync = 'loading'; render();
      for (const c of cls) {
        try {
          const nb = await api.get(`/api/ttt/notebook?cls=${encodeURIComponent(c)}&date=${date}&tid=${encodeURIComponent(App.ui.tid)}`);
          w.nbByClass[c] = { written: nb.written, editing: !nb.written, title: nb.title, body: nb.body, files: nb.files || [], titleDraft: nb.title || `${koDate(date)} ${c} 알림장`, bodyDraft: nb.body || '', source: nb.source, live: nb._live, cmtId: nb.cmtId || null, urlDrafts: [], imageDrafts: [], fileDrafts: [] };
        } catch { w.nbByClass[c] = { written: false, editing: true, title: '', body: '', files: [], titleDraft: `${koDate(date)} ${c} 알림장`, bodyDraft: '', urlDrafts: [], imageDrafts: [], fileDrafts: [] }; }
      }
      w.nbSync = 'done'; App.markDirty(); render();
    };
    App.postNotebook = async function (cls: string) {
      const w = App.ui.wizard, b = w.nbByClass[cls];
      if (b.posting) return; // 게시 중엔 연타 무시
      if (!(b.titleDraft || '').trim() || !(b.bodyDraft || '').trim()) return toast('제목과 내용을 입력해 주세요.');
      b.posting = true; render();
      try {
        const attach = { urls: b.urlDrafts || [], images: b.imageDrafts || [], files: b.fileDrafts || [] };
        const nb = await api.post('/api/ttt/notebook', { cls, date: App.reportDate(), title: b.titleDraft, body: b.bodyDraft, cmtId: b.cmtId || null, tid: App.ui.tid, attach });
        const wasEdit = !!b.cmtId;
        w.nbByClass[cls] = { written: true, editing: false, title: nb.title, body: nb.body, files: nb.files || [], source: nb.source, live: nb._live, cmtId: nb.cmtId || b.cmtId || null, urlDrafts: [], imageDrafts: [], fileDrafts: [] };
        toast(nb._live ? (wasEdit ? '통통통 알림장을 수정했습니다.' : '통통통에 게시되었습니다.') : '게시되었습니다 (목업).');
      } catch (e: any) { toast('게시 오류: ' + e.message); b.posting = false; }
      App.markDirty(); render();
    };
    App.setOtherNotebookDate = function (date: string) {
      if (App.ui.otherNotebookDate === date) return;
      App.ui.otherNotebookDate = date;
      App.ui.otherNotebook = { nbByClass: {}, nbSync: 'idle' };
      render();
    };
    App.syncOtherNotebooks = async function () {
      const notebook = App.ui.otherNotebook || (App.ui.otherNotebook = { nbByClass: {}, nbSync: 'idle' });
      const classes = (App.otherTeamRoster?.classes || []).map((cls: any) => cls.className).filter(Boolean);
      const date = App.ui.otherNotebookDate || App.state.today;
      notebook.nbSync = 'loading'; render();
      for (const cls of classes) {
        try {
          const nb = await api.get(`/api/ttt/notebook?cls=${encodeURIComponent(cls)}&date=${date}&tid=${encodeURIComponent(App.ui.tid)}`);
          notebook.nbByClass[cls] = {
            written: nb.written, editing: !nb.written, title: nb.title, body: nb.body, files: nb.files || [],
            titleDraft: nb.title || `${koDate(date)} ${cls} 알림장`, bodyDraft: nb.body || '', source: nb.source,
            live: nb._live, cmtId: nb.cmtId || null, urlDrafts: [], imageDrafts: [], fileDrafts: [],
          };
        } catch {
          notebook.nbByClass[cls] = {
            written: false, editing: true, title: '', body: '', files: [],
            titleDraft: `${koDate(date)} ${cls} 알림장`, bodyDraft: '',
            urlDrafts: [], imageDrafts: [], fileDrafts: [],
          };
        }
      }
      notebook.nbSync = 'done'; render();
    };
    App.postOtherNotebook = async function (cls: string) {
      const notebook = App.ui.otherNotebook;
      const entry = notebook?.nbByClass?.[cls];
      if (!entry || entry.posting) return;
      if (!(entry.titleDraft || '').trim() || !(entry.bodyDraft || '').trim()) return toast('제목과 내용을 입력해 주세요.');
      entry.posting = true; render();
      try {
        const date = App.ui.otherNotebookDate || App.state.today;
        const attach = { urls: entry.urlDrafts || [], images: entry.imageDrafts || [], files: entry.fileDrafts || [] };
        const nb = await api.post('/api/ttt/notebook', {
          cls, date, title: entry.titleDraft, body: entry.bodyDraft,
          cmtId: entry.cmtId || null, tid: App.ui.tid, attach,
        });
        const wasEdit = !!entry.cmtId;
        notebook.nbByClass[cls] = {
          written: true, editing: false, title: nb.title, body: nb.body, files: nb.files || [],
          source: nb.source, live: nb._live, cmtId: nb.cmtId || entry.cmtId || null,
          urlDrafts: [], imageDrafts: [], fileDrafts: [],
        };
        toast(nb._live ? (wasEdit ? '통통통 알림장을 수정했습니다.' : '통통통에 게시되었습니다.') : '게시되었습니다 (목업).');
      } catch (e: any) {
        toast('게시 오류: ' + e.message);
        entry.posting = false;
      }
      render();
    };
    App.wizMark = function (id: string, status: string) {
      const w = App.ui.wizard;
      w.myStatus[id] = status; App.markDirty(); render();
      (async () => {
        try { const r = await api.post(`/api/tasks/${id}/status`, { teacher: App.state.me.name, status }); if (r && r.state) { App.state = r.state; App.ui.wizard = w; render(); } else await App.reloadKeepWizard(); }
        catch (e: any) { toast('오류: ' + e.message); w.myStatus[id] = status === 'done' ? 'undone' : 'done'; render(); }
      })();
    };
    App.reloadKeepWizard = async function () {
      const w = App.ui.wizard;
      App.state = await api.get(`/api/state?role=${App.ui.role}&tid=${encodeURIComponent(App.ui.tid)}`);
      App.ui.wizard = w; render();
    };
    App.wizardPayload = function () {
      const w = App.ui.wizard;
      const classSnapshot = Array.isArray(w.classSnapshot) ? w.classSnapshot.slice() : App.classesForDate(App.reportDate(), App.state.me);
      return { cl: w.cl, nbByClass: w.nbByClass, nbSync: w.nbSync, counselOk: w.counselOk, attOk: w.attOk, myStatus: w.myStatus, classSnapshot, specialPeriod: !!w.specialPeriod, nb: classSnapshot.filter((c: string) => (w.nbByClass[c] || {}).written).length };
    };
    App.saveDraft = function () { App.ui.wizard.dirty = true; act(async () => api.post(`/api/reports/${encodeURIComponent(App.state.me.name)}/${App.reportDate()}/draft`, { payload: App.wizardPayload() }), '임시저장되었습니다.', undefined, 'draft'); };
    App.submitWizard = function () {
      const name = App.state.me.name;
      if (inflight.has('submit')) return; inflight.add('submit'); // 연타로 이중 제출 방지
      (async () => {
        try {
          const r = await api.post(`/api/reports/${encodeURIComponent(name)}/${App.reportDate()}/submit`, { payload: App.wizardPayload() });
          App.state = (r && r.state) ? r.state : await api.get(`/api/state?role=${App.ui.role}&tid=${encodeURIComponent(App.ui.tid)}`);
          App.ui.wizard.view = 'submitted'; render();
        } catch (e: any) { toast('제출 오류: ' + e.message); }
        finally { inflight.delete('submit'); }
      })();
    };

    ref.current = App;
  }

  const App = ref.current;
  useEffect(() => { App.boot(); /* mount once */ }, []); // eslint-disable-line

  return <AppContext.Provider value={{ App, v: undefined }}>{children}</AppContext.Provider>;
}
