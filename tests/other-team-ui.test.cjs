const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relative) {
  return fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
}

const rootSource = source('components/AppRoot.tsx');
const mappingSource = source('components/screens/LeadMapping.tsx');
const classSource = source('components/screens/OtherTeamClasses.tsx');
const managerSource = source('components/screens/TeacherClassManager.tsx');
const counselSource = source('components/screens/OtherTeamCounsel.tsx');
const notebookSource = source('components/screens/OtherTeamNotebook.tsx');
const modalSource = source('components/modals/ModalHost.tsx');
const apiClientSource = source('lib/api.ts');
const appCssSource = source('public/app.css');

test('other-team navigation contains exactly the three requested convenience tabs', () => {
  const declaration = rootSource.match(/const otherNav:[^\n]+/)[0];
  assert.match(declaration, /\['본인 반 관리', 'classes'\]/);
  assert.match(declaration, /\['상담일정', 'counsel'\]/);
  assert.match(declaration, /\['알림장', 'notebook'\]/);
  assert.equal((declaration.match(/\['/g) || []).length, 3);
  assert.match(rootSource, /classes: <OtherTeamClasses \/>, counsel: <OtherTeamCounsel \/>, notebook: <OtherTeamNotebook \/>/);
});

test('admin teacher status exposes an independent other-team checkbox and daily-report exclusion copy', () => {
  assert.match(mappingSource, /label="팀장 권한 부여"/);
  assert.match(mappingSource, /label="다른 팀 권한 부여"/);
  assert.match(mappingSource, /App\.setTeacherOtherTeam\(teacher\.tid, enabled, teacher\.name\)/);
  assert.match(mappingSource, /일일보고·제출 통계·공용 업무 배정에서 제외/);
  assert.match(mappingSource, /teacher\.isOtherTeam\s*\? '일일보고 제외'/);
});

test('all teachers use the cart-style class manager while other-team convenience screens stay intact', () => {
  assert.match(classSource, /TeacherClassManager as OtherTeamClasses/);
  assert.match(managerSource, /\/api\/class-management\/catalog/);
  assert.match(managerSource, /\/api\/class-management\/apply/);
  assert.match(managerSource, /selectedClassCodes/);
  assert.match(managerSource, /activeClass\.students\.map/);
  assert.match(rootSource, /\['반 관리', 'classes'\]/);
  assert.match(mappingSource, /<TeacherClassManager teacherTid=\{teacher\.tid\}/);
  assert.match(mappingSource, /typeof teacher\.selectedClassCount === 'number'/);
  assert.match(counselSource, /<TeacherTasks otherTeam \/>/);
  assert.match(counselSource, /App\.loadOtherTeamRoster\(\)/);
  assert.match(notebookSource, /<NotebookWorkspace/);
  assert.match(notebookSource, /App\.syncOtherNotebooks\(\)/);
  assert.match(notebookSource, /App\.postOtherNotebook\(className\)/);
  assert.match(modalSource, /disabled=\{!roster\?\.sourceMonth\}/);
});

test('own-class ERP sync receives the same long-request timeout as existing class syncs', () => {
  assert.match(apiClientSource, /\^\\\/api\\\/other-team\\\/classes\\\/sync/);
  assert.match(apiClientSource, /class-management/);
});

test('student roster hides unverified ERP status codes and keeps the verified columns', () => {
  assert.match(managerSource, /<thead><tr><th[^>]*>번호<\/th><th>이름<\/th><th>모번호<\/th><th[^>]*>학년<\/th><th>마지막 상담 D-day<\/th><\/tr><\/thead>/);
  assert.match(managerSource, /student\.student/);
  assert.match(managerSource, /student\.grade/);
  assert.doesNotMatch(managerSource, /student\.status/);
  assert.doesNotMatch(managerSource, /<th\b[^>]*>상태<\/th>/);
  assert.match(managerSource, /\/api\/class-management\/student-details/);
  assert.match(managerSource, /counselRecency\(/);
  assert.match(managerSource, /부재\/문자를 제외/);
});

test('single-column class rosters can shrink below the student table intrinsic width on mobile', () => {
  assert.match(appCssSource, /\.feature-grid\.cols-map[^{}]*\{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(appCssSource, /\.class-manager\.embedded \.class-roster-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});
