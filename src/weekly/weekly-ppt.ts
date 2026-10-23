import Automizer, { type XmlElement } from 'pptx-automizer';
import ExcelJS from 'exceljs';
import { readFile } from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';

export const WEEKLY_MAX_STUDENTS_PER_SLIDE = 7;
export const WEEKLY_SCHEDULE_GROUPS = ['월수금반', '화목토반'] as const;

export type WeeklyScheduleGroup = (typeof WEEKLY_SCHEDULE_GROUPS)[number];
export type WeeklyCourseVariant = '' | 'NPR' | '개유라';
export type WeeklyOutputFormat = 'pptx' | 'pdf';

export interface WeeklyClassAssignment {
  className: string;
  teacher: string;
  tid: string;
  scheduleGroup: WeeklyScheduleGroup;
  scheduleLabel: '월수금' | '화목토';
  examDate: string;
}

export interface WeeklyCourseMetadata {
  raw: string;
  schoolLevel: 'elementary' | 'middle';
  semesterKey: string;
  variant: WeeklyCourseVariant;
}

export interface WeeklyClassPlan extends WeeklyClassAssignment {
  primaryCourse: string;
  unitName: string;
  examRange: string;
  planSheet: string;
  rankGroupKey: string;
  rankGroupLabel: string;
  metadata: WeeklyCourseMetadata;
}

export interface WeeklyMappingGroup {
  rankGroupKey: string;
  rankGroupLabel: string;
  primaryCourse: string;
  classNames: string[];
}

export interface WeeklyWorkbookClass {
  className: string;
  sourceGrade: string;
  teacher: string;
  primaryCourse: string;
  book: string;
  studentNames: string[];
}

export interface WeeklyWorkbookCatalog {
  sheetName: string;
  classes: WeeklyWorkbookClass[];
}

export interface WeeklyStudentScore {
  name: string;
  className: string;
  score: number;
  school?: string;
  apiRank?: string;
  participants?: string;
}

export interface WeeklyClassResult extends WeeklyClassPlan {
  students: WeeklyStudentScore[];
  sourceRowCount: number;
}

export interface WeeklyWinnerStudent extends WeeklyStudentScore {
  school: string;
  pptRank: 1;
}

export interface WeeklyWinnerPage {
  rankGroupKey: string;
  rankGroupLabel: string;
  sourceClasses: string[];
  examRange: string;
  students: WeeklyWinnerStudent[];
  pageIndex: number;
}

export interface WeeklyGroupSummary {
  rankGroupKey: string;
  rankGroupLabel: string;
  sourceClasses: string[];
  topScore: number | null;
  winnerCount: number;
}

export class WeeklyPptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeeklyPptError';
  }
}

const ELEMENTARY_CHAPTERS: Record<string, Record<string, string>> = {
  '4-1': {
    '큰수': '1', '각도': '2', '곱셈과나눗셈': '3', '평면도형의이동': '4',
    '막대그래프': '5', '규칙찾기': '6',
  },
  '4-2': {
    '분수의덧셈과뺄셈': '1', '삼각형': '2', '소수의덧셈과뺄셈': '3',
    '사각형': '4', '꺾은선그래프': '5', '다각형': '6',
  },
  '5-1': {
    '자연수의혼합계산': '1', '약수와배수': '2', '규칙과대응': '3',
    '약분과통분': '4', '분수의덧셈과뺄셈': '5', '다각형의둘레와넓이': '6',
  },
  '5-2': {
    '수의범위와어림하기': '1', '분수의곱셈': '2', '합동과대칭': '3',
    '소수의곱셈': '4', '직육면체정육면체': '5', '평균과가능성': '6',
  },
  '6-1': {
    '분수의나눗셈': '1', '각기둥과각뿔': '2', '소수의나눗셈': '3',
    '비와비율': '4', '여러가지그래프': '5', '직육면체의부피와겉넓이': '6',
  },
  '6-2': {
    '분수의나눗셈': '1', '소수의나눗셈': '2', '공간과입체': '3',
    '비례식과비례배분': '4', '원의넓이': '5', '원기둥원뿔구': '6',
  },
};

const UNIT_REPLACEMENTS: Record<string, string> = {
  '좌표명면곽': '좌표평면과',
  '좌표명면과': '좌표평면과',
  '좌표명면': '좌표평면',
  '겉널이': '겉넓이',
};

const naturalCollator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

export function cleanWeeklyText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const item = value as any;
    if (item.error !== undefined) return '';
    if (item.result !== undefined && item.result !== null) return cleanWeeklyText(item.result);
    if (item.formula !== undefined) return '';
    if (Array.isArray(item.richText)) return cleanWeeklyText(item.richText.map((part: any) => part?.text || '').join(''));
    if (item.text !== undefined) return cleanWeeklyText(item.text);
  }
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

export function cleanDisplayUnit(value: unknown): string {
  let text = cleanWeeklyText(value).replace(/^\d+\s*(?:단원|단|\.)?\s*/, '').trim();
  for (const [source, target] of Object.entries(UNIT_REPLACEMENTS)) text = text.replaceAll(source, target);
  return text;
}

function normalizeUnit(value: unknown): string {
  return cleanDisplayUnit(value).replace(/\s/g, '');
}

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new WeeklyPptError(`${label}을 올바르게 입력해 주세요.`);
  }
}

