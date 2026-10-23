import React, { useState } from 'react';
import { useApp } from '@/lib/state';
import { Btn, Card, Badge, Field, Toggle } from '@/components/ui';
import { groupOf, isSpecialJournal, toast } from '@/lib/helpers';
import { TeacherClassManager } from '@/components/screens/TeacherClassManager';

export function LeadMapping() {
  const { App } = useApp();
  const S = App.state, u = App.ui;
  if (!u.tSel) u.tSel = S.teachers[0]?.tid;
  const selected = S.teachers.find((teacher: any) => teacher.tid === u.tSel) || S.teachers[0];
  const dayGroup = groupOf(S.today);

  return (
    <div>
      <h1 className="page-title" style={{ marginBottom: 6 }}>강사 현황</h1>
      <p className="cap" style={{ marginBottom: 20 }}>
        강사를 선택한 뒤 통통통의 전체 담당 반을 불러오고, 실제 사용할 반만 직접 선택합니다. 반명 규칙이나 새 분기 예외 없이 같은 방식으로 관리됩니다.
      </p>
      <div className="feature-grid cols-map">
        <div className="col" style={{ gap: 16 }}>
          <Card flush title="강사 목록" action={<Badge tone="neutral">{`${S.teachers.length}명`}</Badge>}>
            {S.teachers.map((teacher: any) => {
              const legacyClassCount = (teacher.classes['월수금반'] || []).length
                + (teacher.classes['화목토반'] || []).length
                + (teacher.classes['특강 월수금반'] || []).length
                + (teacher.classes['특강 화목토반'] || []).length;
              const classCount = typeof teacher.selectedClassCount === 'number'
                ? teacher.selectedClassCount
                : legacyClassCount;
              const active = selected?.tid === teacher.tid;
              return (
                <button
                  type="button"
                  className={`lrow teacher-list-row${active ? ' sel' : ''}`}
                  key={teacher.tid}
                  aria-pressed={active}
                  onClick={() => { u.tSel = teacher.tid; App.render(); }}
                >
                  <span className="row">
                    <span className="teacher-list-name" title={teacher.name}>{teacher.name}</span>
                    {teacher.isLead ? <Badge tone="brand">팀장</Badge> : null}
                    {teacher.isOtherTeam ? <Badge tone="info">다른 팀</Badge> : null}
                    <span className="muted" style={{ fontSize: 12 }}>{teacher.tid}</span>
                    <span className="grow" />
                    <span className="muted" style={{ fontSize: 12 }}>
                      {teacher.isOtherTeam ? `편의 기능 · ${classCount}개 반` : `담당 ${classCount}개 반`}
                    </span>
                  </span>
                </button>
              );
            })}
          </Card>
          <RegisterForm />
        </div>
        {selected
          ? <TeacherDetail key={selected.tid} teacher={selected} dayGroup={dayGroup} />
          : <Card><div className="dashed-box">등록된 강사가 없습니다.</div></Card>}
      </div>
    </div>
  );
}

function RegisterForm() {
  const { App } = useApp();
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const submit = () => {
    if (!name.trim() || !id.trim() || !password.trim()) {
      toast('이름·아이디·비밀번호를 모두 입력해 주세요.');
      return;
    }
    App.createTeacher({ name, tid: id, pw: password }, () => {
      setName(''); setId(''); setPassword('');
    });
  };
  return (
    <Card title="강사 등록">
      <div className="col" style={{ gap: 14 }}>
        <Field label="이름" required placeholder="예: 서지우" value={name} onInput={setName} />
        <Field label="아이디" required placeholder="예: seo.jw" value={id} onInput={setId} />
        <Field label="비밀번호" required type="password" placeholder="초기 비밀번호" value={password} onInput={setPassword} hint="등록 후 강사가 직접 변경할 수 있습니다." />
        <Btn variant="primary" full onClick={submit}>강사 등록</Btn>
      </div>
    </Card>
  );
}

