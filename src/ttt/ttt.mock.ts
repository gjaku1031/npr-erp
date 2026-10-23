import { config } from '../config';
import type {
  NotebookPost,
  OwnedClassReadOptions,
  TttCreds,
  TttGateway,
} from './ttt.gateway';
import type {
  AttRow,
  Counsel,
  CounselPostInput,
  CounselPostResponse,
  CounselWriteEvidence,
  Notebook,
  RosterRow,
  ScoreRow,
} from './ttt.records';
import {
  SPECIAL_MWF_SCHEDULE,
  SPECIAL_TTS_SCHEDULE,
  TttSpecialError,
  type TttMotherPhoneBatchResult,
  type TttRegularClass,
  type TttRegularCurrentAssignment,
  type TttRegularTeacherClassSnapshot,
  type TttSpecialClass,
  type TttSpecialSnapshot,
  type TttSpecialStudent,
} from './ttt.special';

/**
 * 외부 ERP 모의 구현.
 *
 * 모든 자료는 반 이름·강사 이름·날짜에서 결정적으로 만든다. 같은 입력이면 프로세스를 다시 띄워도
 * 같은 반·원생·성적이 나오므로, 반 선택이나 상담 명단처럼 "조회 → 확인 → 적용"을 두 번 읽는 흐름도
 * 실제와 같이 동작한다. 게시한 알림장과 저장한 상담은 프로세스 메모리에만 남는다.
 * 사람 이름·학교·연락처는 모두 지어낸 값이다.
 */

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황'];
const GIVEN_NAMES = [
  '서준', '하윤', '도현', '지아', '예준', '서윤', '은우', '지호', '하율', '소율',
  '민준', '서연', '시우', '지민', '주원', '하은', '유준', '채원', '건우', '수아',
];
const SCHOOLS = ['새싹초', '열매초', '햇살초', '바람초', '구름초', '별빛초'];
const COUNSEL_SAMPLES: Array<{ topic: string; body: string }> = [
  { topic: '수업 태도 상담', body: '최근 집중 시간이 늘었음. 숙제 확인 방법을 보호자와 맞춤.' },
  { topic: '진도 상담', body: '분수 단원 오답이 많아 다음 주 보충 과제를 안내함.' },
  { topic: '결석 및 보강', body: '가족 일정으로 결석 예정. 다음 수업일 보강을 잡음.' },
];

/** 32비트 FNV-1a. 결정적 생성에만 쓴다. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function nowHm(): string {
  const d = new Date();
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`;
}

function monthOf(targetDateOrMonth: string): string {
  const month = String(targetDateOrMonth || '').slice(0, 7);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : config.today.slice(0, 7);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface MockStudent {
  code: string;
  name: string;
  school: string;
  grade: string;
}

/** 반 이름별 원생 명단. 반 안에서는 이름이 겹치지 않는다. */
function studentsOf(className: string): MockStudent[] {
  const seed = hash(`class|${className}`);
  const count = 6 + (seed % 5);
  const gradeDigit = className.match(/[1-6]/)?.[0] || '5';
  const used = new Set<string>();
  const students: MockStudent[] = [];
  for (let i = 0; students.length < count && i < count * 4; i += 1) {
    const h = hash(`student|${className}|${i}`);
    const name = SURNAMES[h % SURNAMES.length] + GIVEN_NAMES[(h >>> 8) % GIVEN_NAMES.length];
    if (used.has(name)) continue;
    used.add(name);
    students.push({
      code: `S${pad(100000 + (h % 900000), 6)}`,
      name,
      school: SCHOOLS[(h >>> 16) % SCHOOLS.length],
      grade: `초${gradeDigit}`,
    });
  }
  return students;
}

/** 반 코드는 반 이름에서 정한다. 같은 반 이름이면 어느 강사 계정에서 보아도 같은 코드다. */
function classCodeOf(className: string): string {
  return String(10000 + (hash(`code|${className}`) % 90000));
}

/** 실제 ERP처럼 긴 상담 본문은 목록에서 앞 10자 미리보기로만 돌려준다. */
function bodyPreview(content: string): string {
  return content.length > 10 ? content.slice(0, 10) : content;
}

function phoneOf(studentCode: string): string {
  return `010-0000-${pad(hash(`phone|${studentCode}`) % 10000, 4)}`;
}

function scheduleOf(dayGroup: 'M' | 'T') {
  return dayGroup === 'M' ? SPECIAL_MWF_SCHEDULE : SPECIAL_TTS_SCHEDULE;
}