export function courseMetadata(value: unknown): WeeklyCourseMetadata {
  const raw = cleanWeeklyText(value);
  const match = raw.match(/(초|중)\s*(\d)\s*-\s*(\d)/);
  if (!match) throw new WeeklyPptError(`과정을 해석할 수 없습니다: ${raw || '(빈 값)'}`);

  const schoolLevel = match[1] === '초' ? 'elementary' : 'middle';
  const semesterKey = `${match[2]}-${match[3]}`;
  let variant: WeeklyCourseVariant = '';
  if (schoolLevel === 'middle' && semesterKey === '1-1') {
    if (/NPR/i.test(raw)) variant = 'NPR';
    else if (/개념원리|개념연산|개유라/.test(raw)) variant = '개유라';
    else throw new WeeklyPptError(`중1-1 과정의 NPR/개유라 구분을 확인할 수 없습니다: ${raw}`);
  }
  return { raw, schoolLevel, semesterKey, variant };
}

function normalizeWorkbookCourse(courseValue: unknown, bookValue: unknown): string {
  const course = cleanWeeklyText(courseValue);
  const book = cleanWeeklyText(bookValue);
  const metadata = courseMetadata(`${course} ${book}`);
  const prefix = metadata.schoolLevel === 'elementary' ? '초' : '중';
  if (metadata.schoolLevel === 'middle' && metadata.semesterKey === '1-1') {
    return `${prefix}${metadata.semesterKey} ${metadata.variant}`;
  }
  return `${prefix}${metadata.semesterKey}`;
}

export async function parseWeeklyStudentWorkbook(input: Buffer): Promise<WeeklyWorkbookCatalog> {
  if (!Buffer.isBuffer(input) || !input.length) throw new WeeklyPptError('학생 목록 Excel 파일을 선택해 주세요.');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(input as any);
  } catch {
    throw new WeeklyPptError('학생 목록 Excel 파일을 열 수 없습니다. .xlsx 파일인지 확인해 주세요.');
  }

  const worksheet = workbook.getWorksheet('데이터함수') || workbook.worksheets.find((sheet) => {
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 30); rowNumber += 1) {
      if (cleanWeeklyText(sheet.getCell(rowNumber, 4).value) === '반명'
        && cleanWeeklyText(sheet.getCell(rowNumber, 7).value) === '과정') return true;
    }
    return false;
  });
  if (!worksheet) throw new WeeklyPptError("학생 목록 Excel에서 '데이터함수' 시트를 찾지 못했습니다.");

  const classes: WeeklyWorkbookClass[] = [];
  const seenClasses = new Set<string>();
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const className = cleanWeeklyText(worksheet.getCell(rowNumber, 4).value);
    if (!/^[456][MT]/i.test(className)) continue;
    const sourceGrade = cleanWeeklyText(worksheet.getCell(rowNumber, 5).value);
    if (!/^초[456]$/.test(sourceGrade)) continue;
    if (sourceGrade !== `초${className[0]}`) {
      throw new WeeklyPptError(`${className}의 초등 학년 표기가 반명과 다릅니다: ${sourceGrade}`);
    }
    if (seenClasses.has(className)) throw new WeeklyPptError(`학생 목록 Excel에 반이 중복되어 있습니다: ${className}`);

    const teacher = cleanWeeklyText(worksheet.getCell(rowNumber, 6).value);
    const book = cleanWeeklyText(worksheet.getCell(rowNumber, 8).value);
    const primaryCourse = normalizeWorkbookCourse(worksheet.getCell(rowNumber, 7).value, book);
    const studentNames: string[] = [];
    const seenStudents = new Set<string>();
    for (let columnNumber = 14; columnNumber <= worksheet.columnCount; columnNumber += 1) {
      const name = cleanWeeklyText(worksheet.getCell(rowNumber, columnNumber).value);
      if (!name) continue;
      if (seenStudents.has(name)) throw new WeeklyPptError(`${className} 학생 명단에 같은 이름이 중복되어 있습니다: ${name}`);
      seenStudents.add(name);
      studentNames.push(name);
    }
    if (!studentNames.length) throw new WeeklyPptError(`${className}의 학생 명단이 비어 있습니다.`);
    seenClasses.add(className);
    classes.push({ className, sourceGrade, teacher, primaryCourse, book, studentNames });
  }
  if (!classes.length) throw new WeeklyPptError('학생 목록 Excel에서 초4~초6 정규반을 찾지 못했습니다.');
  classes.sort((left, right) => naturalCollator.compare(left.className, right.className));
  return { sheetName: worksheet.name, classes };
}

export function workbookClassAssignments(
  state: any,
  workbook: WeeklyWorkbookCatalog,
  dates: Record<WeeklyScheduleGroup, string>,
): WeeklyClassAssignment[] {
  assertIsoDate(dates['월수금반'], 'M반 시험일');
  assertIsoDate(dates['화목토반'], 'T반 시험일');
  const teachers = Array.isArray(state?.teachers) ? state.teachers : [];
  return workbook.classes.map((sourceClass) => {
    const matches = teachers.filter((teacher: any) => cleanWeeklyText(teacher?.name) === sourceClass.teacher);
    if (!matches.length) throw new WeeklyPptError(`${sourceClass.className} 담임 '${sourceClass.teacher}'을 운영 앱에서 찾지 못했습니다.`);
    if (matches.length > 1) throw new WeeklyPptError(`${sourceClass.className} 담임 이름이 운영 앱에 중복되어 있습니다: ${sourceClass.teacher}`);
    const teacher = matches[0];
    if (!teacher?.hasTtt) {
      throw new WeeklyPptError(`${sourceClass.teacher}의 통통통 계정을 먼저 연결해 주세요. (${sourceClass.className})`);
    }
    const isTuesday = sourceClass.className[1]?.toUpperCase() === 'T';
    const scheduleGroup: WeeklyScheduleGroup = isTuesday ? '화목토반' : '월수금반';
    return {
      className: sourceClass.className,
      teacher: sourceClass.teacher,
      tid: cleanWeeklyText(teacher?.tid),
      scheduleGroup,
      scheduleLabel: isTuesday ? '화목토' : '월수금',
      examDate: dates[scheduleGroup],
    };
  });
}

