const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const ExcelJS = require('exceljs');

const weeklyPath = path.resolve(__dirname, '../src/weekly/weekly-ppt.ts');
const handlerPath = path.resolve(__dirname, '../pages/api/utility/weekly-ppt.ts');
let activeBackend;
let generatedPages = [];
let generatedFormat = '';

function loadTypescriptModule(file, mocks = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
      esModuleInterop: true,
    },
  });
  const originalLoad = Module._load;
  Module._load = function loadWithMocks(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const compiled = new Module(file, module);
    compiled.filename = file;
    compiled.paths = Module._nodeModulePaths(path.dirname(file));
    compiled._compile(outputText, file);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const weekly = loadTypescriptModule(weeklyPath);
const weeklyApiMock = {
  ...weekly,
  async createWeeklyWinnerPpt(templatePath, pages) {
    assert.match(templatePath, /weekly-winners-1-7\.pptx$/);
    generatedPages = pages;
    generatedFormat = 'pptx';
    return Buffer.from('mock-pptx');
  },
  async createWeeklyWinnerPdf(templatePath, pages) {
    assert.match(templatePath, /weekly-winners-1-7\.pptx$/);
    generatedPages = pages;
    generatedFormat = 'pdf';
    return Buffer.from('%PDF-mock');
  },
  resolveWinnerSchools(rows, className, names) {
    assert.equal(className, '6M3C');
    return new Map(names.map((name) => [name, '테스트초']));
  },
};
const handler = loadTypescriptModule(handlerPath, {
  '@/src/backend': { backend: () => activeBackend },
  '@/src/weekly/weekly-ppt': weeklyApiMock,
}).default;

async function workbookBase64(course = '중 1-1', book = 'NPR', className = '6M3C', teacher = '김선생') {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('데이터함수');
  worksheet.getCell('D3').value = '반명';
  worksheet.getCell('G3').value = '과정';
  worksheet.getCell('D4').value = className;
  worksheet.getCell('E4').value = '초6';
  worksheet.getCell('F4').value = teacher;
  worksheet.getCell('G4').value = course;
  worksheet.getCell('H4').value = book;
  worksheet.getCell('M4').value = 1;
  worksheet.getCell('N4').value = '목록학생';
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

function createBackend() {
  return {
    db: { sync() {} },
    store: {
      getState() {
        return {
          teachers: [{
            tid: 'teacher-1', name: '김선생', hasTtt: true,
            classes: { 월수금반: [], 화목토반: [] },
          }],
        };
      },
      getTeacherTtt() { return { id: 'hidden', pw: 'hidden' }; },
    },
    ttt: {
      async getScoresStrict() {
        return [
          { student: '목록학생1', total: '90', rank: '2', examinees: '2' },
          { student: '엑셀에없는학생', total: '100', rank: '1', examinees: '2' },
        ];
      },
      async getAttendanceStrict() { return []; },
    },
  };
}

async function invoke(body) {
  const response = {
    headers: {}, statusCode: 0, payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    send(payload) { this.payload = payload; return this; },
  };
  await handler({ method: 'POST', query: { role: 'lead', tid: 'admin' }, body }, response);
  return response;
}

function request(mode, encoded, extra = {}) {
  return {
    mode,
    round: 4,
    chapter: 4,
    mDate: '2026-07-15',
    tDate: '2026-07-16',
    studentWorkbookName: '학생목록.xlsx',
    studentWorkbookBase64: encoded,
    ...extra,
  };
}

test('학생 목록 Excel이 반·주과정·명단의 기준이며 업로드할 때마다 다시 해석된다', async () => {
  activeBackend = createBackend();
  const npr = await invoke(request('catalog', await workbookBase64()));
  assert.equal(npr.statusCode, 200);
  assert.equal(npr.payload.classCount, 1);
  assert.equal(npr.payload.studentCount, 1);
  assert.equal(npr.payload.groups[0].rankGroupLabel, '초6 · 중1-1 · NPR반');

  const changed = await invoke(request('catalog', await workbookBase64('중1-1', '개념원리 / 개념연산')));
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.payload.groups[0].rankGroupLabel, '초6 · 중1-1 · 개유라반');
});

test('PPT 대상은 Excel 명단에 있는 학생만 사용하고 통통통의 동명이인 번호를 연결한다', async () => {
  activeBackend = createBackend();
  generatedPages = [];
  const encoded = await workbookBase64();
  const catalog = await invoke(request('catalog', encoded));
  const key = catalog.payload.groups[0].rankGroupKey;
  const generated = await invoke(request('generate', encoded, {
    unitMappings: { [key]: '좌표평면과 그래프' },
  }));
  assert.equal(generated.statusCode, 200);
  assert.equal(generatedFormat, 'pptx');
  assert.equal(generated.headers['X-Weekly-Winner-Count'], '1');
  assert.deepEqual(generatedPages[0].students.map((item) => item.name), ['목록학생1']);
});

test('같은 결과를 PDF 형식으로 선택해 내려받을 수 있다', async () => {
  activeBackend = createBackend();
  generatedFormat = '';
  const encoded = await workbookBase64();
  const catalog = await invoke(request('catalog', encoded));
  const key = catalog.payload.groups[0].rankGroupKey;
  const generated = await invoke(request('generate', encoded, {
    format: 'pdf',
    unitMappings: { [key]: '좌표평면과 그래프' },
  }));
  assert.equal(generated.statusCode, 200);
  assert.equal(generatedFormat, 'pdf');
  assert.equal(generated.headers['Content-Type'], 'application/pdf');
  assert.equal(generated.headers['X-Weekly-Format'], 'pdf');
  assert.match(generated.headers['Content-Disposition'], /\.pdf/);
  assert.equal(generated.payload.subarray(0, 5).toString('ascii'), '%PDF-');
});

test('Excel 담임의 통통통 계정을 운영 앱에서 찾을 수 없으면 진행하지 않는다', async () => {
  activeBackend = createBackend();
  const response = await invoke(request('catalog', await workbookBase64('초 6-2', 'NPR', '6M4A', '없는강사')));
  assert.equal(response.statusCode, 400);
  assert.match(response.payload.message, /담임 '없는강사'을 운영 앱에서 찾지 못했습니다/);
});
