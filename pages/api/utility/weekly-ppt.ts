import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';
import { backend } from '@/src/backend';
import {
  WeeklyPptError,
  type WeeklyClassAssignment,
  type WeeklyClassPlan,
  type WeeklyClassResult,
  type WeeklyWorkbookCatalog,
  buildWeeklyPlans,
  buildWinnerPages,
  cleanWeeklyText,
  createWeeklyWinnerPdf,
  createWeeklyWinnerPpt,
  parseWeeklyStudentWorkbook,
  parseWeeklyScore,
  matchWeeklyRosterScores,
  resolveWinnerSchools,
  weeklyExamSchedule,
  weeklyMappingGroups,
  weeklyOutputFilename,
  workbookClassAssignments,
  winnerNamesByClass,
} from '@/src/weekly/weekly-ppt';
import type { WeeklyOutputFormat } from '@/src/weekly/weekly-ppt';

export const config = {
  maxDuration: 120,
  api: {
    bodyParser: { sizeLimit: '6mb' },
    responseLimit: '8mb',
  },
};

class WeeklyExternalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeeklyExternalError';
  }
}

function queryString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new WeeklyPptError(`${label}는 1 이상의 정수여야 합니다.`);
  return parsed;
}

function outputFormat(value: unknown): WeeklyOutputFormat {
  if (value === undefined || value === null || value === '') return 'pptx';
  if (value === 'pptx' || value === 'pdf') return value;
  throw new WeeklyPptError('다운로드 형식은 PPT 또는 PDF만 지원합니다.');
}

function unitMappingsFromBody(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WeeklyPptError('석차 그룹별 단원명을 입력해 주세요.');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) throw new WeeklyPptError('단원 매핑 수가 너무 많습니다.');
  const mappings: Record<string, string> = {};
  for (const [key, raw] of entries) {
    const unitName = cleanWeeklyText(raw);
    if (!key || key.length > 120 || unitName.length > 100) throw new WeeklyPptError('단원 매핑 형식을 확인해 주세요.');
    mappings[key] = unitName;
  }
  return mappings;
}

function studentWorkbookFromBody(body: Record<string, any>): { filename: string; buffer: Buffer } {
  const filename = cleanWeeklyText(body.studentWorkbookName);
  const encoded = cleanWeeklyText(body.studentWorkbookBase64);
  if (!filename || !encoded) throw new WeeklyPptError('학생 목록 Excel 파일을 선택해 주세요.');
  if (!/\.xlsx$/i.test(filename)) throw new WeeklyPptError('학생 목록은 .xlsx 파일만 사용할 수 있습니다.');
  if (encoded.length > 4_100_000 || !/^[A-Za-z0-9+/=]+$/.test(encoded)) {
    throw new WeeklyPptError('학생 목록 Excel 파일의 크기나 형식을 확인해 주세요.');
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.length > 3_000_000 || buffer.subarray(0, 2).toString('ascii') !== 'PK') {
    throw new WeeklyPptError('학생 목록 Excel 파일의 크기나 형식을 확인해 주세요.');
  }
  return { filename, buffer };
}

function workbookContext(assignments: WeeklyClassAssignment[], workbook: WeeklyWorkbookCatalog) {
  const classesByName = new Map(workbook.classes.map((item) => [item.className, item]));
  const missing = assignments
    .map((item) => item.className)
    .filter((className) => !classesByName.has(className))
    .sort((left, right) => left.localeCompare(right, 'ko', { numeric: true }));
  if (missing.length) throw new WeeklyPptError(`학생 목록 Excel에 없는 운영 반: ${missing.join(', ')}`);
  const courseMappings = Object.fromEntries(assignments.map((item) => [
    item.className,
    classesByName.get(item.className)!.primaryCourse,
  ]));
  return { classesByName, courseMappings };
}

function mappingPayload(
  assignments: WeeklyClassAssignment[],
  workbook: WeeklyWorkbookCatalog,
  filename: string,
  courseMappings: Record<string, string>,
) {
  const groups = weeklyMappingGroups(assignments, courseMappings);
  const activeNames = new Set(assignments.map((item) => item.className));
  const studentCount = workbook.classes
    .filter((item) => activeNames.has(item.className))
    .reduce((sum, item) => sum + item.studentNames.length, 0);
  return {
    ok: true,
    filename,
    sheetName: workbook.sheetName,
    workbookClassCount: workbook.classes.length,
    classCount: assignments.length,
    studentCount,
    groupCount: groups.length,
    groups,
  };
}

async function forEachTeacher<T extends WeeklyClassAssignment>(
  assignments: T[],
  worker: (assignment: T) => Promise<void>,
): Promise<void> {
  const groups = new Map<string, T[]>();
  for (const assignment of assignments) {
    const current = groups.get(assignment.tid) || [];
    current.push(assignment);
    groups.set(assignment.tid, current);
  }
  await Promise.all(Array.from(groups.values()).map(async (items) => {
    for (const item of items) await worker(item);
  }));
}

