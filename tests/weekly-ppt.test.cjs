const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

const modulePath = path.resolve(__dirname, '../src/weekly/weekly-ppt.ts');

function loadWeeklyModule() {
  const source = fs.readFileSync(modulePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: modulePath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
    },
  });
  const compiled = new Module(modulePath, module);
  compiled.filename = modulePath;
  compiled.paths = Module._nodeModulePaths(path.dirname(modulePath));
  compiled._compile(outputText, modulePath);
  return compiled.exports;
}

const weekly = loadWeeklyModule();

async function studentWorkbookBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('데이터함수');
  worksheet.getCell('D3').value = '반명';
  worksheet.getCell('E3').value = '학년';
  worksheet.getCell('F3').value = '담임(선행)';
  worksheet.getCell('G3').value = '과정';
  worksheet.getCell('H3').value = '교재';
  worksheet.getCell('M3').value = '반별인원';
  rows.forEach((item, index) => {
    const row = 4 + index;
    worksheet.getCell(row, 4).value = item.className;
    worksheet.getCell(row, 5).value = item.sourceGrade;
    worksheet.getCell(row, 6).value = item.teacher || '강사';
    worksheet.getCell(row, 7).value = item.course;
    worksheet.getCell(row, 8).value = item.book;
    worksheet.getCell(row, 13).value = item.students.length;
    item.students.forEach((name, studentIndex) => {
      worksheet.getCell(row, 14 + studentIndex).value = name;
    });
    worksheet.getCell(row, 14 + item.students.length).value = { formula: 'IF(FALSE,"학생","")' };
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('중1-1 과정은 NPR반과 개유라반을 별도 그룹·범위로 표시한다', () => {
  const npr = weekly.courseMetadata('중1-1 NPR');
  const gaeyura = weekly.courseMetadata('중1-1 개념원리');

  assert.notEqual(weekly.rankGroupKey('6M1A', npr), weekly.rankGroupKey('6M1A', gaeyura));
  assert.equal(weekly.rankGroupLabel('6M1A', npr), '초6 · 중1-1 · NPR반');
  assert.equal(weekly.rankGroupLabel('6M1A', gaeyura), '초6 · 중1-1 · 개유라반');
  assert.equal(weekly.formatExamRange(npr, '좌표평면과 그래프', 4), '중1-1 4단원 (NPR반)');
  assert.equal(weekly.formatExamRange(gaeyura, '좌표평면과 그래프', 4), '중1-1 4단원 (개유라반)');
});

test('같은 과정이어도 초등 학년이 다르면 석차 그룹을 합치지 않는다', () => {
  const course = weekly.courseMetadata('중2-1');
  assert.notEqual(weekly.rankGroupKey('5M1A', course), weekly.rankGroupKey('6T1A', course));
  assert.equal(weekly.rankGroupKey('6M1A', course), weekly.rankGroupKey('6T2A', course));
});

test('초등 시험 범위는 단원 번호와 단원명을 검증해 표시한다', () => {
  const course = weekly.courseMetadata('초6-2');
  assert.equal(weekly.formatExamRange(course, '비례식과 비례배분', 4), '6-2 4단원 비례식과 비례배분');
  assert.throws(
    () => weekly.formatExamRange(course, '원의 넓이', 4),
    /단원 불일치/,
  );
});

test('학생 목록 Excel의 과정·교재에서 NPR반과 개유라반 및 학생 명단을 읽는다', async () => {
  const buffer = await studentWorkbookBuffer([
    { className: '6M3C', sourceGrade: '초6', course: '중 1-1', book: 'NPR', students: ['가학생', '나학생'] },
    { className: '6T3A', sourceGrade: '초6', course: '중1-1', book: '개념원리 / 개념연산(비상)', students: ['다학생'] },
    { className: '5M3A', sourceGrade: '초5', course: '초 6-2', book: 'NPR', students: ['라학생'] },
  ]);
  const catalog = await weekly.parseWeeklyStudentWorkbook(buffer);
  assert.equal(catalog.sheetName, '데이터함수');
  assert.equal(catalog.classes.length, 3);
  assert.equal(catalog.classes.find((item) => item.className === '6M3C').primaryCourse, '중1-1 NPR');
  assert.equal(catalog.classes.find((item) => item.className === '6T3A').primaryCourse, '중1-1 개유라');
  assert.deepEqual(catalog.classes.find((item) => item.className === '6M3C').studentNames, ['가학생', '나학생']);
});

test('다음 현황표에서 반 과정이 바뀌면 별도 저장값 없이 새 Excel 내용이 적용된다', async () => {
  const before = await weekly.parseWeeklyStudentWorkbook(await studentWorkbookBuffer([
    { className: '6M4A', sourceGrade: '초6', course: '초 6-2', book: 'NPR', students: ['가학생'] },
  ]));
  const after = await weekly.parseWeeklyStudentWorkbook(await studentWorkbookBuffer([
    { className: '6M4A', sourceGrade: '초6', course: '중 1-1', book: 'NPR', students: ['가학생'] },
  ]));
  assert.equal(before.classes[0].primaryCourse, '초6-2');
  assert.equal(after.classes[0].primaryCourse, '중1-1 NPR');
});

test('Excel 명단 이름과 통통통 동명이인 번호는 반 안에서 유일할 때 연결한다', () => {
  const matched = weekly.matchWeeklyRosterScores(
    ['정지원', '명단학생'],
    [
      { name: '정지원1', score: 100 },
      { name: '통통통에만있는학생', score: 100 },
    ],
    '6M1B',
  );
  assert.deepEqual(matched.map((item) => item.name), ['정지원1']);
  assert.throws(
    () => weekly.matchWeeklyRosterScores(
      ['정지원'],
      [{ name: '정지원1', score: 100 }, { name: '정지원2', score: 90 }],
      '6M1B',
    ),
    /일치하는 통통통 성적이 여러 개/,
  );
});

test('직접 입력한 단원명으로 계획표 없이 시험 범위를 만든다', () => {
  const assignments = [{
    className: '6M4A', teacher: '강사', tid: 'teacher', scheduleGroup: '월수금반',
    scheduleLabel: '월수금', examDate: '2026-07-15',
  }];
  const courseMappings = { '6M4A': '초6-2' };
  const groups = weekly.weeklyMappingGroups(assignments, courseMappings);
  assert.equal(groups.length, 1);
  assert.throws(() => weekly.buildWeeklyPlans(assignments, courseMappings, {}, 4), /단원명을 입력하지 않은/);
  const plans = weekly.buildWeeklyPlans(assignments, courseMappings, {
    [groups[0].rankGroupKey]: '비례식과 비례배분',
  }, 4);
  assert.equal(plans[0].planSheet, '웹 직접 입력');
  assert.equal(plans[0].examRange, '6-2 4단원 비례식과 비례배분');
});

test('운영 반의 주과정이 비어 있으면 석차 그룹과 PPT 계획을 만들 수 없다', () => {
  const assignments = [{
    className: '6M9A', teacher: '강사', tid: 'teacher', scheduleGroup: '월수금반',
    scheduleLabel: '월수금', examDate: '2026-10-05',
  }];
  assert.throws(() => weekly.weeklyMappingGroups(assignments, {}), /주과정을 선택하지 않은 운영 반/);
});

test('8명 이상은 슬라이드별 인원 차이가 최대 1명이 되도록 균등 분할한다', () => {
  assert.deepEqual(weekly.balancedPageSizes(7), [7]);
  assert.deepEqual(weekly.balancedPageSizes(8), [4, 4]);
  assert.deepEqual(weekly.balancedPageSizes(9), [5, 4]);
  assert.deepEqual(weekly.balancedPageSizes(15), [5, 5, 5]);
  assert.deepEqual(weekly.balancedPageSizes(20), [7, 7, 6]);
});

test('시험 일정과 파일명은 서버 시간대와 무관하게 입력 날짜를 유지한다', () => {
  const dates = { 월수금반: '2026-07-15', 화목토반: '2026-07-16' };
  assert.equal(weekly.weeklyExamSchedule(dates), '2026년 7월 15일(수) ~ 7월 16일(목)');
  assert.equal(weekly.weeklyOutputFilename(dates, 4), 'WT_우수학생_7월15-16일_4회차.pptx');
});

test('같은 석차 그룹의 최고점 공동 1등만 PPT 대상이 된다', () => {
  const base = {
    teacher: '강사', tid: 'teacher', scheduleGroup: '월수금반', scheduleLabel: '월수금',
    examDate: '2026-07-15', primaryCourse: '중1-1 NPR', unitName: '좌표평면',
    examRange: '중1-1 4단원 (NPR반)', planSheet: 'sheet',
    rankGroupKey: 'grade:6|middle:1-1|NPR', rankGroupLabel: '초6 · 중1-1 · NPR반',
    metadata: weekly.courseMetadata('중1-1 NPR'), sourceRowCount: 2,
  };
  const classResults = [
    { ...base, className: '6M1A', students: [
      { name: '가학생', className: '6M1A', score: 100, school: '가초' },
      { name: '나학생', className: '6M1A', score: 90, school: '나초' },
    ] },
    { ...base, className: '6T1A', scheduleGroup: '화목토반', scheduleLabel: '화목토', students: [
      { name: '다학생', className: '6T1A', score: 100, school: '다초' },
      { name: '라학생', className: '6T1A', score: 80, school: '라초' },
    ] },
  ];
  const { pages, groups } = weekly.buildWinnerPages(classResults);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].topScore, 100);
  assert.equal(groups[0].winnerCount, 2);
  assert.deepEqual(pages[0].students.map((student) => student.name), ['가학생', '다학생']);
});

