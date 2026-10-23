import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from '@/lib/state';
import { Btn, Card, Field, Logo } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { LeadDash } from '@/components/screens/LeadDash';
import { LeadTasks } from '@/components/screens/LeadTasks';
import { LeadJournal } from '@/components/screens/LeadJournal';
import { LeadMapping } from '@/components/screens/LeadMapping';
import { LeadNotice } from '@/components/screens/LeadNotice';
import { LeadUtility } from '@/components/screens/LeadUtility';
import { TeacherDash } from '@/components/screens/TeacherDash';
import { TeacherTasks } from '@/components/screens/TeacherTasks';
import { TeacherLog } from '@/components/screens/TeacherLog';
import { Wizard } from '@/components/screens/Wizard';
import { OtherTeamClasses } from '@/components/screens/OtherTeamClasses';
import { TeacherClassManager } from '@/components/screens/TeacherClassManager';
import { OtherTeamCounsel } from '@/components/screens/OtherTeamCounsel';
import { OtherTeamNotebook } from '@/components/screens/OtherTeamNotebook';
import { ModalHost } from '@/components/modals/ModalHost';

export default function AppRoot() {
  return (
    <AppProvider>
      <Main />
    </AppProvider>
  );
}

function Main() {
  const { App } = useApp();
  if (!App.session) return <Login />;
  if (!App.state) return <Splash />;
  return <Shell />;
}

function Splash() {
  const { App } = useApp();
  const error = App.ui?.bootError;
  return (
    <div className="splash">
      <img src="/brand/logo_main.png" alt="업무일지" />
      {error ? (
        <>
          <p className="muted" style={{ maxWidth: 360, textAlign: 'center', fontSize: 13, lineHeight: 1.6 }}>{error}</p>
          <Btn variant="secondary" onClick={() => App.logout()}>다시 로그인</Btn>
        </>
      ) : (
        <>
          <div className="spinner" />
          <p className="muted" style={{ fontSize: 13 }}>불러오는 중…</p>
        </>
      )}
    </div>
  );
}

