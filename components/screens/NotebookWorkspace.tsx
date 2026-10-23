import React from 'react';
import { Alert, Badge, Btn, Card, DraftField, DraftTextArea } from '@/components/ui';
import { koDate, nextDay, pickFiles } from '@/lib/helpers';

type NotebookState = {
  nbSync: string;
  nbByClass: Record<string, any>;
};

export function NotebookWorkspace(props: {
  title?: string;
  date: string;
  classes: string[];
  state: NotebookState;
  onSync: () => void;
  onPost: (className: string) => void;
  onRender: () => void;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
  intro?: React.ReactNode;
}) {
  const { date, classes, state } = props;
  const written = classes.filter((className) => state.nbByClass[className]?.written).length;
  return (
    <Card title={props.title || '알림장'} action={
      <div className="row" style={{ gap: 8 }}>
        {classes.length > 0 && state.nbSync === 'done' ? <Btn variant="ghost" size="sm" onClick={props.onSync}>↻ 다시 동기화</Btn> : null}
        {classes.length > 0 ? <Badge tone={written === classes.length ? 'success' : 'warning'}>{`${written}/${classes.length}개 반 게시`}</Badge> : null}
      </div>
    }>
      <div className="col" style={{ gap: 14 }}>
        <Alert tone="info">{props.intro || '통통통 알림장(앱관리 과제)과 연동됩니다. 반별 작성 여부를 확인하고 바로 게시하거나 수정할 수 있습니다.'}</Alert>
        <div className="muted-box" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <span className="muted">대상일</span>
          <span style={{ fontWeight: 600 }}>{koDate(date)}</span>
          <span className="muted">담당 반</span>
          <span style={{ fontWeight: 600 }}>{classes.join(' · ') || '없음'}<span className="muted" style={{ fontWeight: 400 }}>{` · ${classes.length}개 반`}</span></span>
          <span className="muted">마감일</span>
          <span style={{ fontWeight: 600 }}>{koDate(nextDay(date))}<span className="muted" style={{ fontWeight: 400 }}> — 다음 날로 자동 지정</span></span>
        </div>

        {!classes.length ? (
          <div className="dashed-box">
            <div className="col" style={{ gap: 10, alignItems: 'center' }}>
              <span>{props.emptyMessage || '담당 반이 없습니다 — 먼저 본인 반 관리에서 사용할 반을 선택해 주세요.'}</span>
              {props.emptyAction || null}
            </div>
          </div>
        ) : state.nbSync !== 'done' ? (
          <div className="nb-sync" aria-live="polite">
            {state.nbSync === 'loading' ? (
              <>
                <span className="spinner" />
                <span className="t">{`${classes.length}개 반 알림장을 확인하는 중…`}</span>
                <span className="muted d">반을 하나씩 순서대로 조회합니다 — 반 수에 따라 잠시 걸릴 수 있습니다.</span>
              </>
            ) : (
              <>
                <span className="t">통통통 동기화가 필요합니다</span>
                <span className="muted d">{`담당 ${classes.length}개 반의 작성 여부를 확인합니다 — 이미 작성된 알림장은 불러와 수정하고, 없으면 새로 작성합니다.`}</span>
                <Btn variant="primary" onClick={props.onSync}>통통통 동기화</Btn>
              </>
            )}
          </div>
        ) : (
          classes.map((className) => (
            <NotebookClassEditor
              key={className}
              classNameValue={className}
              date={date}
              entry={state.nbByClass[className] || (state.nbByClass[className] = freshEntry(date, className))}
              onPost={() => props.onPost(className)}
              onRender={props.onRender}
            />
          ))
        )}
      </div>
    </Card>
  );
}

function freshEntry(date: string, className: string) {
  return {
    written: false, editing: true, title: '', body: '', files: [],
    titleDraft: `${koDate(date)} ${className} 알림장`, bodyDraft: '',
    urlDrafts: [], imageDrafts: [], fileDrafts: [],
  };
}

