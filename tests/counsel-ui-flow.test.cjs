const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modalSource = fs.readFileSync(
  path.resolve(__dirname, '../components/modals/ModalHost.tsx'),
  'utf8',
);
const stateSource = fs.readFileSync(
  path.resolve(__dirname, '../lib/state.tsx'),
  'utf8',
);

test('counsel editors return to the same status view after accepted delivery', () => {
  assert.match(modalSource, /const returnModal = \{ type: 'counselStatus', taskId, teacher, reuseCache: true \}/);
  assert.match(modalSource, /openCounselSend\(taskId, e\.id, returnModal\)/);
  assert.match(modalSource, /openCounselAbsence\(taskId, e\.id, returnModal\)/);
  assert.match(stateSource, /const closeCounselEditor = \(opened: any\) =>/);
  assert.match(stateSource, /App\.ui\.modal = opened\.returnModal \|\| null/);
  assert.equal(
    (stateSource.match(/if \(!notSent\) closeCounselEditor\(openedModal\)/g) || []).length,
    2,
    'normal counsel and absence delivery must share the safe return flow',
  );
});

test('status return reuses the updated cache while global request tokens own loading state', () => {
  assert.doesNotMatch(modalSource, /loadSeq/);
  assert.match(modalSource, /m\.reuseCache && cached\.teacher === teacher && cached\.loading === false && !cached\.error/);
  assert.match(modalSource, /App\.loadCounselEntries\(taskId, name, \{ throwOnError: true \}\)\.catch/);
  assert.doesNotMatch(modalSource, /aria-pressed=\{n === teacher\} disabled=\{loading\}/);
});

test('teachers always get the roster sync button and an honest empty-state, even for a no-current-target special task', () => {
  // noTarget은 여전히 정의되지만 더 이상 버튼을 숨기지 않는다.
  assert.match(modalSource, /const noTarget = special && !!prog\.noTarget/);
  assert.doesNotMatch(modalSource, /\) : noTarget \? null : \(/);
  // 팀장이 아니면(=강사) 곧바로 전체 동기화 버튼 블록으로 떨어진다.
  assert.match(modalSource, /\) : \(\n\s*\/\/ 강사는/);
  assert.match(modalSource, /onClick=\{\(\) => App\.syncAllCounselRosters\(taskId\)\}>학생 로스터 전체 동기화/);
  // 생성 시점 고정·영구 불가 주장은 제거되고 현재 월 재확인 안내로 바뀐다.
  assert.doesNotMatch(modalSource, /특강상담 대상 없음 — 업무 생성 시점에/);
  assert.doesNotMatch(modalSource, /동기화할 로스터가 없습니다/);
  assert.match(modalSource, /이번 달 상담 대상 학생이 없습니다/);
  assert.match(modalSource, /언제든 현재 월 명단을 다시 확인할 수 있습니다/);
  // '대상 없음'(완료) 집계 안내는 특강에만 조건부로 유지된다.
  assert.match(modalSource, /‘대상 없음’\(완료\)으로 집계됩니다/);
  // 정기 상담의 성공적 0명(대상 없음)도 특강 noTarget과 같은 현재-월 안내를 받도록 rosterSynced로 분기한다.
  assert.match(modalSource, /const rosterSynced = !!meta\.reconcile/);
  assert.match(modalSource, /const emptyCurrentRoster = !entriesAll\.length && \(noTarget \|\| rosterSynced\)/);
  assert.match(modalSource, /\) : emptyCurrentRoster \? \(/);
});

test('bulk roster status distinguishes hard failures, contact warnings, and missing phones', () => {
  assert.match(modalSource, /meta\.warningsByClass \|\| \{\}/);
  assert.match(modalSource, /반 동기화 실패 —/);
  assert.match(modalSource, /연락처 경고 —/);
  assert.match(modalSource, /모 번호 없음/);
  assert.match(modalSource, /role="progressbar"/);
  assert.match(modalSource, /aria-valuenow=\{sp\.percent \|\| 0\}/);
});

