import React from 'react';

// ── Button ──
export function Btn(props: {
  variant?: string; size?: string; full?: boolean; disabled?: boolean; loading?: boolean;
  loadingLabel?: string; onClick?: (e: any) => void; children?: React.ReactNode; type?: 'button' | 'submit';
}) {
  const { variant = 'secondary', size = 'md', full, disabled, loading, loadingLabel, onClick, children, type = 'button' } = props;
  return (
    <button className={`btn ${variant} ${size}${full ? ' full' : ''}`} disabled={disabled || loading} aria-busy={loading || undefined} onClick={onClick} type={type}>
      {loading ? (loadingLabel || '처리 중...') : children}
    </button>
  );
}

// ── Badge ──
export function Badge(props: { tone?: string; icon?: React.ReactNode; children?: React.ReactNode; title?: string }) {
  const { tone = 'neutral', icon, children, title } = props;
  return <span className={`badge ${tone}`} title={title}>{icon ? <span>{icon}</span> : null}{children}</span>;
}

// ── Card ──
export function Card(props: {
  title?: React.ReactNode; action?: React.ReactNode; flush?: boolean; emphasis?: boolean;
  bodyStyle?: React.CSSProperties; children?: React.ReactNode; className?: string;
}) {
  const { title, action, flush, emphasis, bodyStyle, children, className } = props;
  return (
    <div className={`card${flush ? ' flush' : ''}${emphasis ? ' emphasis' : ''}${className ? ' ' + className : ''}`}>
      {(title || action) && (
        <div className="card-hd">
          <h3>{title || ''}</h3>
          <span className="grow" />
          {action || null}
        </div>
      )}
      <div className="card-bd" style={bodyStyle}>{children}</div>
    </div>
  );
}