function previewPayload(
  plans: WeeklyClassPlan[],
  dates: { 월수금반: string; 화목토반: string },
  classesByName: Map<string, WeeklyWorkbookCatalog['classes'][number]>,
) {
  return {
    ok: true,
    classCount: plans.length,
    groupCount: new Set(plans.map((plan) => plan.rankGroupKey)).size,
    examSchedule: weeklyExamSchedule(dates),
    classes: plans.map((plan) => ({
      className: plan.className,
      schedule: plan.scheduleLabel,
      examDate: plan.examDate,
      primaryCourse: plan.primaryCourse,
      unitName: plan.unitName,
      examRange: plan.examRange,
      rankGroupLabel: plan.rankGroupLabel,
      studentCount: classesByName.get(plan.className)?.studentNames.length || 0,
    })),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ message: 'POST 요청만 지원합니다.' });
    return;
  }

  const role = queryString(req.query.role);
  const tid = queryString(req.query.tid);
  if (role !== 'lead' || !tid) {
    res.status(403).json({ message: '팀장 계정으로 로그인해 주세요.' });
    return;
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const mode = body.mode === 'generate'
      ? 'generate'
      : body.mode === 'preview'
        ? 'preview'
        : body.mode === 'catalog'
          ? 'catalog'
          : '';
    if (!mode) throw new WeeklyPptError('지원하지 않는 생성 단계입니다.');
    const round = positiveInteger(body.round, '회차');
    const chapter = positiveInteger(body.chapter, '단원 번호');
    const format = outputFormat(body.format);
    const dates = {
      월수금반: cleanWeeklyText(body.mDate),
      화목토반: cleanWeeklyText(body.tDate),
    };

    const { db, store, ttt } = backend();
    db.sync();
    const state = store.getState('lead', tid);
    const workbookInput = studentWorkbookFromBody(body);
    const workbook = await parseWeeklyStudentWorkbook(workbookInput.buffer);
    const assignments = workbookClassAssignments(state, workbook, dates);
    const { classesByName, courseMappings } = workbookContext(assignments, workbook);
    if (mode === 'catalog') {
      res.status(200).json(mappingPayload(assignments, workbook, workbookInput.filename, courseMappings));
      return;
    }

    const plans = buildWeeklyPlans(assignments, courseMappings, unitMappingsFromBody(body.unitMappings), chapter);
    if (mode === 'preview') {
      res.status(200).json(previewPayload(plans, dates, classesByName));
      return;
    }

    const results = new Map<string, WeeklyClassResult>();
    try {
      await forEachTeacher(plans, async (plan) => {
        const creds = store.getTeacherTtt(plan.tid);
        const rows = await ttt.getScoresStrict(plan.className, plan.examDate, plan.examDate, creds);
        const scoreRows = [];
        for (const row of rows) {
          const score = parseWeeklyScore(row.total);
          const name = cleanWeeklyText(row.student);
          if (score === null || !name) continue;
          scoreRows.push({
            name,
            className: plan.className,
            score,
            apiRank: cleanWeeklyText(row.rank),
            participants: cleanWeeklyText(row.examinees),
          });
        }
        const students = matchWeeklyRosterScores(
          classesByName.get(plan.className)?.studentNames || [],
          scoreRows,
          plan.className,
        );
        results.set(plan.className, { ...plan, students, sourceRowCount: rows.length });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WeeklyExternalError(message);
    }

    const classResults = plans.map((plan) => results.get(plan.className)!);
    const scoredStudentCount = classResults.reduce((sum, result) => sum + result.students.length, 0);
    if (!scoredStudentCount) throw new WeeklyPptError('숫자 성적이 입력된 학생이 없습니다. 시험일을 확인해 주세요.');

    const winners = winnerNamesByClass(classResults);
    const assignmentsByClass = new Map(plans.map((plan) => [plan.className, plan]));
    const schoolMaps = new Map<string, Map<string, string>>();
    try {
      const winnerAssignments = Array.from(winners.keys()).map((className) => assignmentsByClass.get(className)!);
      await forEachTeacher(winnerAssignments, async (assignment) => {
        const creds = store.getTeacherTtt(assignment.tid);
        const rows = await ttt.getAttendanceStrict(assignment.className, assignment.examDate, creds);
        schoolMaps.set(
          assignment.className,
          resolveWinnerSchools(rows, assignment.className, winners.get(assignment.className) || []),
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new WeeklyExternalError(message);
    }

    for (const result of classResults) {
      const schools = schoolMaps.get(result.className);
      if (!schools) continue;
      for (const student of result.students) {
        const school = schools.get(student.name);
        if (school) student.school = school;
      }
    }

    const { pages, groups } = buildWinnerPages(classResults);
    const templatePath = path.join(process.cwd(), 'assets', 'templates', 'weekly-winners-1-7.pptx');
    const examSchedule = weeklyExamSchedule(dates);
    const output = format === 'pdf'
      ? await createWeeklyWinnerPdf(templatePath, pages, examSchedule)
      : await createWeeklyWinnerPpt(templatePath, pages, examSchedule);
    const filename = weeklyOutputFilename(dates, round, format);
    const contentType = format === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="weekly-test-${round}.${format}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Content-Length', String(output.length));
    res.setHeader('X-Weekly-Class-Count', String(plans.length));
    res.setHeader('X-Weekly-Group-Count', String(groups.length));
    res.setHeader('X-Weekly-Winner-Count', String(pages.reduce((sum, page) => sum + page.students.length, 0)));
    res.setHeader('X-Weekly-Slide-Count', String(pages.length));
    res.setHeader('X-Weekly-Format', format);
    res.status(200).send(output);
  } catch (error) {
    if (error instanceof WeeklyPptError) {
      res.status(400).json({ message: error.message });
      return;
    }
    if (error instanceof WeeklyExternalError) {
      console.warn('[WeeklyPpt] external read failed:', error.message);
      res.status(502).json({ message: `통통통 자료를 불러오지 못했습니다. ${error.message}` });
      return;
    }
    console.error('[WeeklyPpt] generation failed:', error);
    res.status(500).json({ message: '파일 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
  }
}