function toSpecialStudent(student: MockStudent, classCode: string, month: string): TttSpecialStudent {
  return {
    studentCode: student.code,
    studentName: student.name,
    scode: student.code,
    student: student.name,
    classCode,
    division: '초등부',
    grade: student.grade,
    registrationStart: `${month}-01`,
    registrationEnd: '',
    status: '재원',
    nickname: '',
  };
}

interface MockClassPlan {
  className: string;
  classCode: string;
  dayGroup: 'M' | 'T';
  topName: string;
  middleName: string;
  startTime: string;
  endTime: string;
  room: string;
}

/** 강사 이름별 정규 반 2~3개. 같은 강사는 항상 같은 반을 받는다. */
function regularPlansOf(teacherName: string): MockClassPlan[] {
  const seed = hash(`teacher|${teacherName}`);
  const count = 2 + (seed % 2);
  const plans: MockClassPlan[] = [];
  for (let k = 0; plans.length < count && k < 12; k += 1) {
    const h = hash(`teacher|${teacherName}|${k}`);
    const grade = 3 + (h % 4);
    const dayGroup: 'M' | 'T' = (h >>> 4) % 2 ? 'T' : 'M';
    const className = `${grade}${dayGroup}${1 + ((h >>> 6) % 4)}${'ABC'[(h >>> 9) % 3]}`;
    if (plans.some((plan) => plan.className === className)) continue;
    const slot = plans.length;
    plans.push({
      className,
      classCode: classCodeOf(className),
      dayGroup,
      topName: '초등부',
      middleName: `초등${grade}`,
      startTime: `${15 + slot}:00`,
      endTime: `${16 + slot}:50`,
      room: `${1 + ((h >>> 12) % 6)}강의실`,
    });
  }
  return plans;
}

/** 강사 이름별 특강 반 0~1개. */
function specialPlansOf(teacherName: string): MockClassPlan[] {
  const h = hash(`special|${teacherName}`);
  if (h % 3 === 0) return [];
  const dayGroup: 'M' | 'T' = (h >>> 3) % 2 ? 'T' : 'M';
  const grade = 3 + ((h >>> 5) % 4);
  const className = `특강 ${grade}${dayGroup}${1 + ((h >>> 8) % 2)}`;
  return [{
    className,
    classCode: classCodeOf(className),
    dayGroup,
    topName: '특강',
    middleName: '초등',
    startTime: '13:00',
    endTime: '14:50',
    room: '특강실',
  }];
}

function toRegularClass(plan: MockClassPlan, month: string): TttRegularClass {
  const students = studentsOf(plan.className).map((student) => toSpecialStudent(student, plan.classCode, month));
  return {
    topCode: plan.topName === '특강' ? 'SP' : 'EL',
    middleCode: plan.middleName,
    classCode: plan.classCode,
    className: plan.className,
    topName: plan.topName,
    middleName: plan.middleName,
    scheduleCode: scheduleOf(plan.dayGroup),
    dayGroup: plan.dayGroup,
    startTime: plan.startTime,
    endTime: plan.endTime,
    room: plan.room,
    studentCount: students.length,
    students,
  };
}

function teacherSnapshot(
  teacherName: string,
  month: string,
  classes: TttRegularClass[],
): TttRegularTeacherClassSnapshot {
  return {
    targetMonth: month,
    sourceMonth: month,
    searchedMonths: [month],
    month,
    classes,
    excludedExtensions: [],
    unsupportedSchedules: [],
    listedClassCount: classes.length,
    listedEnrollmentCount: classes.reduce((sum, cls) => sum + cls.students.length, 0),
    teacherFilter: { teacherCode: `T${pad(hash(`staff|${teacherName}`) % 10000, 4)}`, teacherName },
    nonPrimaryCurrentClasses: [],
  };
}

interface StoredCounsel {
  accountId: string;
  classCode: string;
  scode: string;
  sname: string;
  className: string;
  subject: string;
  content: string;
  date: string;
}

export class MockTttGateway implements TttGateway {
  private readonly notebooks = new Map<string, Notebook>();
  private readonly counsels: StoredCounsel[] = [];
  private readonly classNameByCode = new Map<string, string>();

  /**
   * @param staffNames 특강 반을 만들 강사 이름 목록. 모의 ERP의 직원 명단을 앱 강사 명단과 맞추기 위해 받는다.
   */
  constructor(private readonly staffNames: () => string[] = () => []) {}