function elementaryGrade(className: string): string {
  const match = cleanWeeklyText(className).match(/^([456])/);
  if (!match) throw new WeeklyPptError(`초등부 학년을 반명에서 확인할 수 없습니다: ${className}`);
  return match[1];
}

export function rankGroupKey(className: string, metadata: WeeklyCourseMetadata): string {
  return `grade:${elementaryGrade(className)}|${metadata.schoolLevel}:${metadata.semesterKey}|${metadata.variant || '공통'}`;
}

export function rankGroupLabel(className: string, metadata: WeeklyCourseMetadata): string {
  const sourceGrade = `초${elementaryGrade(className)}`;
  const course = `${metadata.schoolLevel === 'middle' ? '중' : '초'}${metadata.semesterKey}`;
  const variant = metadata.variant ? ` · ${metadata.variant}반` : '';
  return `${sourceGrade} · ${course}${variant}`;
}

function resolveElementaryChapter(semesterKey: string, unitName: string): string {
  const explicit = cleanWeeklyText(unitName).match(/^(\d+)\s*(?:단원|단|\.)?/);
  if (explicit) return explicit[1];
  return ELEMENTARY_CHAPTERS[semesterKey]?.[normalizeUnit(unitName)] || '';
}

export function formatExamRange(metadata: WeeklyCourseMetadata, unitName: string, chapter: number): string {
  const displayUnit = cleanDisplayUnit(unitName);
  if (!displayUnit) throw new WeeklyPptError(`${metadata.semesterKey} 과정의 단원명을 입력해 주세요.`);
  if (metadata.schoolLevel === 'middle') {
    const variant = metadata.semesterKey === '1-1'
      ? ` (${metadata.variant === 'NPR' ? 'NPR반' : '개유라반'})`
      : '';
    return `중${metadata.semesterKey} ${chapter}단원${variant}`;
  }

  const resolved = resolveElementaryChapter(metadata.semesterKey, unitName);
  if (resolved && Number(resolved) !== chapter) {
    throw new WeeklyPptError(
      `${metadata.semesterKey} 단원 불일치: 입력한 '${unitName}'은 ${resolved}단원인데 단원 번호는 ${chapter}단원입니다.`,
    );
  }
  return `${metadata.semesterKey} ${chapter}단원 ${displayUnit}`;
}

export function activeClassAssignments(
  state: any,
  dates: Record<WeeklyScheduleGroup, string>,
): WeeklyClassAssignment[] {
  assertIsoDate(dates['월수금반'], 'M반 시험일');
  assertIsoDate(dates['화목토반'], 'T반 시험일');
  const assignments: WeeklyClassAssignment[] = [];
  const seen = new Set<string>();

  for (const teacher of Array.isArray(state?.teachers) ? state.teachers : []) {
    for (const scheduleGroup of WEEKLY_SCHEDULE_GROUPS) {
      const classes = Array.isArray(teacher?.classes?.[scheduleGroup]) ? teacher.classes[scheduleGroup] : [];
      for (const rawClass of classes) {
        const className = cleanWeeklyText(rawClass);
        if (!/^[456][MT]/i.test(className)) continue;
        if (!teacher?.hasTtt) {
          throw new WeeklyPptError(`${teacher?.name || teacher?.tid || '강사'}의 통통통 계정을 먼저 연결해 주세요. (${className})`);
        }
        if (seen.has(className)) throw new WeeklyPptError(`운영 앱에 반이 중복 배정되어 있습니다: ${className}`);
        seen.add(className);
        assignments.push({
          className,
          teacher: cleanWeeklyText(teacher?.name),
          tid: cleanWeeklyText(teacher?.tid),
          scheduleGroup,
          scheduleLabel: scheduleGroup === '월수금반' ? '월수금' : '화목토',
          examDate: dates[scheduleGroup],
        });
      }
    }
  }
  if (!assignments.length) throw new WeeklyPptError('주간테스트 대상 정규반을 찾지 못했습니다.');
  return assignments;
}

function courseSortKey(plan: Pick<WeeklyClassPlan, 'className' | 'metadata'>): Array<number | string> {
  const [courseGrade, semester] = plan.metadata.semesterKey.split('-').map(Number);
  const variantOrder = plan.metadata.variant === '개유라' ? 0 : plan.metadata.variant === 'NPR' ? 1 : 0;
  return [
    -Number(elementaryGrade(plan.className)),
    plan.metadata.schoolLevel === 'middle' ? 0 : 1,
    -courseGrade,
    -semester,
    variantOrder,
    plan.className,
  ];
}

function compareSortKeys(left: Array<number | string>, right: Array<number | string>): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return naturalCollator.compare(String(a ?? ''), String(b ?? ''));
  }
  return 0;
}

