import React, { useEffect } from 'react';
import { useApp } from '@/lib/state';
import { Btn, Field } from '@/components/ui';
import { PageTitle } from '@/components/screens/shared';
import { NotebookWorkspace } from '@/components/screens/NotebookWorkspace';

export function OtherTeamNotebook() {
  const { App } = useApp();
  const S = App.state, u = App.ui;
  useEffect(() => {
    if (!u.otherNotebookDate) u.otherNotebookDate = S.today;
    if (!App.otherTeamRoster && !u.otherRosterLoading) App.loadOtherTeamRoster();
  }, []);
  const date = u.otherNotebookDate || S.today;
  const classes = (App.otherTeamRoster?.classes || []).map((cls: any) => cls.className).filter(Boolean);
  const notebook = u.otherNotebook || (u.otherNotebook = { nbByClass: {}, nbSync: 'idle' });

  return (
    <div>
      <PageTitle
        title="알림장"
        cap="일일보고 없이 매일 바로 작성"
        action={<div className="page-hd-date"><Field label="작성일" type="date" value={date} onInput={(value) => App.setOtherNotebookDate(value)} /></div>}
      />
      <NotebookWorkspace
        title="반별 알림장"
        date={date}
        classes={classes}
        state={notebook}
        onSync={() => App.syncOtherNotebooks()}
        onPost={(className) => App.postOtherNotebook(className)}
        onRender={() => App.render()}
        emptyMessage={u.otherRosterLoading
          ? '본인 반 명단을 불러오는 중…'
          : u.otherRosterError
            ? `${u.otherRosterError} · 「본인 반 관리」에서 다시 시도해 주세요.`
            : '담당 반이 없습니다 — 먼저 「본인 반 관리」에서 사용할 반과 학생 명단을 적용해 주세요.'}
        emptyAction={!u.otherRosterLoading ? <Btn variant="primary" size="sm" onClick={() => App.go('classes')}>본인 반 관리로 이동</Btn> : null}
        intro="본인 반 관리에서 선택한 모든 담당 반의 알림장을 날짜별로 조회·작성합니다."
      />
    </div>
  );
}
