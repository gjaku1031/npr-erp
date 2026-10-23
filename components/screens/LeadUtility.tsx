import React, { useState } from 'react';
import { useApp } from '@/lib/state';
import { api } from '@/lib/api';
import { Alert, Badge, Btn, Card, Field } from '@/components/ui';
import { PageTitle } from '@/components/screens/shared';

type Step = 1 | 2 | 3 | 4;
type UtilityTool = 'weekly-ppt' | 'unit-ppt' | 'omr';
type UnitMappings = Record<string, string>;
type OutputFormat = 'pptx' | 'pdf';

interface MappingGroup {
  rankGroupKey: string;
  rankGroupLabel: string;
  primaryCourse: string;
  classNames: string[];
}

interface MappingResult {
  filename: string;
  sheetName: string;
  workbookClassCount: number;
  classCount: number;
  studentCount: number;
  groupCount: number;
  groups: MappingGroup[];
}

interface PreviewClass {
  className: string;
  schedule: string;
  examDate: string;
  primaryCourse: string;
  unitName: string;
  examRange: string;
  rankGroupLabel: string;
  studentCount: number;
}

interface PreviewResult {
  classCount: number;
  groupCount: number;
  examSchedule: string;
  classes: PreviewClass[];
}

interface GeneratedResult {
  format: OutputFormat;
  filename: string;
  classCount: number;
  groupCount: number;
  winnerCount: number;
  slideCount: number;
}

const STEPS: Array<{ id: Step; label: string; short: string }> = [
  { id: 1, label: '시험·학생 정보', short: '시험 정보' },
  { id: 2, label: '단원명 입력', short: '단원명' },
  { id: 3, label: '반·범위 확인', short: '범위 확인' },
  { id: 4, label: 'PPT·PDF 생성', short: '파일 생성' },
];

function PresentationIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4.5h16v11H4zM8 19.5l4-4 4 4M12 15.5v4" />
      <path d="M8 12l2.2-2.4 2 1.7L15.5 8l1.5 1.5" />
    </svg>
  );
}

function SpreadsheetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 3.5h8.2l2.8 2.8v14.2h-11z" />
      <path d="M14.5 3.8v3h3M9 10h6M9 13.5h6M9 17h4" />
    </svg>
  );
}

function OmrIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3.5h12v17H6zM9 7h6" />
      <circle cx="9" cy="11" r="1.15" />
      <circle cx="9" cy="15" r="1.15" />
      <circle cx="14" cy="11" r="1.15" />
      <circle cx="14" cy="15" r="1.15" />
    </svg>
  );
}

function FilePicker(props: { file: File | null; onPick: (file: File | null) => void }) {
  return (
    <label className={'weekly-file-picker' + (props.file ? ' has-file' : '')}>
      <input
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => props.onPick(event.target.files?.[0] || null)}
      />
      <span className="weekly-file-icon"><SpreadsheetIcon /></span>
      <span className="weekly-file-copy">
        <strong>{props.file?.name || '학생 목록 Excel'}</strong>
        <small>{props.file ? '반·학생·주과정·교재를 이 파일에서 읽습니다.' : '.xlsx 파일을 선택하세요.'}</small>
      </span>
      <span className="weekly-file-action">{props.file ? '변경' : '선택'}</span>
    </label>
  );
}