function Login() {
  const { App } = useApp();
  const [id, setId] = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('npr_saved_id') || '' : ''));
  const [pw, setPw] = useState('');
  const [remember, setRemember] = useState(() => (typeof window !== 'undefined' ? !!localStorage.getItem('npr_saved_id') : false));
  const [err, setErr] = useState('');
  const doLogin = async () => {
    try {
      await App.login(id, pw);
      if (typeof window !== 'undefined') {
        if (remember) localStorage.setItem('npr_saved_id', id);
        else localStorage.removeItem('npr_saved_id');
      }
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}><Logo size="lg" /></div>
        <Card emphasis>
          <div className="col" style={{ gap: 16 }}>
            <div style={{ textAlign: 'center', marginBottom: 2 }}>
              <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>로그인</h1>
              <p className="muted" style={{ fontSize: 13 }}>계정으로 로그인해 주세요.</p>
            </div>
            <Field label="아이디" required placeholder="예: admin 또는 lee.he" value={id} onInput={setId} onEnter={doLogin} />
            <Field label="비밀번호" required type="password" placeholder="비밀번호 입력" value={pw} onInput={setPw} error={err} onEnter={doLogin} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted-foreground)', cursor: 'pointer', userSelect: 'none', marginTop: -4 }}>
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--primary)', cursor: 'pointer' }} />
              아이디 기억하기
            </label>
            <Btn variant="primary" size="lg" full onClick={doLogin}>로그인</Btn>
          </div>
        </Card>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="demo-chip" onClick={() => { setId('admin'); setPw('1234'); }}>팀장 데모 · admin / 1234</button>
          <button type="button" className="demo-chip" onClick={() => { setId('lee.he'); setPw('1234'); }}>강사 데모 · lee.he / 1234</button>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const { App } = useApp();
  const S = App.state, u = App.ui, isLead = u.role === 'lead', isOther = u.role === 'other';
  const sess = App.session;
  const availableRoles = sess ? [sess.canLead && 'lead', sess.isTeacher && 'teacher', sess.canOtherTeam && 'other'].filter(Boolean) : [];
  const canSwitch = availableRoles.length > 1;
  useEffect(() => { document.documentElement.classList.toggle('dark', !!u.dark); }, [u.dark]);

  const leadNav: [string, string][] = [['대시보드', 'dashboard'], ['업무', 'tasks'], ['일일보고', 'journal'], ['강사 현황', 'mapping'], ['공지사항', 'notice'], ['유틸리티', 'utility']];
  const teacherNav: [string, string][] = [['대시보드', 'dash'], ['내 업무', 'tasks'], ['일일보고', 'log'], ['반 관리', 'classes']];
  const otherNav: [string, string][] = [['본인 반 관리', 'classes'], ['상담일정', 'counsel'], ['알림장', 'notebook']];
  const nav = isLead ? leadNav : isOther ? otherNav : teacherNav;

  let screen: React.ReactNode = null;
  if (isLead) {
    screen = ({ dashboard: <LeadDash />, tasks: <LeadTasks />, journal: <LeadJournal />, mapping: <LeadMapping />, notice: <LeadNotice />, utility: <LeadUtility /> } as any)[u.page];
  } else if (isOther) {
    screen = ({ classes: <OtherTeamClasses />, counsel: <OtherTeamCounsel />, notebook: <OtherTeamNotebook /> } as any)[u.page];
  } else if (u.page === 'log' && u.logMode === 'wizard') {
    screen = <Wizard />;
  } else {
    screen = ({ dash: <TeacherDash />, tasks: <TeacherTasks />, log: <TeacherLog />, classes: <TeacherClassManager /> } as any)[u.page];
  }

  const activeNotices = !isLead ? (S.notices || []).filter((n: any) => n.active) : [];

  return (
    <>
      <header className="hdr">
        <div className="hdr-in">
          <Logo size="sm" />
          <nav className="nav">
            {nav.map(([label, key]) => (
              <button
                key={key}
                type="button"
                className={'nav-item' + (u.page === key ? ' on' : '')}
                aria-current={u.page === key ? 'page' : undefined}
                onClick={() => App.go(key)}
              >{label}</button>
            ))}
          </nav>
          <span className="grow" />
          {canSwitch ? (
            <div className="seg" role="group" aria-label="화면 전환" title="부여된 권한의 화면으로 전환합니다">
              {sess.canLead ? <button type="button" aria-pressed={u.role === 'lead'} className={u.role === 'lead' ? 'on' : ''} onClick={() => App.switchRole('lead')}>팀장</button> : null}
              {sess.isTeacher ? <button type="button" aria-pressed={u.role === 'teacher'} className={u.role === 'teacher' ? 'on' : ''} onClick={() => App.switchRole('teacher')}>강사</button> : null}
              {sess.canOtherTeam ? <button type="button" aria-pressed={u.role === 'other'} className={u.role === 'other' ? 'on' : ''} onClick={() => App.switchRole('other')}>다른 팀</button> : null}
            </div>
          ) : null}
          {isLead ? <span className="hdr-task-create"><Btn variant="primary" size="sm" onClick={() => App.openTaskCreate()}><span className="hdr-task-long">+ 업무 생성</span><span className="hdr-task-short">+ 업무</span></Btn></span> : null}
          <button className="icon-btn" title="다크 모드" onClick={() => App.setDark(!u.dark)}>{u.dark ? '☀️' : '🌙'}</button>
          <div className="row hdr-user" style={{ gap: 8, flex: 'none' }}>
            <div className="avatar">{(S.me.name || '?').slice(0, 1)}</div>
            <div className="hdr-user-name" style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{S.me.name}</div>
          </div>
          <Btn variant="ghost" size="sm" onClick={() => App.logout()}>로그아웃</Btn>
        </div>
      </header>

      {activeNotices.length ? (
        <div className="banner">
          <div className="banner-in">
            {activeNotices.map((n: any) => (
              <div className="banner-row" key={n.id}>
                <span className="badge brand">공지</span>
                <div className="txt"><Markdown text={n.text} /></div>
                <span className="banner-date">{n.meta}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <main className="app-main">
        {isOther ? (
          <div className="other-context">
            <span className="badge info">다른 팀</span>
            <span className="txt">일일보고 대상이 아닙니다 — 강사 현황에서 관리되는 편의 기능 전용 계정으로, 본인 반 관리·상담일정·알림장만 사용합니다.</span>
          </div>
        ) : null}
        {screen}
      </main>
      <ModalHost />
    </>
  );
}
