const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relative) {
  return fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
}

const mappingSource = source('components/screens/LeadMapping.tsx');
const managerSource = source('components/screens/TeacherClassManager.tsx');

test('class management replaces the old quarter-start and rule-based sync UI', () => {
  assert.doesNotMatch(mappingSource, /새 분기 시작|정규 반 동기화|QuarterStartPreview/);
  assert.match(mappingSource, /<TeacherClassManager teacherTid=\{teacher\.tid\}/);
  assert.match(mappingSource, /반명 규칙이나 새 분기 예외 없이/);
});

test('the catalog is read-only until explicit checkbox selection is applied', () => {
  assert.match(managerSource, /통통통 반 불러오기/);
  assert.match(managerSource, /type="checkbox"/);
  assert.match(managerSource, /선택한 반 적용/);
  assert.match(managerSource, /목록을 불러오는 것만으로는 저장값이 바뀌지 않으며/);
});

test('apply is guarded by catalog and selection revisions plus removal confirmation', () => {
  assert.match(managerSource, /catalogFingerprint: catalog\.catalogFingerprint/);
  assert.match(managerSource, /selectionRevision: catalog\.selectionRevision/);
  assert.match(managerSource, /window\.confirm/);
  assert.match(managerSource, /기존 반이 선택에서 빠집니다/);
});