function classCatalogEntries(
  assignments: WeeklyClassAssignment[],
  courseMappings: Record<string, string>,
): Array<WeeklyClassAssignment & {
  primaryCourse: string;
  metadata: WeeklyCourseMetadata;
  rankGroupKey: string;
  rankGroupLabel: string;
}> {
  const normalizedMappings = validateWeeklyCourseMappings(assignments, courseMappings);
  return assignments.map((assignment) => {
    const primaryCourse = normalizedMappings[assignment.className];
    const metadata = courseMetadata(primaryCourse);
    return {
      ...assignment,
      primaryCourse,
      metadata,
      rankGroupKey: rankGroupKey(assignment.className, metadata),
      rankGroupLabel: rankGroupLabel(assignment.className, metadata),
    };
  }).sort((left, right) => compareSortKeys(courseSortKey(left), courseSortKey(right)));
}

export function validateWeeklyCourseMappings(
  assignments: WeeklyClassAssignment[],
  courseMappings: Record<string, string>,
): Record<string, string> {
  if (!courseMappings || typeof courseMappings !== 'object' || Array.isArray(courseMappings)) {
    throw new WeeklyPptError('현재 분기의 반별 주과정을 먼저 확인·저장해 주세요.');
  }
  const missingCatalog = assignments
    .map((item) => item.className)
    .filter((className) => !cleanWeeklyText(courseMappings[className]))
    .sort(naturalCollator.compare);
  if (missingCatalog.length) {
    throw new WeeklyPptError(`주과정을 선택하지 않은 운영 반: ${missingCatalog.join(', ')}`);
  }

  const normalized: Record<string, string> = {};
  for (const assignment of assignments) {
    const primaryCourse = cleanWeeklyText(courseMappings[assignment.className]);
    const metadata = courseMetadata(primaryCourse);
    normalized[assignment.className] = metadata.raw;
  }
  return normalized;
}

export function weeklyMappingGroups(
  assignments: WeeklyClassAssignment[],
  courseMappings: Record<string, string>,
): WeeklyMappingGroup[] {
  const groups = new Map<string, WeeklyMappingGroup>();
  for (const entry of classCatalogEntries(assignments, courseMappings)) {
    const current = groups.get(entry.rankGroupKey) || {
      rankGroupKey: entry.rankGroupKey,
      rankGroupLabel: entry.rankGroupLabel,
      primaryCourse: entry.primaryCourse,
      classNames: [],
    };
    current.classNames.push(entry.className);
    groups.set(entry.rankGroupKey, current);
  }
  return Array.from(groups.values()).map((group) => ({
    ...group,
    classNames: group.classNames.sort(naturalCollator.compare),
  }));
}

export function buildWeeklyPlans(
  assignments: WeeklyClassAssignment[],
  courseMappings: Record<string, string>,
  unitMappings: Record<string, string>,
  chapter: number,
): WeeklyClassPlan[] {
  if (!Number.isInteger(chapter) || chapter < 1) throw new WeeklyPptError('단원 번호는 1 이상이어야 합니다.');
  const entries = classCatalogEntries(assignments, courseMappings);
  const groups = weeklyMappingGroups(assignments, courseMappings);
  const missingGroups = groups.filter((group) => !cleanDisplayUnit(unitMappings[group.rankGroupKey]));
  if (missingGroups.length) {
    throw new WeeklyPptError(`단원명을 입력하지 않은 석차 그룹: ${missingGroups.map((group) => group.rankGroupLabel).join(', ')}`);
  }

  return entries.map((entry) => {
    const unitName = cleanWeeklyText(unitMappings[entry.rankGroupKey]);
    return {
      ...entry,
      unitName,
      examRange: formatExamRange(entry.metadata, unitName, chapter),
      planSheet: '웹 직접 입력',
    };
  });
}

export function parseWeeklyScore(value: unknown): number | null {
  const text = cleanWeeklyText(value);
  if (!text) return null;
  const score = Number(text);
  if (!Number.isFinite(score)) throw new WeeklyPptError(`숫자가 아닌 성적이 있습니다: ${text}`);
  return score;
}

export function balancedPageSizes(total: number, maximum = WEEKLY_MAX_STUDENTS_PER_SLIDE): number[] {
  if (!Number.isInteger(total) || total < 0) throw new WeeklyPptError('학생 수는 0 이상의 정수여야 합니다.');
  if (!Number.isInteger(maximum) || maximum < 1) throw new WeeklyPptError('슬라이드 최대 인원은 1명 이상이어야 합니다.');
  if (total === 0) return [];
  const pageCount = Math.ceil(total / maximum);
  const base = Math.floor(total / pageCount);
  const largerCount = total % pageCount;
  return Array.from({ length: pageCount }, (_, index) => base + (index < largerCount ? 1 : 0));
}