function NotebookClassEditor(props: {
  classNameValue: string;
  date: string;
  entry: any;
  onPost: () => void;
  onRender: () => void;
}) {
  const { classNameValue: className, date, entry, onRender } = props;
  const head = (
    <div className="row nb-head">
      <Badge tone="brand">{className}</Badge>
      <span className="note">{entry.written ? (entry.source || '통통통에 게시됨') : '작성된 알림장이 없습니다 — 새로 작성해 주세요'}</span>
      <Badge tone={entry.written ? 'success' : 'warning'} icon={entry.written ? '✓' : ''}>{entry.written ? '게시됨' : '미작성'}</Badge>
    </div>
  );

  if (entry.written && !entry.editing) {
    return (
      <div className="nb-class">
        {head}
        <div className="col" style={{ gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{entry.title}</span>
          <p className="nb-body">{entry.body}</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{(entry.files || []).map((file: string, index: number) => <span key={index} className="file-chip">{file}</span>)}</div>
          <div><Btn variant="secondary" size="sm" onClick={() => { entry.editing = true; entry.titleDraft = entry.title; entry.bodyDraft = entry.body; onRender(); }}>수정하기</Btn></div>
        </div>
      </div>
    );
  }

  entry.urlDrafts = entry.urlDrafts || [];
  entry.imageDrafts = entry.imageDrafts || [];
  entry.fileDrafts = entry.fileDrafts || [];
  const chip = (label: string, onRemove: () => void, key: string) => (
    <span key={key} className="file-chip">{label}
      <button type="button" className="chip-x" aria-label={`${label} 첨부 제거`} onClick={onRemove}>✕</button>
    </span>
  );
  const anyAttach = entry.urlDrafts.length || entry.imageDrafts.length || entry.fileDrafts.length;

  return (
    <div className="nb-class">
      {head}
      <div className="col" style={{ gap: 14 }}>
        <DraftField key={className + '-title'} label="제목" required placeholder={`예: ${koDate(date)} 수업 안내`} defaultValue={entry.titleDraft} onInput={(value) => { entry.titleDraft = value; }} />
        <DraftTextArea key={className + '-body'} label="내용" required rows={4} placeholder="수업 내용, 과제, 전달 사항을 입력해 주세요" defaultValue={entry.bodyDraft} onInput={(value) => { entry.bodyDraft = value; }} />
        <div className="col" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <Btn variant="subtle" size="sm" disabled={entry.urlDrafts.length >= 2} onClick={() => { entry.addingUrl = true; onRender(); }}>URL 추가</Btn>
            <Btn variant="subtle" size="sm" disabled={entry.imageDrafts.length >= 5} onClick={() => pickFiles('image/*', true, (files) => { entry.imageDrafts.push(...files); onRender(); })}>이미지 첨부</Btn>
            <Btn variant="subtle" size="sm" disabled={entry.fileDrafts.length >= 2} onClick={() => pickFiles('', true, (files) => { entry.fileDrafts.push(...files); onRender(); })}>파일 첨부</Btn>
          </div>
          {entry.addingUrl ? (
            <div className="row" style={{ gap: 8 }}>
              <div style={{ flex: 1 }}><DraftField key={className + '-url'} placeholder="https:// 링크 주소" defaultValue={entry.urlInput || ''} onInput={(value) => { entry.urlInput = value; }} /></div>
              <Btn variant="secondary" size="md" onClick={() => {
                if (!(entry.urlInput || '').trim()) return;
                entry.urlDrafts.push(entry.urlInput.trim()); entry.urlInput = ''; entry.addingUrl = false; onRender();
              }}>추가</Btn>
            </div>
          ) : null}
          {anyAttach ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {entry.urlDrafts.map((url: string, index: number) => chip('🔗 ' + url, () => { entry.urlDrafts.splice(index, 1); onRender(); }, 'url-' + index))}
              {entry.imageDrafts.map((image: any, index: number) => chip('🖼 ' + image.filename, () => { entry.imageDrafts.splice(index, 1); onRender(); }, 'image-' + index))}
              {entry.fileDrafts.map((file: any, index: number) => chip('📎 ' + file.filename, () => { entry.fileDrafts.splice(index, 1); onRender(); }, 'file-' + index))}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Btn variant="primary" loading={entry.posting} loadingLabel="게시 중..." onClick={props.onPost}>알림장 게시</Btn>
        </div>
      </div>
    </div>
  );
}
