import React, { useState } from 'react';
import { useApp } from '@/lib/state';
import { Btn, Card, Badge } from '@/components/ui';
import { Markdown, MarkdownEditor } from '@/components/Markdown';

export function LeadNotice() {
  const { App } = useApp();
  const S = App.state, u = App.ui;
  const editing = !!u.noticeEditId;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const ids = S.notices.map((x: any) => x.id);
    const from = ids.indexOf(dragId), to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { setDragId(null); setOverId(null); return; }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    App.reorderNotices(ids);
    setDragId(null); setOverId(null);
  };

  const formCard = (
    <Card title={editing ? '공지 수정' : '새 공지 작성'}>
      <div className="col" style={{ gap: 16 }}>
        <MarkdownEditor
          key={'nf-' + (u.noticeFormKey || 0)}
          label="공지 내용"
          required
          rows={3}
          placeholder="예: 7월 19일(일) 대입설명회 리허설 — 전 강사 13:00까지 집합"
          defaultValue={u.noticeDraft || ''}
          onInput={(v) => { u.noticeDraft = v; }}
          hint="입력하면 바로 서식 적용(‘# ’ 제목 · ‘- ’ 목록 · **굵게**) · 게시하면 즉시 강사 화면 상단에 노출됩니다."
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          {editing ? <Btn variant="secondary" onClick={() => { u.noticeEditId = null; u.noticeDraft = ''; u.noticeFormKey = (u.noticeFormKey || 0) + 1; App.render(); }}>취소</Btn> : null}
          <Btn variant="primary" onClick={() => App.publishNotice(u.noticeDraft, u.noticeEditId)}>{editing ? '수정 저장' : '공지 게시'}</Btn>
        </div>
      </div>
    </Card>
  );

  const listCard = (
    <Card flush title="공지 목록" action={<Badge tone="neutral">{`${S.notices.length}건 · 위에서 노출`}</Badge>}>
      {S.notices.length ? (
        <p className="cap" style={{ padding: '8px 20px 0', margin: 0 }}>≡ 을 잡고 끌어 노출 순서를 바꿀 수 있습니다 (위가 먼저 노출).</p>
      ) : null}
      {S.notices.map((n: any) => (
        <div key={n.id}
          onDragOver={(e) => { e.preventDefault(); if (overId !== n.id) setOverId(n.id); }}
          onDrop={(e) => { e.preventDefault(); dropOn(n.id); }}
          style={{ display: 'flex', gap: 10, padding: '14px 20px', borderBottom: '1px solid var(--border)', opacity: dragId === n.id ? 0.4 : n.active ? undefined : 0.6, background: overId === n.id && dragId && dragId !== n.id ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : undefined }}>
          <span
            draggable
            onDragStart={() => setDragId(n.id)}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            title="끌어서 순서 변경"
            style={{ cursor: 'grab', color: 'var(--muted-foreground)', fontSize: 16, lineHeight: '1.4', userSelect: 'none', flex: 'none', paddingTop: 1 }}
          >≡</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
            <Markdown text={n.text} style={{ fontSize: 14, lineHeight: 1.6 }} />
            <div className="row">
              <Badge tone={n.active ? 'success' : 'neutral'} icon={n.active ? '✓' : ''}>{n.active ? '노출 중' : '숨김'}</Badge>
              <span className="muted" style={{ fontSize: 12 }}>{`${n.meta} · ${n.author}`}</span>
              <span className="grow" />
              <Btn variant="subtle" size="sm" onClick={() => App.toggleNotice(n)}>{n.active ? '숨기기' : '노출하기'}</Btn>
              <Btn variant="secondary" size="sm" onClick={() => { u.noticeEditId = n.id; u.noticeDraft = n.text; u.noticeFormKey = (u.noticeFormKey || 0) + 1; App.render(); }}>수정</Btn>
              <Btn variant="ghost" size="sm" onClick={() => App.deleteNotice(n.id)}>삭제</Btn>
            </div>
          </div>
        </div>
      ))}
    </Card>
  );

  return (
    <div style={{ maxWidth: 680 }}>
      <h1 className="page-title" style={{ marginBottom: 6 }}>공지사항</h1>
      <p className="cap" style={{ marginBottom: 20 }}>강사의 모든 화면 상단에 노출됩니다 — 여러 건을 등록하고 건별로 노출을 관리해 주세요.</p>
      {formCard}
      <div style={{ height: 16 }} />
      {listCard}
    </div>
  );
}