function TeacherDetail({ teacher, dayGroup }: { teacher: any; dayGroup: string | null }) {
  const { App } = useApp();
  const S = App.state;
  const submitted = S.teachers.find((item: any) => item.tid === teacher.tid);
  const [password, setPassword] = useState('');
  const [tttId, setTttId] = useState(teacher.tttId || '');
  const [tttPassword, setTttPassword] = useState('');
  const todayClasses = App.classesForDate(S.today, teacher).join(' · ') || '없음';
  const specialToday = isSpecialJournal(S, S.today);
  const reportLabel = teacher.isOtherTeam
    ? '일일보고 제외'
    : submitted?.todayConfirmed ? '오늘 확인 완료' : submitted?.todaySubmitted ? '오늘 제출' : '오늘 미제출';
  const reportTone = teacher.isOtherTeam
    ? 'info'
    : submitted?.todayConfirmed ? 'success' : submitted?.todaySubmitted ? 'warning' : 'destructive';

  return (
    <Card>
      <div className="col" style={{ gap: 16 }}>
        <div className="row detail-hd">
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{teacher.name}</h2>
          <Badge tone="brand">{teacher.tid}</Badge>
          {teacher.isOtherTeam ? <Badge tone="info">다른 팀</Badge> : null}
          <span className="grow" />
          <Badge tone={reportTone} icon={!teacher.isOtherTeam && submitted?.todaySubmitted ? '✓' : ''}>{reportLabel}</Badge>
          <Btn variant="ghost" size="sm" onClick={() => App.deleteTeacher(teacher.tid, teacher.name)}>삭제</Btn>
        </div>

        <div className="muted-box teacher-account-grid">
          <span className="muted">아이디</span>
          <strong>{teacher.tid}</strong>
          <span />
          <span className="muted">비밀번호 변경</span>
          <Field type="password" placeholder="새 비밀번호 입력" value={password} onInput={setPassword} />
          <Btn variant="secondary" size="sm" onClick={() => {
            if (password.trim()) App.changePassword(teacher.tid, password, () => setPassword(''));
          }}>변경</Btn>
        </div>

        <section className="teacher-ttt-box">
          <div className="row">
            <strong>통통통 계정</strong>
            {teacher.hasTtt ? <Badge tone="success" icon="✓">연결됨</Badge> : <Badge tone="destructive">미연결</Badge>}
            <span className="grow" />
            <span className="muted" style={{ fontSize: 12 }}>반 조회·알림장 작성 계정</span>
          </div>
          <div className="teacher-ttt-fields">
            <Field placeholder="통통통 아이디" value={tttId} onInput={setTttId} />
            <Field type="password" placeholder={teacher.hasTtt ? '변경 시에만 입력' : '통통통 비밀번호'} value={tttPassword} onInput={setTttPassword} />
            <Btn variant="secondary" onClick={() => {
              if (tttId.trim()) App.saveTtt(teacher.tid, tttId, tttPassword);
            }}>저장</Btn>
          </div>
        </section>

        <section className="col" style={{ gap: 10 }}>
          <span className="section-label">권한</span>
          <Toggle
            boxed
            checked={!!teacher.isLead}
            label="팀장 권한 부여"
            description={teacher.isOtherTeam
              ? '임명하면 로그인 시 팀장 관리 화면으로 시작하고, 다른 팀 편의 화면으로 전환할 수 있습니다. 일일보고 대상에서는 계속 제외됩니다.'
              : '임명하면 로그인 시 팀장 관리 화면을 사용하고, 강사 모드로 전환해 본인 일일보고도 작성할 수 있습니다.'}
            onChange={(enabled) => App.setTeacherLead(teacher.tid, enabled, teacher.name)}
          />
          <Toggle
            boxed
            checked={!!teacher.isOtherTeam}
            label="다른 팀 권한 부여"
            description="체크하면 강사 현황에서는 계속 관리하되 일일보고·제출 통계·공용 업무 배정에서 제외하고, 본인 반 관리·상담일정·알림장 편의 기능만 제공합니다."
            onChange={(enabled) => App.setTeacherOtherTeam(teacher.tid, enabled, teacher.name)}
          />
        </section>

        <section className="teacher-class-section col">
          <span className="section-label">반 현황</span>
          <TeacherClassManager teacherTid={teacher.tid} teacherName={teacher.name} embedded />
        </section>

        <div className="row teacher-today-summary">
          <Badge tone="brand">오늘</Badge>
          {specialToday ? <Badge tone="brand" icon="✦">특강기간</Badge> : null}
          <span className="muted">
            {`${S.todayLabel.replace(/^\d+년 /, '')} · ${dayGroup || '해당 없음'}${specialToday ? ' + 특강' : ''} 적용 — ${teacher.name} 담당: `}
            <b>{todayClasses}</b>
          </span>
        </div>
      </div>
    </Card>
  );
}