export function buildWinnerPages(classResults: WeeklyClassResult[]): {
  pages: WeeklyWinnerPage[];
  groups: WeeklyGroupSummary[];
} {
  const grouped = new Map<string, {
    rankGroupLabel: string;
    examRange: string;
    sourceClasses: string[];
    students: WeeklyStudentScore[];
  }>();
  for (const result of classResults) {
    const current = grouped.get(result.rankGroupKey) || {
      rankGroupLabel: result.rankGroupLabel,
      examRange: result.examRange,
      sourceClasses: [],
      students: [],
    };
    if (current.examRange !== result.examRange) {
      throw new WeeklyPptError(`${result.rankGroupLabel} 석차 그룹의 시험 범위가 서로 다릅니다.`);
    }
    current.sourceClasses.push(result.className);
    current.students.push(...result.students.filter((student) => Number.isFinite(student.score)));
    grouped.set(result.rankGroupKey, current);
  }

  const pages: WeeklyWinnerPage[] = [];
  const groups: WeeklyGroupSummary[] = [];
  for (const [key, group] of grouped) {
    const topScore = group.students.length ? Math.max(...group.students.map((student) => student.score)) : null;
    const winners = topScore === null ? [] : group.students
      .filter((student) => student.score === topScore)
      .sort((left, right) => naturalCollator.compare(left.className, right.className) || naturalCollator.compare(left.name, right.name))
      .map((student) => {
        const school = cleanWeeklyText(student.school);
        if (!school) throw new WeeklyPptError(`${student.className} ${student.name} 학생의 학교를 확인할 수 없습니다.`);
        return { ...student, school, pptRank: 1 as const };
      });
    const sourceClasses = Array.from(new Set(group.sourceClasses)).sort(naturalCollator.compare);
    groups.push({
      rankGroupKey: key,
      rankGroupLabel: group.rankGroupLabel,
      sourceClasses,
      topScore,
      winnerCount: winners.length,
    });
    let start = 0;
    balancedPageSizes(winners.length).forEach((pageSize, index) => {
      pages.push({
        rankGroupKey: key,
        rankGroupLabel: group.rankGroupLabel,
        sourceClasses,
        examRange: group.examRange,
        students: winners.slice(start, start + pageSize),
        pageIndex: index + 1,
      });
      start += pageSize;
    });
  }
  if (!pages.length) throw new WeeklyPptError('PPT에 넣을 우수학생이 없습니다. 성적 입력 여부를 확인해 주세요.');
  return { pages, groups };
}

export function winnerNamesByClass(classResults: WeeklyClassResult[]): Map<string, string[]> {
  const withoutSchool = classResults.map((result) => ({
    ...result,
    students: result.students.map((student) => ({ ...student, school: student.school || '학교 확인 전' })),
  }));
  const { pages } = buildWinnerPages(withoutSchool);
  const names = new Map<string, string[]>();
  for (const page of pages) {
    for (const student of page.students) {
      const current = names.get(student.className) || [];
      if (!current.includes(student.name)) current.push(student.name);
      names.set(student.className, current);
    }
  }
  return names;
}

function normalizedStudentName(value: string): string {
  return cleanWeeklyText(value).replace(/\d+$/, '');
}

export function matchWeeklyRosterScores<T extends { name: string }>(
  rosterNames: string[],
  scoreRows: T[],
  className: string,
): T[] {
  const scoresByExactName = new Map<string, T>();
  const scoresByBaseName = new Map<string, T[]>();
  for (const row of scoreRows) {
    const name = cleanWeeklyText(row.name);
    if (!name) continue;
    if (scoresByExactName.has(name)) {
      throw new WeeklyPptError(`${className} 통통통 성적에 같은 학생이 중복되어 있습니다: ${name}`);
    }
    scoresByExactName.set(name, row);
    const baseName = normalizedStudentName(name);
    const candidates = scoresByBaseName.get(baseName) || [];
    candidates.push(row);
    scoresByBaseName.set(baseName, candidates);
  }

  const matchedByRosterName = new Map<string, T>();
  const usedRows = new Set<T>();
  for (const rosterName of rosterNames) {
    const exact = scoresByExactName.get(cleanWeeklyText(rosterName));
    if (!exact || usedRows.has(exact)) continue;
    matchedByRosterName.set(rosterName, exact);
    usedRows.add(exact);
  }

  for (const rosterName of rosterNames) {
    if (matchedByRosterName.has(rosterName)) continue;
    const candidates = (scoresByBaseName.get(normalizedStudentName(rosterName)) || [])
      .filter((row) => !usedRows.has(row));
    if (candidates.length > 1) {
      throw new WeeklyPptError(`${className} ${rosterName} 학생과 일치하는 통통통 성적이 여러 개입니다.`);
    }
    if (candidates.length === 1) {
      matchedByRosterName.set(rosterName, candidates[0]);
      usedRows.add(candidates[0]);
    }
  }

  return rosterNames.flatMap((name) => {
    const row = matchedByRosterName.get(name);
    return row ? [row] : [];
  });
}

export function resolveWinnerSchools(
  attendanceRows: Array<{ name?: string; school?: string }>,
  className: string,
  wantedNames: string[],
): Map<string, string> {
  const exact = new Map<string, string>();
  const baseCandidates = new Map<string, Array<{ name: string; school: string }>>();
  for (const row of attendanceRows) {
    const name = cleanWeeklyText(row?.name);
    const school = cleanWeeklyText(row?.school);
    if (!name || !school) continue;
    exact.set(name, school);
    const base = normalizedStudentName(name);
    const candidates = baseCandidates.get(base) || [];
    candidates.push({ name, school });
    baseCandidates.set(base, candidates);
  }

  const resolved = new Map<string, string>();
  for (const wanted of wantedNames) {
    const exactSchool = exact.get(wanted);
    if (exactSchool) {
      resolved.set(wanted, exactSchool);
      continue;
    }
    const candidates = baseCandidates.get(normalizedStudentName(wanted)) || [];
    if (candidates.length === 1) {
      resolved.set(wanted, candidates[0].school);
      continue;
    }
    throw new WeeklyPptError(`${className} ${wanted} 학생의 학교를 출결 자료에서 확인할 수 없습니다.`);
  }
  return resolved;
}