  async verifyAccount(account: TttCreds): Promise<{ memberName: string }> {
    const id = String(account?.id || '').trim();
    if (!id || !account?.pw) throw new Error('아이디와 비밀번호를 입력해 주세요.');
    return { memberName: `${id} (모의 계정)` };
  }

  async getNotebook(_account: TttCreds | null, className: string, date: string): Promise<Notebook> {
    const posted = this.notebooks.get(`${date}|${className}`);
    if (posted) return { ...posted };
    return { written: false, title: '', body: '', files: [], postedAt: null, source: null };
  }

  async postNotebook(_account: TttCreds | null, className: string, date: string, post: NotebookPost): Promise<Notebook> {
    const key = `${date}|${className}`;
    const previous = this.notebooks.get(key);
    const files = [
      ...post.files,
      ...(post.attach?.urls || []).map((url) => `URL · ${url}`),
      ...(post.attach?.images || []).map((image) => `이미지 · ${image.filename}`),
      ...(post.attach?.files || []).map((file) => `파일 · ${file.filename}`),
    ];
    const notebook: Notebook = {
      written: true,
      title: post.title,
      body: post.body,
      files,
      postedAt: nowHm(),
      source: '이 화면에서 작성 · 모의 ERP에 게시됨',
      cmtId: previous?.cmtId || `mock-${hash(key)}`,
    };
    this.notebooks.set(key, notebook);
    return { ...notebook };
  }

  async getAttendance(_account: TttCreds, className: string, date: string): Promise<AttRow[]> {
    return studentsOf(className).map((student, index) => {
      const h = hash(`att|${className}|${date}|${student.code}`);
      const absent = h % 17 === 0;
      const late = !absent && h % 7 === 0;
      return {
        id: index + 1,
        name: student.name,
        in: absent ? '—' : late ? '16:12' : `15:5${h % 10}`,
        out: absent ? '—' : '18:00',
        st: absent ? '결석' : late ? '지각' : '출석',
        tone: absent ? 'destructive' : late ? 'warning' : 'success',
        school: student.school,
        motherPhone: phoneOf(student.code),
      };
    });
  }

  async getCounsel(account: TttCreds, date: string, classes: string[]): Promise<Counsel[]> {
    const written = this.counsels
      .filter((row) => row.accountId === account.id && row.date === date)
      .map((row) => ({ student: row.sname, topic: row.subject, body: row.content, cls: row.className, date: row.date }));
    const sampleClass = classes[0] || '';
    const samples = sampleClass
      ? studentsOf(sampleClass).slice(0, COUNSEL_SAMPLES.length).map((student, index) => ({
        student: student.name,
        topic: COUNSEL_SAMPLES[index].topic,
        body: COUNSEL_SAMPLES[index].body,
        cls: sampleClass,
        date,
      }))
      : [];
    return [...written, ...samples];
  }

  async getScores(_account: TttCreds, className: string, scoreDate: string, _hwDate: string): Promise<ScoreRow[]> {
    const students = studentsOf(className);
    const totals = students.map((student) => {
      const h = hash(`score|${className}|${scoreDate}|${student.code}`);
      return h % 5 === 0 ? 100 : 60 + (h % 40);
    });
    const average = totals.reduce((sum, value) => sum + value, 0) / Math.max(totals.length, 1);
    return students.map((student, index) => ({
      student: student.name,
      total: String(totals[index]),
      avg: average.toFixed(1),
      rank: String(1 + totals.filter((value) => value > totals[index]).length),
      examinees: String(students.length),
      opinion: '',
      hwAhead: '',
      hwDeepen: '',
    }));
  }

  async getRoster(account: TttCreds, className: string, date: string): Promise<RosterRow[]> {
    const attendance = await this.getAttendance(account, className, date);
    return studentsOf(className).map((student, index) => {
      const last = [...this.counsels].reverse().find((row) => row.scode === student.code && row.className === className);
      return {
        scode: student.code,
        name: student.name,
        motherPhone: phoneOf(student.code),
        fatherPhone: '',
        status: attendance[index]?.st || '',
        hasCounsel: !!last,
        lastCounsel: last ? `${last.subject} — ${last.content}`.slice(0, 40) : '',
      };
    });
  }