test('승인된 내장 템플릿으로 중1-1 반명이 포함된 PPTX를 만든다', async () => {
  const template = path.resolve(__dirname, '../assets/templates/weekly-winners-1-7.pptx');
  const pages = [{
    rankGroupKey: 'grade:6|middle:1-1|NPR',
    rankGroupLabel: '초6 · 중1-1 · NPR반',
    sourceClasses: ['6M1A'],
    examRange: '중1-1 4단원 (NPR반)',
    pageIndex: 1,
    students: [
      { name: '가학생', className: '6M1A', score: 100, school: '가초', pptRank: 1 },
      { name: '나학생', className: '6M1A', score: 100, school: '나초', pptRank: 1 },
    ],
  }];
  const output = await weekly.createWeeklyWinnerPpt(template, pages, '2026년 7월 15일(수) ~ 7월 16일(목)');
  assert.equal(output.subarray(0, 2).toString('ascii'), 'PK');
  assert.ok(output.length > 1_000_000);
  assert.ok(output.length < 4_000_000);
  assert.deepEqual(await weekly.weeklyPptPackageIssues(output), []);

  const archive = await JSZip.loadAsync(output);
  const slideXml = await Promise.all(Object.keys(archive.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .map((name) => archive.file(name).async('string')));
  assert.ok(slideXml.some((xml) => xml.includes('페이퍼로지')));
});

test('기존 템플릿 배경과 아이콘을 재사용해 한글 글꼴이 포함된 PDF를 만든다', async () => {
  const template = path.resolve(__dirname, '../assets/templates/weekly-winners-1-7.pptx');
  const pages = [{
    rankGroupKey: 'grade:6|middle:1-1|NPR',
    rankGroupLabel: '초6 · 중1-1 · NPR반',
    sourceClasses: ['6M1A'],
    examRange: '중1-1 4단원 (NPR반)',
    pageIndex: 1,
    students: [
      { name: '가학생', className: '6M1A', score: 100, school: '가초', pptRank: 1 },
      { name: '나학생', className: '6M1A', score: 100, school: '나초', pptRank: 1 },
    ],
  }];
  const output = await weekly.createWeeklyWinnerPdf(template, pages, '2026년 7월 15일(수) ~ 7월 16일(목)');
  assert.equal(output.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(output.length > 100_000);
  assert.ok(output.length < 8_000_000);
});