const KOREAN_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function isoDateParts(value: string): { year: number; month: number; day: number; weekday: number } {
  assertIsoDate(value, '시험일');
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

function koreanDate(value: string, includeYear: boolean): string {
  const date = isoDateParts(value);
  const year = includeYear ? `${date.year}년 ` : '';
  return `${year}${date.month}월 ${date.day}일(${KOREAN_WEEKDAYS[date.weekday]})`;
}

export function weeklyExamSchedule(dates: Record<WeeklyScheduleGroup, string>): string {
  return `${koreanDate(dates['월수금반'], true)} ~ ${koreanDate(dates['화목토반'], false)}`;
}

export function weeklyOutputFilename(
  dates: Record<WeeklyScheduleGroup, string>,
  round: number,
  format: WeeklyOutputFormat = 'pptx',
): string {
  const start = isoDateParts(dates['월수금반']);
  const end = isoDateParts(dates['화목토반']);
  return `WT_우수학생_${start.month}월${start.day}-${end.day}일_${round}회차.${format}`;
}

function setParagraphLines(lines: string[]) {
  return (element: XmlElement) => {
    const paragraphs = element.getElementsByTagName('a:p');
    for (let index = 0; index < paragraphs.length; index += 1) {
      const texts = paragraphs.item(index)?.getElementsByTagName('a:t');
      if (!texts) continue;
      for (let textIndex = 0; textIndex < texts.length; textIndex += 1) {
        const node = texts.item(textIndex);
        if (node) node.textContent = textIndex === 0 ? (lines[index] || '') : '';
      }
    }
  };
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : String(Number(score.toFixed(2)));
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.once('end', () => resolve(Buffer.concat(chunks)));
    stream.once('error', reject);
  });
}