function StepNav(props: { step: Step; unlockedStep: Step; onChange: (step: Step) => void }) {
  return (
    <div className="weekly-stepper" role="tablist" aria-label="주간테스트 결과 작업 단계">
      {STEPS.map((item, index) => {
        const active = props.step === item.id;
        const done = props.step > item.id;
        return (
          <React.Fragment key={item.id}>
            <button
              type="button"
              role="tab"
              className={'weekly-step' + (active ? ' on' : '') + (done ? ' done' : '')}
              aria-selected={active}
              disabled={item.id > props.unlockedStep}
              onClick={() => props.onChange(item.id)}
            >
              <span className="weekly-step-num">{done ? '✓' : item.id}</span>
              <span className="weekly-step-label"><span>{item.label}</span><small>{item.short}</small></span>
            </button>
            {index < STEPS.length - 1 ? <span className={'weekly-step-line' + (done ? ' done' : '')} /> : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function PanelHeading({ step, title, description }: { step: Step; title: string; description: string }) {
  return (
    <div className="weekly-panel-heading">
      <div><h3>{title}</h3><p>{description}</p></div>
      <Badge tone="neutral">{`${step}/4`}</Badge>
    </div>
  );
}

function StepOne(props: {
  round: string;
  chapter: string;
  mDate: string;
  tDate: string;
  file: File | null;
  loading: boolean;
  error: string;
  setRound: (value: string) => void;
  setChapter: (value: string) => void;
  setMDate: (value: string) => void;
  setTDate: (value: string) => void;
  setFile: (file: File | null) => void;
  onLoad: () => void;
}) {
  return (
    <Card className="weekly-main-card">
      <PanelHeading step={1} title="시험·학생 정보" description="시험일을 입력하고 최신 학생 목록 Excel 한 개만 선택합니다." />
      <div className="weekly-panel-body">
        <Alert tone="info">반·학생·주과정·교재는 학생 목록 Excel에서 읽습니다. 점수와 우수학생 학교만 파일 생성 시 통통통에서 조회합니다.</Alert>
        {props.error ? <Alert tone="warning">{props.error}</Alert> : null}
        <div className="weekly-form-grid">
          <Field label="회차" required type="number" value={props.round} onInput={props.setRound} hint="예: 4회차" />
          <Field label="시험 단원" required type="number" value={props.chapter} onInput={props.setChapter} hint="PPT에 표시할 단원 번호" />
          <Field label="M반 시험일" required type="date" value={props.mDate} onInput={props.setMDate} />
          <Field label="T반 시험일" required type="date" value={props.tDate} onInput={props.setTDate} />
        </div>
        <div className="weekly-section-title"><h4>기준 자료</h4><span>1개 파일</span></div>
        <div className="weekly-file-grid one-file"><FilePicker file={props.file} onPick={props.setFile} /></div>
        <div className="weekly-source-flow" aria-label="자료 출처">
          <div><Badge tone="brand">반·학생·과정</Badge><strong>학생 목록 Excel</strong><small>업로드한 최신 현황표</small></div>
          <span aria-hidden="true">→</span>
          <div><Badge tone="brand">점수</Badge><strong>통통통 성적조회</strong><small>시험일·반별 실시간 조회</small></div>
          <span aria-hidden="true">→</span>
          <div><Badge tone="brand">학교</Badge><strong>통통통 출결자료</strong><small>우수학생만 추가 조회</small></div>
        </div>
        <div className="weekly-actions">
          <span className="cap">반이 바뀌면 최신 학생 목록 Excel만 다시 선택하면 됩니다.</span>
          <Btn variant="primary" loading={props.loading} loadingLabel="학생 목록 확인 중..." onClick={props.onLoad}>
            반·주과정 불러오기
          </Btn>
        </div>
      </div>
    </Card>
  );
}

function StepTwo(props: {
  catalog: MappingResult;
  mappings: UnitMappings;
  chapter: string;
  loading: boolean;
  error: string;
  onChange: (key: string, value: string) => void;
  onApplySameCourse: (group: MappingGroup) => void;
  onBack: () => void;
  onPreview: () => void;
}) {
  const completed = props.catalog.groups.filter((group) => props.mappings[group.rankGroupKey]?.trim()).length;
  return (
    <Card className="weekly-main-card">
      <PanelHeading step={2} title="단원명 직접 입력" description="Excel에서 읽은 같은 초등 학년·주과정끼리 묶어 단원명만 입력합니다." />
      <div className="weekly-panel-body">
        <Alert tone="success">{`${props.catalog.filename}에서 ${props.catalog.classCount}개 반 · ${props.catalog.studentCount}명 · ${props.catalog.groupCount}개 석차 그룹을 확인했습니다.`}</Alert>
        {props.error ? <Alert tone="warning">{props.error}</Alert> : null}
        <div className="weekly-section-title"><h4>석차 그룹별 단원명</h4><span>{`${completed}/${props.catalog.groupCount} 입력`}</span></div>
        <div className="weekly-table-wrap weekly-mapping-table-wrap">
          <table className="tbl weekly-table weekly-mapping-table">
            <thead><tr><th>석차 그룹</th><th>대상 반</th><th>단원명</th><th>빠른 적용</th></tr></thead>
            <tbody>
              {props.catalog.groups.map((group) => (
                <tr key={group.rankGroupKey}>
                  <td><Badge tone={/NPR|개유라/.test(group.rankGroupLabel) ? 'warning' : 'neutral'}>{group.rankGroupLabel}</Badge></td>
                  <td className="weekly-class-list">{group.classNames.join(', ')}</td>
                  <td>
                    <Field
                      ariaLabel={`${group.rankGroupLabel} 단원명`}
                      placeholder={`${props.chapter || '—'}단원 이름 입력`}
                      value={props.mappings[group.rankGroupKey] || ''}
                      onInput={(value) => props.onChange(group.rankGroupKey, value)}
                    />
                  </td>
                  <td><button type="button" className="weekly-copy-course" onClick={() => props.onApplySameCourse(group)}>같은 과정에 복사</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="weekly-actions">
          <Btn variant="secondary" onClick={props.onBack}>이전</Btn>
          <span className="grow" />
          <Btn variant="primary" loading={props.loading} loadingLabel="범위 검증 중..." onClick={props.onPreview}>단원 매핑 검증</Btn>
        </div>
      </div>
    </Card>
  );
}

function StepThree(props: { preview: PreviewResult; onBack: () => void; onNext: () => void }) {
  return (
    <Card className="weekly-main-card">
      <PanelHeading step={3} title="반·시험 범위 확인" description="Excel에서 읽은 주과정과 직접 입력한 단원명을 최종 확인합니다." />
      <div className="weekly-panel-body">
        <Alert tone="success">{`${props.preview.classCount}개 반 · ${props.preview.groupCount}개 석차 그룹을 확인했습니다. 중1-1 NPR반과 개유라반은 별도로 석차를 냅니다.`}</Alert>
        <div className="weekly-table-wrap weekly-preview-table-wrap">
          <table className="tbl weekly-table">
            <thead><tr><th>반명</th><th>학생</th><th>요일</th><th>시험일</th><th>주과정</th><th>단원명</th><th>시험 범위</th><th>석차 그룹</th></tr></thead>
            <tbody>
              {props.preview.classes.map((item) => (
                <tr key={item.className}>
                  <td><strong>{item.className}</strong></td>
                  <td>{`${item.studentCount}명`}</td>
                  <td>{item.schedule}</td>
                  <td className="mono-num">{item.examDate}</td>
                  <td>{item.primaryCourse}</td>
                  <td>{item.unitName}</td>
                  <td>{item.examRange}</td>
                  <td><Badge tone={/NPR|개유라/.test(item.rankGroupLabel) ? 'warning' : 'neutral'}>{item.rankGroupLabel}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="weekly-actions">
          <Btn variant="secondary" onClick={props.onBack}>단원명 수정</Btn>
          <span className="grow" />
          <Btn variant="primary" onClick={props.onNext}>확인 완료 · 파일 생성으로</Btn>
        </div>
      </div>
    </Card>
  );
}

function SplitRule({ total, groups }: { total: number; groups: number[] }) {
  return (
    <div className="weekly-split-rule">
      <span className="weekly-split-total">{`${total}명`}</span>
      <span className="weekly-split-arrow" aria-hidden="true">→</span>
      <span className="weekly-split-groups">{groups.map((group, index) => <i key={index}>{group}</i>)}</span>
    </div>
  );
}

function StepFour(props: {
  outputNames: Record<OutputFormat, string>;
  loading: OutputFormat | null;
  error: string;
  generated: GeneratedResult | null;
  onBack: () => void;
  onGenerate: (format: OutputFormat) => void;
}) {
  const generatedLabel = props.generated?.format === 'pdf' ? 'PDF' : 'PPT';
  return (
    <Card className="weekly-main-card">
      <PanelHeading step={4} title="우수학생 PPT·PDF 생성" description="Excel 학생 명단과 통통통 점수를 대조해 공동 1등을 기존 템플릿에 넣습니다." />
      <div className="weekly-panel-body">
        <Alert tone="success">같은 초등 학년·같은 주과정끼리 석차를 계산하며, 중1-1은 NPR반과 개유라반을 분리합니다.</Alert>
        <Alert tone="info">PPT 글꼴은 시월구일(a시월구일2)로 고정하고, PDF는 한글 글꼴을 파일에 포함합니다.</Alert>
        {props.error ? <Alert tone="warning">{props.error}</Alert> : null}
        {props.generated ? <Alert tone="success">{`${props.generated.winnerCount}명 · ${props.generated.slideCount}장 ${generatedLabel}를 생성해 다운로드했습니다.`}</Alert> : null}
        <div className="weekly-section-title"><h4>슬라이드 분할 기준</h4><span>한 장 최대 7명 · 장별 인원 차이 최대 1명</span></div>
        <div className="weekly-split-grid">
          <SplitRule total={7} groups={[7]} />
          <SplitRule total={8} groups={[4, 4]} />
          <SplitRule total={9} groups={[5, 4]} />
          <SplitRule total={14} groups={[7, 7]} />
          <SplitRule total={15} groups={[5, 5, 5]} />
          <SplitRule total={20} groups={[7, 7, 6]} />
        </div>
        <div className="weekly-output-preview">
          <div className="weekly-output-icon"><PresentationIcon /></div>
          <div className="weekly-output-files">
            <strong>생성될 파일</strong>
            <p><span>PPT</span>{props.outputNames.pptx}</p>
            <p><span>PDF</span>{props.outputNames.pdf}</p>
          </div>
          <Badge tone={props.generated ? 'success' : 'neutral'}>{props.generated ? `${generatedLabel} 완료` : '준비 완료'}</Badge>
        </div>
        <div className="weekly-actions">
          <Btn variant="secondary" onClick={props.onBack}>이전</Btn>
          <span className="grow" />
          <Btn
            variant="secondary"
            disabled={props.loading !== null}
            loading={props.loading === 'pptx'}
            loadingLabel="PPT 생성 중..."
            onClick={() => props.onGenerate('pptx')}
          >PPT 다운로드</Btn>
          <Btn
            variant="primary"
            disabled={props.loading !== null}
            loading={props.loading === 'pdf'}
            loadingLabel="PDF 생성 중..."
            onClick={() => props.onGenerate('pdf')}
          >PDF 다운로드</Btn>
        </div>
      </div>
    </Card>
  );
}

function JobSummary(props: {
  step: Step;
  round: string;
  chapter: string;
  mDate: string;
  tDate: string;
  file: File | null;
  catalog: MappingResult | null;
  mappings: UnitMappings;
  preview: PreviewResult | null;
}) {
  const mappedCount = props.catalog?.groups.filter((group) => props.mappings[group.rankGroupKey]?.trim()).length || 0;
  return (
    <aside className="weekly-side">
      <Card title="이번 작업" action={<Badge tone="brand">{`${props.step}/4`}</Badge>}>
        <div className="weekly-summary">
          <div><span>회차</span><strong>{`${props.round || '—'}회차`}</strong></div>
          <div><span>시험 단원</span><strong>{`${props.chapter || '—'}단원`}</strong></div>
          <div><span>M반 시험일</span><strong className="mono-num">{props.mDate || '미지정'}</strong></div>
          <div><span>T반 시험일</span><strong className="mono-num">{props.tDate || '미지정'}</strong></div>
          <div><span>학생 목록</span><strong title={props.file?.name}>{props.file?.name || '미선택'}</strong></div>
          {props.catalog ? <div><span>학생·반</span><strong>{`${props.catalog.studentCount}명 · ${props.catalog.classCount}반`}</strong></div> : null}
          <div><span>단원 매핑</span><strong>{props.catalog ? `${mappedCount}/${props.catalog.groupCount}` : '반 불러오기 전'}</strong></div>
          {props.preview ? <div><span>석차 그룹</span><strong>{`${props.preview.groupCount}개`}</strong></div> : null}
        </div>
        <div className="weekly-progress"><i style={{ width: `${(props.step / 4) * 100}%` }} /></div>
      </Card>
    </aside>
  );
}

function outputName(mDate: string, tDate: string, round: string, format: OutputFormat): string {
  const start = mDate.match(/^\d{4}-(\d{2})-(\d{2})$/);
  const end = tDate.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!start || !end) return `WT_우수학생_${round || '회차'}.${format}`;
  return `WT_우수학생_${Number(start[1])}월${Number(start[2])}-${Number(end[2])}일_${round || '—'}회차.${format}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let start = 0; start < bytes.length; start += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 32_768));
  }
  return window.btoa(binary);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function WeeklyPptWorkspace() {
  const { App } = useApp();
  const state = App.state;
  const [step, setStep] = useState<Step>(1);
  const [round, setRound] = useState('4');
  const [chapter, setChapter] = useState('4');
  const [mDate, setMDate] = useState(state.settings?.wtestM || state.today || '');
  const [tDate, setTDate] = useState(state.settings?.wtestT || state.today || '');
  const [studentFile, setStudentFile] = useState<File | null>(null);
  const [studentWorkbookBase64, setStudentWorkbookBase64] = useState('');
  const [catalog, setCatalog] = useState<MappingResult | null>(null);
  const [unitMappings, setUnitMappings] = useState<UnitMappings>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generateLoading, setGenerateLoading] = useState<OutputFormat | null>(null);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState<GeneratedResult | null>(null);
  const outputNames = {
    pptx: outputName(mDate, tDate, round, 'pptx'),
    pdf: outputName(mDate, tDate, round, 'pdf'),
  };
  const unlockedStep: Step = preview ? 4 : catalog ? 2 : 1;

  const invalidateResult = () => {
    setCatalog(null);
    setPreview(null);
    setGenerated(null);
    setStep(1);
    setError('');
  };

  const changeInfo = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    invalidateResult();
  };

  const changeStudentFile = (file: File | null) => {
    setStudentFile(file);
    setStudentWorkbookBase64('');
    invalidateResult();
  };

  const basePayload = (mode: 'catalog' | 'preview' | 'generate', encoded = studentWorkbookBase64) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mDate) || !/^\d{4}-\d{2}-\d{2}$/.test(tDate)) throw new Error('M반과 T반 시험일을 입력해 주세요.');
    if (!Number.isInteger(Number(round)) || Number(round) < 1) throw new Error('회차는 1 이상의 정수로 입력해 주세요.');
    if (!Number.isInteger(Number(chapter)) || Number(chapter) < 1) throw new Error('시험 단원은 1 이상의 정수로 입력해 주세요.');
    if (!studentFile || !encoded) throw new Error('학생 목록 Excel 파일을 선택해 주세요.');
    return {
      mode,
      round: Number(round),
      chapter: Number(chapter),
      mDate,
      tDate,
      studentWorkbookName: studentFile.name,
      studentWorkbookBase64: encoded,
    };
  };

  const readStudentWorkbook = async () => {
    if (!studentFile) throw new Error('학생 목록 Excel 파일을 선택해 주세요.');
    if (!/\.xlsx$/i.test(studentFile.name)) throw new Error('학생 목록은 .xlsx 파일만 사용할 수 있습니다.');
    if (studentFile.size > 3_000_000) throw new Error('학생 목록 Excel은 3MB 이하 파일만 사용할 수 있습니다.');
    if (studentWorkbookBase64) return studentWorkbookBase64;
    const encoded = arrayBufferToBase64(await studentFile.arrayBuffer());
    setStudentWorkbookBase64(encoded);
    return encoded;
  };

  const runCatalog = async () => {
    setCatalogLoading(true);
    setError('');
    try {
      const encoded = await readStudentWorkbook();
      const result = await api.post('/api/utility/weekly-ppt', basePayload('catalog', encoded)) as MappingResult;
      setCatalog(result);
      setUnitMappings((current) => Object.fromEntries(result.groups.map((group) => [group.rankGroupKey, current[group.rankGroupKey] || ''])));
      setPreview(null);
      setGenerated(null);
      setStep(2);
    } catch (requestError: any) {
      setError(requestError?.message || '학생 목록 Excel을 불러오지 못했습니다.');
      setStep(1);
    } finally {
      setCatalogLoading(false);
    }
  };

  const updateMapping = (key: string, value: string) => {
    setUnitMappings((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setGenerated(null);
    setError('');
    if (step > 2) setStep(2);
  };

  const applySameCourse = (source: MappingGroup) => {
    const value = unitMappings[source.rankGroupKey] || '';
    if (!value.trim()) {
      setError(`${source.rankGroupLabel} 단원명을 먼저 입력해 주세요.`);
      return;
    }
    setUnitMappings((current) => {
      const next = { ...current };
      for (const group of catalog?.groups || []) {
        if (group.primaryCourse === source.primaryCourse) next[group.rankGroupKey] = value;
      }
      return next;
    });
    setPreview(null);
    setGenerated(null);
    setError('');
  };

  const runPreview = async () => {
    if (!catalog) return;
    const missing = catalog.groups.find((group) => !unitMappings[group.rankGroupKey]?.trim());
    if (missing) {
      setError(`${missing.rankGroupLabel} 단원명을 입력해 주세요.`);
      return;
    }
    setPreviewLoading(true);
    setError('');
    try {
      const result = await api.post('/api/utility/weekly-ppt', { ...basePayload('preview'), unitMappings }) as PreviewResult;
      setPreview(result);
      setGenerated(null);
      setStep(3);
    } catch (requestError: any) {
      setError(requestError?.message || '단원 매핑을 검증하지 못했습니다.');
      setStep(2);
    } finally {
      setPreviewLoading(false);
    }
  };

  const runGenerate = async (format: OutputFormat) => {
    setGenerateLoading(format);
    setError('');
    setGenerated(null);
    try {
      const result = await api.postBlob('/api/utility/weekly-ppt', { ...basePayload('generate'), unitMappings, format });
      downloadBlob(result.blob, result.filename);
      setGenerated({
        format,
        filename: result.filename,
        classCount: Number(result.headers.get('X-Weekly-Class-Count') || preview?.classCount || 0),
        groupCount: Number(result.headers.get('X-Weekly-Group-Count') || preview?.groupCount || 0),
        winnerCount: Number(result.headers.get('X-Weekly-Winner-Count') || 0),
        slideCount: Number(result.headers.get('X-Weekly-Slide-Count') || 0),
      });
    } catch (requestError: any) {
      setError(requestError?.message || `${format === 'pdf' ? 'PDF' : 'PPT'}를 생성하지 못했습니다.`);
    } finally {
      setGenerateLoading(null);
    }
  };

  return (
    <section className="weekly-workspace">
      <div className="weekly-intro">
        <div><h2>주간테스트 결과 만들기</h2><p>학생 목록 Excel과 통통통 성적으로 우수학생 PPT·PDF를 바로 만듭니다.</p></div>
        <Badge tone="success">학생 목록 Excel 1개</Badge>
      </div>
      <StepNav step={step} unlockedStep={unlockedStep} onChange={setStep} />
      <div className="weekly-layout">
        <div>
          {step === 1 ? (
            <StepOne
              round={round} chapter={chapter} mDate={mDate} tDate={tDate} file={studentFile}
              loading={catalogLoading} error={error}
              setRound={changeInfo(setRound)} setChapter={changeInfo(setChapter)}
              setMDate={changeInfo(setMDate)} setTDate={changeInfo(setTDate)}
              setFile={changeStudentFile} onLoad={runCatalog}
            />
          ) : step === 2 && catalog ? (
            <StepTwo
              catalog={catalog} mappings={unitMappings} chapter={chapter}
              loading={previewLoading} error={error} onChange={updateMapping} onApplySameCourse={applySameCourse}
              onBack={() => { setError(''); setStep(1); }} onPreview={runPreview}
            />
          ) : step === 3 && preview ? (
            <StepThree preview={preview} onBack={() => { setError(''); setStep(2); }} onNext={() => { setError(''); setStep(4); }} />
          ) : preview ? (
            <StepFour outputNames={outputNames} loading={generateLoading} error={error} generated={generated} onBack={() => setStep(3)} onGenerate={runGenerate} />
          ) : null}
        </div>
        <JobSummary
          step={step} round={round} chapter={chapter} mDate={mDate} tDate={tDate}
          file={studentFile} catalog={catalog} mappings={unitMappings} preview={preview}
        />
      </div>
    </section>
  );
}

function UnavailableTool(props: { kind: 'unit' | 'omr' }) {
  const unit = props.kind === 'unit';
  return (
    <section className="omr-workspace">
      <div className="omr-intro">
        <div><h2>{unit ? '단원테스트 PPT' : 'OMR 리더기'}</h2><p>{unit ? '단원테스트 기준 템플릿이 제공되면 같은 방식으로 연결합니다.' : 'OMR 답안지를 읽고 채점 결과를 확인하는 기능이 들어갈 예정입니다.'}</p></div>
        <Badge tone="neutral">준비 중</Badge>
      </div>
      <Card className="omr-empty-card">
        <div className="omr-empty-icon">{unit ? <PresentationIcon /> : <OmrIcon />}</div>
        <h3>{unit ? '기준 PPT 템플릿 대기 중' : 'OMR 화면 준비 중'}</h3>
        <p>{unit ? '기존 템플릿을 받기 전에는 새 디자인을 임의로 만들지 않습니다.' : '답안지 입력 방식과 채점 규칙을 정하면 실제 작업 화면을 구성합니다.'}</p>
        <Btn variant="secondary" disabled>{unit ? '템플릿 미등록' : 'OMR 답안지 불러오기'}</Btn>
      </Card>
    </section>
  );
}

export function LeadUtility() {
  const [tool, setTool] = useState<UtilityTool>('weekly-ppt');
  return (
    <div className="utility-page">
      <PageTitle title="유틸리티" cap="반복 업무를 빠르게 처리하는 팀장용 도구입니다." />
      <div className="utility-tabs" role="tablist" aria-label="유틸리티 도구">
        <button type="button" className={tool === 'weekly-ppt' ? 'on' : ''} role="tab" aria-selected={tool === 'weekly-ppt'} onClick={() => setTool('weekly-ppt')}><PresentationIcon />주간테스트 PPT</button>
        <button type="button" className={tool === 'unit-ppt' ? 'on' : ''} role="tab" aria-selected={tool === 'unit-ppt'} onClick={() => setTool('unit-ppt')}><PresentationIcon />단원테스트 PPT</button>
        <button type="button" className={tool === 'omr' ? 'on' : ''} role="tab" aria-selected={tool === 'omr'} onClick={() => setTool('omr')}><OmrIcon />OMR 리더기</button>
      </div>
      {tool === 'weekly-ppt' ? <WeeklyPptWorkspace /> : <UnavailableTool kind={tool === 'unit-ppt' ? 'unit' : 'omr'} />}
    </div>
  );
}