  async getOwnedClassSnapshot(
    _account: TttCreds,
    targetDateOrMonth: string,
    teacherName: string,
    options: OwnedClassReadOptions = {},
  ): Promise<TttRegularTeacherClassSnapshot> {
    const month = monthOf(targetDateOrMonth);
    const plans = [
      ...regularPlansOf(teacherName),
      ...(options.includeSpecialClasses ? specialPlansOf(teacherName) : []),
    ];
    const selected = options.selectedClassCodes ? new Set(options.selectedClassCodes) : null;
    const classes = plans
      .filter((plan) => !selected || selected.has(plan.classCode))
      .map((plan) => toRegularClass(plan, month));
    return teacherSnapshot(teacherName, month, classes);
  }

  async getRegularClassSnapshot(
    _account: TttCreds,
    targetDateOrMonth: string,
    teacherName: string,
    _currentAssignments: TttRegularCurrentAssignment[] = [],
  ): Promise<TttRegularTeacherClassSnapshot> {
    const month = monthOf(targetDateOrMonth);
    return teacherSnapshot(teacherName, month, regularPlansOf(teacherName).map((plan) => toRegularClass(plan, month)));
  }

  async getSpecialClassSnapshot(targetDateOrMonth: string): Promise<TttSpecialSnapshot> {
    const month = monthOf(targetDateOrMonth);
    const classes: TttSpecialClass[] = [];
    for (const teacherName of this.staffNames()) {
      for (const plan of specialPlansOf(teacherName)) {
        const regular = toRegularClass(plan, month);
        classes.push({
          classCode: regular.classCode,
          className: regular.className,
          teacherName,
          scheduleCode: regular.scheduleCode,
          group: plan.dayGroup === 'M' ? '특강 월수금반' : '특강 화목토반',
          dayGroup: plan.dayGroup,
          startTime: regular.startTime,
          endTime: regular.endTime,
          room: regular.room,
          students: regular.students,
        });
      }
    }
    if (!classes.length) throw new TttSpecialError('NO_DATA', '모의 ERP에 특강 반이 없습니다.', [month]);
    const unique = new Set(classes.flatMap((cls) => cls.students.map((student) => student.studentCode)));
    return {
      targetMonth: month,
      sourceMonth: month,
      searchedMonths: [month],
      month,
      classes,
      unsupportedSchedules: [],
      listedClassCount: classes.length,
      listedEnrollmentCount: classes.reduce((sum, cls) => sum + cls.students.length, 0),
      uniqueSupportedStudentCount: unique.size,
    };
  }

  async getStudentContacts(_account: TttCreds | null, studentCodes: string[]): Promise<TttMotherPhoneBatchResult> {
    const phones: TttMotherPhoneBatchResult['phones'] = [];
    const failures: TttMotherPhoneBatchResult['failures'] = [];
    for (const raw of studentCodes) {
      const studentCode = String(raw || '').trim();
      if (!/^S\d{6}$/.test(studentCode)) failures.push({ studentCode, reason: 'invalid-student-code' });
      else phones.push({ studentCode, motherPhone: phoneOf(studentCode) });
    }
    return { phones, failures };
  }

  async getLastCounselDates(account: TttCreds, studentCodes: string[], today: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const code of studentCodes) {
      const h = hash(`last-counsel|${code}`);
      if (h % 6 !== 0) result[code] = addDays(today, -(h % 35));
    }
    for (const row of this.counsels) {
      if (row.accountId === account.id && studentCodes.includes(row.scode) && row.date <= today) {
        if (!result[row.scode] || result[row.scode] < row.date) result[row.scode] = row.date;
      }
    }
    return result;
  }

  async resolveClassCode(_account: TttCreds, className: string): Promise<string | null> {
    const name = String(className || '').trim();
    if (!name) return null;
    const code = classCodeOf(name);
    this.classNameByCode.set(code, name);
    return code;
  }

  async listCounselEvidence(
    _account: TttCreds,
    classCode: string,
    filter: { scode: string; date: string },
  ): Promise<CounselWriteEvidence[]> {
    return this.counsels
      .filter((row) => row.classCode === classCode && row.scode === filter.scode && row.date === filter.date)
      .map((row) => ({ scode: row.scode, student: row.sname, topic: row.subject, body: bodyPreview(row.content), date: row.date }));
  }

  async postCounsel(account: TttCreds, input: CounselPostInput): Promise<CounselPostResponse> {
    const className = this.classNameByCode.get(input.classCode) || '';
    this.counsels.push({
      accountId: account.id,
      classCode: input.classCode,
      scode: input.scode,
      sname: input.sname,
      className,
      subject: input.subject,
      content: input.content,
      date: input.date,
    });
    return { sessionExpired: false, notice: '' };
  }
}