// ── Stat ──
export function Stat(props: { label: React.ReactNode; value: React.ReactNode; tone?: string; hint?: React.ReactNode }) {
  const { label, value, tone = '', hint } = props;
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className={`value font-display ${tone}`}>{value}</span>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

// ── Field (input) ──  React 제어 컴포넌트: 같은 DOM 노드 재사용 → 한글 IME 안전
// label 없이 배치할 땐 ariaLabel로 접근성 이름을 제공한다.
export function Field(props: {
  label?: React.ReactNode; required?: boolean; type?: string; placeholder?: string;
  value?: string; onInput?: (v: string) => void; error?: string; hint?: string; width?: string;
  inputRef?: React.Ref<HTMLInputElement>; onEnter?: () => void; ariaLabel?: string;
}) {
  const { label, required, type = 'text', placeholder = '', value, onInput, error, hint, width, inputRef, onEnter, ariaLabel } = props;
  return (
    <div className={`field${error ? ' err' : ''}`}>
      {label ? <label>{label}{required ? <span className="req">*</span> : null}</label> : null}
      <input
        ref={inputRef}
        className="inp"
        type={type}
        aria-label={ariaLabel}
        placeholder={placeholder}
        style={width ? { width } : undefined}
        value={value == null ? '' : value}
        onChange={onInput ? (e) => onInput(e.target.value) : undefined}
        onKeyUp={onEnter ? (e) => { if (e.key === 'Enter') onEnter(); } : undefined}
      />
      {error ? <div className="errmsg">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

// 첨부 파일 칩 — 문자열(구버전 파일명) 또는 {name,url}(다운로드 가능). onRemove 주면 ✕ 표시.
export function FileChips({ files, onRemove }: { files: any[]; onRemove?: (i: number) => void }) {
  if (!files || !files.length) return null;
  return (
    <>
      {files.map((f: any, i: number) => {
        const name = typeof f === 'string' ? f : (f?.name || '파일');
        const url = typeof f === 'string' ? null : f?.url;
        return (
          <span className="file-chip" key={'f' + i}>
            {url ? <a href={url} download={name} style={{ color: 'inherit', textDecoration: 'none' }}>{'📎 ' + name}</a> : ('📎 ' + name)}
            {onRemove ? <span style={{ cursor: 'pointer', color: 'var(--muted-foreground)', marginLeft: 2 }} onClick={() => onRemove(i)}>✕</span> : null}
          </span>
        );
      })}
    </>
  );
}

// ── TextArea ──
export function TextArea(props: {
  label?: React.ReactNode; required?: boolean; rows?: number; placeholder?: string;
  value?: string; onInput?: (v: string) => void; hint?: string;
}) {
  const { label, required, rows = 3, placeholder = '', value, onInput, hint } = props;
  return (
    <div className="field">
      {label ? <label>{label}{required ? <span className="req">*</span> : null}</label> : null}
      <textarea className="ta" rows={rows} placeholder={placeholder} value={value == null ? '' : value}
        onChange={onInput ? (e) => onInput(e.target.value) : undefined} />
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

// ── Select ──
export function Select(props: {
  label?: React.ReactNode; required?: boolean; options: (string | { value: string; label: string })[];
  value?: string; onChange?: (v: string) => void; hint?: string;
}) {
  const { label, required, options, value, onChange, hint } = props;
  return (
    <div className="field">
      {label ? <label>{label}{required ? <span className="req">*</span> : null}</label> : null}
      <select className="sel" value={value} onChange={onChange ? (e) => onChange(e.target.value) : undefined}>
        {options.map((op) => {
          const val = typeof op === 'string' ? op : op.value;
          const lab = typeof op === 'string' ? op : op.label;
          return <option key={val} value={val}>{lab}</option>;
        })}
      </select>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

// ── Toggle ── role="switch" + 키보드(Space/Enter) 조작 지원(접근성). disabled면 조작·포커스 불가.
export function Toggle(props: {
  boxed?: boolean; checked?: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; description?: React.ReactNode; disabled?: boolean;
}) {
  const { boxed, checked, onChange, label, description, disabled } = props;
  const fire = () => { if (!disabled) onChange(!checked); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!checked); }
  };
  const a11y = { role: 'switch' as const, 'aria-checked': !!checked, 'aria-disabled': disabled || undefined, tabIndex: disabled ? -1 : 0, onKeyDown };
  if (boxed) {
    return (
      <div className={`tgl-box${checked ? ' on' : ''}${disabled ? ' disabled' : ''}`} onClick={fire} {...a11y}>
        <div className="txt"><div className="t">{label}</div>{description ? <div className="d">{description}</div> : null}</div>
        <span className={`tgl${checked ? ' on' : ''}`}><span className="sw" /></span>
      </div>
    );
  }
  return (
    <div className={`tgl${checked ? ' on' : ''}${disabled ? ' disabled' : ''}`} onClick={fire} {...a11y}>
      <span className="sw" />{label ? <span>{label}</span> : null}
    </div>
  );
}

// ── 상담/특강상담 완료 규칙 (백엔드 counselProg와 일치) ──
// 특강상담: 대상 없음(noTarget) 또는 전원 전송(synced≥total). 일반상담: 대상이 있고(total>0) 전원 전송.
export type CounselProg = { synced?: number; total?: number; noTarget?: boolean; absenceCount?: number; absencePendingCount?: number };
export function counselComplete(prog: CounselProg | undefined, special: boolean): boolean {
  const synced = prog?.synced || 0, total = prog?.total || 0;
  if (special) return !!prog?.noTarget || (total > 0 && synced >= total);
  return total > 0 && synced >= total;
}
// 배지/상태 라벨 — 특강상담 대상 없음이면 '대상 없음', 그 외 '{prefix} x/y'. (전송 0/0로 표기하지 않음)
export function counselCountLabel(prog: CounselProg | undefined, special: boolean, prefix = '전송'): string {
  if (special && prog?.noTarget) return '대상 없음';
  return `${prefix} ${prog?.synced || 0}/${prog?.total || 0}`;
}
// 부재/확인 대기 집계 — 값이 없는 구버전 상태에서도 0으로 안전하게 표시한다.
export function counselAbsenceStats(prog: CounselProg | null | undefined): { absenceCount: number; absencePendingCount: number } {
  return { absenceCount: prog?.absenceCount || 0, absencePendingCount: prog?.absencePendingCount || 0 };
}

// ── 비제어(uncontrolled) 드래프트 입력 — 타이핑 중 재렌더 없음(한글 IME 안전). value는 최초 defaultValue만 반영.
// 값이 외부에서 바뀌어 다시 반영해야 하면 상위에서 key를 바꿔 remount 할 것.
export function DraftField(props: {
  label?: React.ReactNode; required?: boolean; type?: string; placeholder?: string;
  defaultValue?: string; onInput?: (v: string) => void; width?: string;
}) {
  const { label, required, type = 'text', placeholder = '', defaultValue = '', onInput, width } = props;
  return (
    <div className="field">
      {label ? <label>{label}{required ? <span className="req">*</span> : null}</label> : null}
      <input className="inp" type={type} placeholder={placeholder} defaultValue={defaultValue}
        style={width ? { width } : undefined}
        onChange={onInput ? (e) => onInput(e.target.value) : undefined} />
    </div>
  );
}
export function DraftTextArea(props: {
  label?: React.ReactNode; required?: boolean; rows?: number; placeholder?: string;
  defaultValue?: string; onInput?: (v: string) => void;
}) {
  const { label, required, rows = 3, placeholder = '', defaultValue = '', onInput } = props;
  return (
    <div className="field">
      {label ? <label>{label}{required ? <span className="req">*</span> : null}</label> : null}
      <textarea className="ta" rows={rows} placeholder={placeholder} defaultValue={defaultValue}
        onChange={onInput ? (e) => onInput(e.target.value) : undefined} />
    </div>
  );
}

export function Alert(props: { tone?: string; children?: React.ReactNode }) {
  return <div className={`alert ${props.tone || 'info'}`}>{props.children}</div>;
}
export function IconCircle(props: { tone?: string; size?: string; children?: React.ReactNode }) {
  return <span className={`iconcircle ${props.tone || 'success'} ${props.size || 'lg'}`}>{props.children}</span>;
}

// ── 브랜드 로고 (이미지만) ──
export function Logo({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span className={`logo ${size}`}>
      <img className="logo-img" src="/brand/logo_main.png" alt="업무일지" />
    </span>
  );
}
