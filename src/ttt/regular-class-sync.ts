import type { TttRegularClass } from './ttt.special';

export interface AccessibleTttClass {
  classCode: string;
  className: string;
}

export interface RegularSyncTeacherAccess {
  tid: string;
  name: string;
  currentClasses: Record<string, string[]>;
  accessibleClasses: AccessibleTttClass[];
}

export interface ResolvedRegularClassAssignment {
  classCode: string;
  className: string;
  teacherTid: string;
  teacherName: string;
  dayGroup: 'M' | 'T';
  scheduleLabel: string;
}

export interface RegularClassAssignmentPlan {
  assignments: ResolvedRegularClassAssignment[];
  /** 등록된 어떤 강사 계정에서도 반코드를 찾지 못한 반. */
  unclaimedClasses: string[];
  /** 여러 계정에 보이고 기존 담당자로도 한 명을 확정할 수 없는 반. */
  ambiguousClasses: string[];
  /** 여러 계정에 보였지만 기존 담당자가 후보 중 유일해서 안전하게 유지한 반. */
  retainedByCurrentOwner: string[];
  uniquelyClaimedClassCount: number;
  matchedTeacherCount: number;
  canApply: boolean;
}

const clean = (value: unknown) => String(value ?? '').trim();
const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

function currentRegularClassNames(teacher: RegularSyncTeacherAccess): Set<string> {
  return new Set([
    ...(teacher.currentClasses?.['월수금반'] || []),
    ...(teacher.currentClasses?.['화목토반'] || []),
  ].map(clean).filter(Boolean));
}

/**
 * 중앙 카탈로그의 반코드를 각 등록 강사 계정에서 보이는 반코드와 교차한다.
 * 중앙 목록의 Rs2는 일반반에서 복수 강사가 반복되어 담당자 판정에 사용하지 않는다.
 *
 * 애매한 반을 임의 배정하지 않는 것이 핵심이다. 여러 계정에 보이는 반은 현재 담당자가
 * 후보 중 정확히 한 명일 때만 그 담당자를 유지하고, 그렇지 않으면 전체 적용을 막는다.
 */
export function resolveRegularClassAssignments(
  catalog: TttRegularClass[],
  teachers: RegularSyncTeacherAccess[],
): RegularClassAssignmentPlan {
  const teacherAccess = teachers.map((teacher) => ({
    teacher,
    codes: new Set((teacher.accessibleClasses || []).map((entry) => clean(entry.classCode)).filter(Boolean)),
    current: currentRegularClassNames(teacher),
  }));
  const assignments: ResolvedRegularClassAssignment[] = [];
  const unclaimedClasses: string[] = [];
  const ambiguousClasses: string[] = [];
  const retainedByCurrentOwner: string[] = [];
  let uniquelyClaimedClassCount = 0;
  const seenCodes = new Set<string>();

  for (const cls of catalog || []) {
    const classCode = clean(cls.classCode);
    const className = clean(cls.className);
    if (!classCode || !className || seenCodes.has(classCode)) continue;
    seenCodes.add(classCode);
    const claimants = teacherAccess.filter((entry) => entry.codes.has(classCode));
    let owner: RegularSyncTeacherAccess | null = null;

    if (claimants.length === 1) {
      // 최초 도입 시 이미 수동 배정된 56개 반을 계정 picker 의미만으로 다른 강사에게
      // 이동시키지 않는다. 현재 소유자가 없거나 유일 claimant와 같을 때만 자동 확정한다.
      const currentOwners = teacherAccess.filter((entry) => entry.current.has(className));
      if (currentOwners.length === 0 || (currentOwners.length === 1 && currentOwners[0].teacher.tid === claimants[0].teacher.tid)) {
        owner = claimants[0].teacher;
        uniquelyClaimedClassCount += 1;
      } else {
        const currentNames = unique(currentOwners.map((entry) => clean(entry.teacher.name)));
        const claimantName = clean(claimants[0].teacher.name);
        ambiguousClasses.push(
          `${className} (현재 ${currentNames.join(' · ') || '미확인'} · 계정 ${claimantName || '미확인'})`,
        );
      }
    } else if (claimants.length > 1) {
      const allCurrentOwners = teacherAccess.filter((entry) => entry.current.has(className));
      const currentOwnerIsClaimant = allCurrentOwners.length === 1
        && claimants.some((entry) => entry.teacher.tid === allCurrentOwners[0].teacher.tid);
      if (currentOwnerIsClaimant) {
        owner = allCurrentOwners[0].teacher;
        retainedByCurrentOwner.push(className);
      } else {
        const names = unique(claimants.map((entry) => clean(entry.teacher.name)));
        ambiguousClasses.push(`${className}${names.length ? ` (${names.join(' · ')})` : ''}`);
      }
    } else {
      unclaimedClasses.push(className);
    }

    if (owner) {
      assignments.push({
        classCode,
        className,
        teacherTid: clean(owner.tid),
        teacherName: clean(owner.name),
        dayGroup: cls.dayGroup,
        scheduleLabel: clean(cls.scheduleCode),
      });
    }
  }

  return {
    assignments,
    unclaimedClasses: unique(unclaimedClasses),
    ambiguousClasses: unique(ambiguousClasses),
    retainedByCurrentOwner: unique(retainedByCurrentOwner),
    uniquelyClaimedClassCount,
    matchedTeacherCount: new Set(assignments.map((entry) => entry.teacherTid)).size,
    canApply: assignments.length > 0 && unclaimedClasses.length === 0 && ambiguousClasses.length === 0,
  };
}