function xmlAttribute(fragment: string, name: string): string {
  const match = fragment.match(new RegExp(`\\b${name}=(['"])(.*?)\\1`));
  return match?.[2] || '';
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function relationshipSourcePart(relationshipPath: string): string {
  if (relationshipPath === '_rels/.rels') return '';
  return relationshipPath.replace(/(^|\/)\_rels\/([^/]+)\.rels$/, '$1$2');
}

function relationshipTargetPart(relationshipPath: string, target: string): string {
  const withoutFragment = decodeXmlAttribute(target).split('#', 1)[0];
  if (!withoutFragment || /^[a-z][a-z0-9+.-]*:/i.test(withoutFragment)) return '';
  const sourcePart = relationshipSourcePart(relationshipPath);
  const sourceDirectory = sourcePart ? path.posix.dirname(sourcePart) : '';
  const joined = withoutFragment.startsWith('/')
    ? withoutFragment.slice(1)
    : path.posix.join(sourceDirectory === '.' ? '' : sourceDirectory, withoutFragment);
  const normalized = path.posix.normalize(joined).replace(/^\.\//, '');
  return normalized.startsWith('../') ? '' : normalized;
}

async function normalizeWeeklyPptPackage(archive: JSZip): Promise<void> {
  const presentation = archive.file('ppt/presentation.xml');
  const presentationRels = archive.file('ppt/_rels/presentation.xml.rels');
  if (!presentation || !presentationRels) return;
  const presentationXml = await presentation.async('string');
  const relsXml = await presentationRels.async('string');

  const relationshipTargets = new Map<string, string>();
  for (const relationship of relsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    const id = xmlAttribute(relationship[1], 'Id');
    const target = relationshipTargetPart('ppt/_rels/presentation.xml.rels', xmlAttribute(relationship[1], 'Target'));
    if (id && target) relationshipTargets.set(id, target);
  }
  const referencedSlides = new Set<string>();
  for (const slide of presentationXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)) {
    const target = relationshipTargets.get(slide[1]);
    if (target) referencedSlides.add(target);
  }

  // pptx-automizer가 cleanup:false에서 남기는, 슬라이드 목록에 없는 고아 슬라이드 제거
  const orphanSlides = new Set<string>();
  for (const name of Object.keys(archive.files)) {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(name) && !referencedSlides.has(name)) orphanSlides.add(name);
  }
  for (const part of orphanSlides) {
    archive.remove(part);
    const relName = part.replace(/slides\/(slide\d+)\.xml$/, 'slides/_rels/$1.xml.rels');
    if (archive.file(relName)) archive.remove(relName);
  }
  if (orphanSlides.size) {
    const cleanedRels = relsXml.replace(/<Relationship\b([^>]*)\/?\s*>/g, (tag, attributes) => {
      const target = relationshipTargetPart('ppt/_rels/presentation.xml.rels', xmlAttribute(attributes, 'Target'));
      return target && orphanSlides.has(target) ? '' : tag;
    });
    archive.file('ppt/_rels/presentation.xml.rels', cleanedRels);
  }

  // [Content_Types].xml: 고아 슬라이드 Override 제거 + PartName 중복 제거(automizer 중복 생성 방지)
  const contentTypes = archive.file('[Content_Types].xml');
  if (contentTypes) {
    const xml = await contentTypes.async('string');
    const seen = new Set<string>();
    const cleaned = xml.replace(/<Override\b([^>]*)\/?\s*>/g, (tag, attributes) => {
      const partName = decodeXmlAttribute(xmlAttribute(attributes, 'PartName')).replace(/^\//, '');
      if (!partName) return tag;
      if (orphanSlides.has(partName) || seen.has(partName)) return '';
      seen.add(partName);
      return tag;
    });
    archive.file('[Content_Types].xml', cleaned);
  }
}

export async function weeklyPptPackageIssues(input: Buffer): Promise<string[]> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(input);
  } catch {
    return ['PPTX ZIP 패키지를 열 수 없습니다.'];
  }

  const requiredParts = ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels'];
  const issues = requiredParts.filter((part) => !archive.file(part)).map((part) => `필수 파트 누락: ${part}`);
  const relationshipFiles = Object.keys(archive.files).filter((name) => name.endsWith('.rels'));
  for (const relationshipPath of relationshipFiles) {
    const file = archive.file(relationshipPath);
    if (!file) continue;
    const xml = await file.async('string');
    const relationships = xml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g);
    for (const relationship of relationships) {
      const attributes = relationship[1];
      if (/\bTargetMode=(['"])External\1/.test(attributes)) continue;
      const target = xmlAttribute(attributes, 'Target');
      const targetPart = relationshipTargetPart(relationshipPath, target);
      if (!targetPart || archive.file(targetPart)) continue;
      const id = xmlAttribute(attributes, 'Id') || '(ID 없음)';
      issues.push(`관계 대상 누락: ${relationshipPath} ${id} -> ${targetPart}`);
    }
  }

  const contentTypes = archive.file('[Content_Types].xml');
  if (contentTypes) {
    const xml = await contentTypes.async('string');
    const seen = new Set<string>();
    for (const override of xml.matchAll(/<Override\b([^>]*)\/?\s*>/g)) {
      const partName = decodeXmlAttribute(xmlAttribute(override[1], 'PartName')).replace(/^\//, '');
      if (!partName) continue;
      if (seen.has(partName)) issues.push(`콘텐츠 형식 중복: ${partName}`);
      seen.add(partName);
      if (!archive.file(partName)) issues.push(`콘텐츠 파트 누락: ${partName}`);
    }
  }
  return issues;
}

async function finalizeWeeklyPpt(input: Buffer): Promise<Buffer> {
  const archive = await JSZip.loadAsync(input);
  await normalizeWeeklyPptPackage(archive);
  const output = await archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  const issues = await weeklyPptPackageIssues(output);
  if (issues.length) {
    throw new WeeklyPptError(`PPT 내부 구조 검증에 실패했습니다: ${issues.slice(0, 3).join(' / ')}`);
  }
  return output;
}

const WEEKLY_PDF_WIDTH = 780;
const WEEKLY_PDF_HEIGHT = 540;
const WEEKLY_PDF_REGULAR_FONT = path.join('node_modules', '@kfonts', 'nanum-gothic', 'src', 'NanumGothic.ttf');
const WEEKLY_PDF_BOLD_FONT = path.join('node_modules', '@kfonts', 'nanum-gothic', 'src', 'NanumGothicBold.ttf');

interface WeeklyPdfAssets {
  background: Buffer;
  bookIcon: Buffer;
  calendarIcon: Buffer;
  regularFont: Buffer;
  boldFont: Buffer;
}

interface WeeklyPdfStudentLayout {
  rankX: number;
  rankWidth: number;
  scoreX: number;
  scoreWidth: number;
  studentX: number;
  studentWidth: number;
  y: number;
  fontSize: number;
  lineHeight: number;
}

const WEEKLY_PDF_STUDENT_LAYOUTS: Record<number, WeeklyPdfStudentLayout> = {
  1: { rankX: 38.94, rankWidth: 98.42, scoreX: 141.73, scoreWidth: 125.98, studentX: 283.46, studentWidth: 629.92, y: 285.15, fontSize: 36, lineHeight: 1.3 },
  2: { rankX: 65.73, rankWidth: 98.42, scoreX: 145.67, scoreWidth: 127.86, studentX: 279.53, studentWidth: 598.43, y: 249.1, fontSize: 35, lineHeight: 1.3 },
  3: { rankX: 65.73, rankWidth: 98.42, scoreX: 145.67, scoreWidth: 127.86, studentX: 279.53, studentWidth: 598.43, y: 249.1, fontSize: 35, lineHeight: 1.3 },
  4: { rankX: 60.43, rankWidth: 98.42, scoreX: 125.98, scoreWidth: 137.8, studentX: 283.46, studentWidth: 496.06, y: 224.41, fontSize: 30, lineHeight: 1.3 },
  5: { rankX: 60.43, rankWidth: 98.42, scoreX: 125.98, scoreWidth: 137.8, studentX: 283.46, studentWidth: 496.06, y: 224.41, fontSize: 30, lineHeight: 1.3 },
  6: { rankX: 64.18, rankWidth: 98.42, scoreX: 125.98, scoreWidth: 137.8, studentX: 283.46, studentWidth: 496.06, y: 222.52, fontSize: 24, lineHeight: 1.2 },
  7: { rankX: 64.18, rankWidth: 98.42, scoreX: 125.98, scoreWidth: 137.8, studentX: 283.46, studentWidth: 496.06, y: 222.52, fontSize: 24, lineHeight: 1.2 },
};

const weeklyPdfAssets = new Map<string, Promise<WeeklyPdfAssets>>();

function requiredZipPart(archive: JSZip, name: string): Promise<Buffer> {
  const file = archive.file(name);
  if (!file) throw new WeeklyPptError(`내장 PPT 템플릿에서 PDF 자산을 찾지 못했습니다: ${name}`);
  return file.async('nodebuffer');
}

function loadWeeklyPdfAssets(templatePath: string): Promise<WeeklyPdfAssets> {
  const cached = weeklyPdfAssets.get(templatePath);
  if (cached) return cached;
  const loading = (async () => {
    const archive = await JSZip.loadAsync(await readFile(templatePath));
    const [background, bookIcon, calendarIcon, regularFont, boldFont] = await Promise.all([
      requiredZipPart(archive, 'ppt/media/image2.png'),
      requiredZipPart(archive, 'ppt/media/image6.png'),
      requiredZipPart(archive, 'ppt/media/image8.png'),
      readFile(path.join(process.cwd(), WEEKLY_PDF_REGULAR_FONT)),
      readFile(path.join(process.cwd(), WEEKLY_PDF_BOLD_FONT)),
    ]);
    return { background, bookIcon, calendarIcon, regularFont, boldFont };
  })();
  weeklyPdfAssets.set(templatePath, loading);
  return loading;
}

function drawWeeklyPdfLine(
  document: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  align: 'left' | 'right',
  characterSpacing = 0,
): void {
  document.text(text, x, y, {
    width,
    align,
    lineBreak: false,
    characterSpacing,
  });
}

export async function createWeeklyWinnerPdf(
  templatePath: string,
  pages: WeeklyWinnerPage[],
  examSchedule: string,
): Promise<Buffer> {
  if (!pages.length) throw new WeeklyPptError('생성할 슬라이드가 없습니다.');
  const assets = await loadWeeklyPdfAssets(templatePath);
  const document = new PDFDocument({
    autoFirstPage: false,
    compress: true,
    info: { Title: '주간테스트 최우수 학생', Creator: '업무일지 유틸리티' },
  });
  const output = streamToBuffer(document);
  document.registerFont('WeeklyRegular', assets.regularFont);
  document.registerFont('WeeklyBold', assets.boldFont);
  const imageDocument = document as PDFKit.PDFDocument & { openImage(source: Buffer): any };
  const backgroundImage = imageDocument.openImage(assets.background);
  const calendarImage = imageDocument.openImage(assets.calendarIcon);
  const bookImage = imageDocument.openImage(assets.bookIcon);

  for (const page of pages) {
    const count = page.students.length;
    const layout = WEEKLY_PDF_STUDENT_LAYOUTS[count];
    if (!layout) throw new WeeklyPptError(`지원하지 않는 PDF 페이지 인원입니다: ${count}명`);
    document.addPage({ size: [WEEKLY_PDF_WIDTH, WEEKLY_PDF_HEIGHT], margin: 0 });
    document.image(backgroundImage, 0, 0, { width: WEEKLY_PDF_WIDTH, height: WEEKLY_PDF_HEIGHT });
    document.image(calendarImage, 43.35, 118.25, { width: 50.69, height: 50.69 });
    document.image(bookImage, 42.61, 168.58, { width: 51.43, height: 51.43 });
    document.font('WeeklyRegular').fontSize(25).fillColor('#111111');
    drawWeeklyPdfLine(document, `시험 일정 : ${examSchedule}`, 107.85, 128.42, 649.03, 'left');
    drawWeeklyPdfLine(document, `시험 범위 : ${page.examRange}`, 107.85, 179.11, 649.03, 'left');

    page.students.forEach((student, index) => {
      const lineY = layout.y + (index * layout.fontSize * layout.lineHeight);
      document.font('WeeklyBold').fontSize(layout.fontSize);
      drawWeeklyPdfLine(document, '1등', layout.rankX, lineY, layout.rankWidth, 'right');
      document.font('WeeklyRegular').fontSize(layout.fontSize);
      drawWeeklyPdfLine(document, `${formatScore(student.score)}점`, layout.scoreX, lineY, layout.scoreWidth, 'right', -1.5);
      drawWeeklyPdfLine(
        document,
        `${student.className}  ${student.name}  (${student.school})`,
        layout.studentX,
        lineY,
        layout.studentWidth,
        'left',
      );
    });
  }
  document.end();
  return output;
}

export async function createWeeklyWinnerPpt(
  templatePath: string,
  pages: WeeklyWinnerPage[],
  examSchedule: string,
): Promise<Buffer> {
  if (!pages.length) throw new WeeklyPptError('생성할 슬라이드가 없습니다.');
  const templateDir = templatePath.replace(/[/\\][^/\\]+$/, '');
  const templateName = templatePath.slice(templateDir.length + 1);
  const automizer = new Automizer({
    templateDir,
    removeExistingSlides: true,
    autoImportSlideMasters: false,
    cleanup: false,
    compression: 9,
    verbosity: 0,
  });
  automizer.loadRoot(templateName).load(templateName, 'weekly');

  for (const page of pages) {
    const count = page.students.length;
    if (count < 1 || count > WEEKLY_MAX_STUDENTS_PER_SLIDE) {
      throw new WeeklyPptError(`지원하지 않는 슬라이드 인원입니다: ${count}명`);
    }
    const scheduleShape = [1, 4, 5].includes(count) ? 'TextBox 1' : 'TextBox 12';
    automizer.addSlide('weekly', 20 + count, (slide) => {
      slide.modifyElement(scheduleShape, setParagraphLines([`시험 일정 : ${examSchedule}`]));
      slide.modifyElement('TextBox 2', setParagraphLines([`시험 범위 : ${page.examRange}`]));
      slide.modifyElement('TextBox 8', setParagraphLines(page.students.map(() => '1등')));
      slide.modifyElement('TextBox 16', setParagraphLines(page.students.map((student) => `${formatScore(student.score)}점`)));
      slide.modifyElement(
        'TextBox 17',
        setParagraphLines(page.students.map((student) => `${student.className}  ${student.name}  (${student.school})`)),
      );
    });
  }

  const stream = await automizer.stream({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  return finalizeWeeklyPpt(await streamToBuffer(stream));
}