test('team lead counsel status remains read-only in both UI and state actions', () => {
  assert.match(modalSource, /팀장은 읽기 전용으로 확인합니다/);
  assert.match(modalSource, /!isLead \? <Btn[\s\S]{0,300}openCounselSend/);
  assert.match(modalSource, /!isLead \? <Btn[\s\S]{0,300}openCounselAbsence/);
  assert.match(stateSource, /if \(App\.ui\.role !== 'teacher' && App\.ui\.role !== 'other'\) \{ toast\('팀장은 상담 현황을 읽기 전용으로 확인할 수 있습니다\.'/);
});

test('counsel dialogs expose baseline keyboard and label semantics', () => {
  assert.match(modalSource, /function useDialogA11y\(close: \(\) => void\)/);
  assert.match(modalSource, /role="dialog" aria-modal="true" aria-labelledby=\{titleId\}/);
  assert.match(modalSource, /e\.key === 'Escape'/);
  assert.match(modalSource, /aria-label="닫기"/);
  assert.match(modalSource, /<label htmlFor=\{contentId\}>부재\/문자 내용/);
  assert.match(modalSource, /<textarea id=\{contentId\}/);
});

test('all-roster sync is prepare-first, never blocks on empty classes, and preserves cache on prepare failure', () => {
  // 항상 prepare(현재 월 명단)를 먼저 부르고, 그 결과로 순차 새로고침을 오케스트레이션한다.
  assert.match(stateSource, /runCounselRosterRefresh\(\{/);
  assert.match(stateSource, /prepare: \(\) => api\.post\(/);
  assert.match(stateSource, /date: App\.state\.today, prepare: true,/);
  // 반별 연락처 새로고침은 contactsOnly로 요청한다.
  assert.match(stateSource, /contactsOnly: true, bulk: responseMode === 'delta'/);
  // 예전처럼 기존 반 목록이 비면 거부하던 사전 가드는 사라졌다 — prepare가 항상 먼저다.
  assert.doesNotMatch(stateSource, /동기화할 상담 반이 없습니다/);
  // prepare 실패 경로는 캐시를 지우지 않고 그대로 보존한다고 안내한다.
  assert.match(stateSource, /학생 명단 확인 실패 — 기존 로스터는 그대로 유지됩니다/);
  // 캐시(entries) 교체는 오직 prepare 성공 콜백(onPrepared) 안에서만 일어난다.
  assert.match(stateSource, /onPrepared: \(prepared: any, canonicalClasses: string\[\]\) => \{[\s\S]*?App\.counselByTask\[taskId\] = otherTeachers\.concat/);
  // 팀장은 여전히 읽기 전용.
  assert.match(stateSource, /if \(App\.ui\.role !== 'teacher' && App\.ui\.role !== 'other'\) \{ toast\('팀장은 상담 현황을 읽기 전용으로 확인할 수 있습니다\.'/);
});

test('counsel status shows staged honest progress, source month for both kinds, and a reconcile summary', () => {
  // 1단계(명단 확인)·2단계(반별 전화 새로고침)를 실제 상태로 구분해 표시한다.
  assert.match(modalSource, /sp\.status === 'preparing'/);
  assert.match(modalSource, /① 현재 월 학생 명단을 확인하는 중/);
  assert.match(modalSource, /② 어머니 전화 새로고침 중/);
  // 0명/0반 prepare는 오류가 아니라 '최신' 완료로 표시한다.
  assert.match(modalSource, /이번 달 상담 대상 학생이 없어 로스터가 최신입니다/);
  // prepare 실패는 캐시 보존 문구와 함께 알린다.
  assert.match(modalSource, /학생 명단 확인 실패 —/);
  // 진행률 접근성 속성과 실제 완료/전체 반 표기는 유지.
  assert.match(modalSource, /role="progressbar"/);
  assert.match(modalSource, /aria-valuenow=\{sp\.percent \|\| 0\}/);
  // 기준 월(수강년월)은 특강뿐 아니라 정기 상담에도 노출한다 — 더 이상 special로 게이팅하지 않는다.
  assert.doesNotMatch(modalSource, /special && meta\.sourceMonth/);
  assert.match(modalSource, /\$\{special \? '특강 수강년월' : '기준 월'\} \$\{meta\.sourceMonth\}/);
  // 추가/수정/비활성/복원 요약을 값이 있을 때 노출한다.
  assert.match(modalSource, /counselReconcileSummary\(meta\.reconcile\)/);
  assert.match(modalSource, /명단 반영 · /);
});
