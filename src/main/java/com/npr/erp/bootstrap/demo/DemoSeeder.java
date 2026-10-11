package com.npr.erp.bootstrap.demo;

import com.npr.erp.accesscontrol.AcademyAccessInitializer;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.accesscontrol.InitializeAcademyAccessCommand;
import com.npr.erp.accesscontrol.MembershipAdministration;
import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.accesscontrol.PermissionDefinition;
import com.npr.erp.accesscontrol.PermissionKey;
import com.npr.erp.accesscontrol.ResourceAclManagement;
import com.npr.erp.accesscontrol.ResourceAclSubject;
import com.npr.erp.accesscontrol.ResourceAction;
import com.npr.erp.accesscontrol.ResourceContext;
import com.npr.erp.accesscontrol.ResourceType;
import com.npr.erp.accesscontrol.RoleAdministration;
import com.npr.erp.accesscontrol.RoleAssignmentAdministration;
import com.npr.erp.accesscontrol.SuperuserManagement;
import com.npr.erp.identity.AccountAdministration;
import com.npr.erp.identity.AccountDirectory;
import com.npr.erp.identity.CreateAccountCommand;
import com.npr.erp.storage.StorageMutation;
import com.npr.erp.storage.StorageTransfer;
import com.npr.erp.tng.TngDayGroup;
import com.npr.erp.worklog.ChecklistAnswer;
import com.npr.erp.worklog.ClassroomDesk;
import com.npr.erp.worklog.CounselDesk;
import com.npr.erp.worklog.DailyReports;
import com.npr.erp.worklog.EventDraft;
import com.npr.erp.worklog.JournalDesk;
import com.npr.erp.worklog.NoticeBoard;
import com.npr.erp.worklog.ReportInput;
import com.npr.erp.worklog.TagCatalog;
import com.npr.erp.worklog.TaskBoard;
import com.npr.erp.worklog.TaskDraft;
import com.npr.erp.worklog.TaskKind;
import com.npr.erp.worklog.TaskLink;
import com.npr.erp.worklog.TeamCalendar;
import com.npr.erp.worklog.WorkCalendar;
import com.npr.erp.worklog.WorklogStaffDirectory;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * 시연 데이터
 *
 * 빈 DB에 가상의 학원 하나를 만듦: 슈퍼유저, 역할 세 개(팀장·강사·다른 팀), 계정 여섯 개, 자료실 폴더와 ACL, 업무와
 * 일일보고. 사람 이름과 반은 모두 지어낸 것임. 화면이 쓰는 것과 같은 공개 계약만 불러, 권한 모듈의 규칙을 그대로
 * 거침
 */
@Slf4j
@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "npr.demo.seed", havingValue = "true")
public class DemoSeeder implements ApplicationRunner {
    /**
     * 시연 학원의 고정 ID
     */
    private static final UUID ACADEMY_ID = UUID.nameUUIDFromBytes("npr-demo-academy".getBytes(StandardCharsets.UTF_8));

    /**
     * 슈퍼유저의 로그인 아이디. 이 계정이 있으면 이미 넣은 것으로 봄
     */
    private static final String ADMIN_USERNAME = "admin";

    /**
     * 변경 기록에 남길 사유
     */
    private static final String REASON = "시연 데이터";

    /**
     * 팀장 역할에서 빼는 권한
     *
     * 팀장은 업무를 내고 보고를 검토하는 쪽이므로, 업무를 받는 사람과 일일보고를 쓰는 사람의 집합에 들어가지 않게 함
     */
    private static final Set<PermissionDefinition> NOT_FOR_LEAD = Set.of(
            PermissionCatalog.WORKLOG_TASK_PERFORM,
            PermissionCatalog.WORKLOG_REPORT_WRITE,
            PermissionCatalog.WORKLOG_COUNSEL_WRITE,
            PermissionCatalog.WORKLOG_NOTEBOOK_WRITE,
            PermissionCatalog.WORKLOG_SELFCLASS_MANAGE);

    /**
     * 강사 역할의 권한
     */
    private static final List<PermissionDefinition> TEACHER_PERMISSIONS = List.of(
            PermissionCatalog.WORKLOG_TASK_PERFORM,
            PermissionCatalog.WORKLOG_REPORT_WRITE,
            PermissionCatalog.WORKLOG_CALENDAR_USE,
            PermissionCatalog.WORKLOG_COUNSEL_WRITE,
            PermissionCatalog.WORKLOG_NOTEBOOK_WRITE,
            PermissionCatalog.STORAGE_FOLDER_LIST,
            PermissionCatalog.STORAGE_FILE_READ,
            PermissionCatalog.STORAGE_FILE_WRITE);

    /**
     * 다른 팀 역할의 권한. 공용 업무와 일일보고에는 들어가지 않고 본인 반만 다룸
     */
    private static final List<PermissionDefinition> OTHER_TEAM_PERMISSIONS = List.of(
            PermissionCatalog.WORKLOG_CALENDAR_USE,
            PermissionCatalog.WORKLOG_COUNSEL_WRITE,
            PermissionCatalog.WORKLOG_NOTEBOOK_WRITE,
            PermissionCatalog.WORKLOG_SELFCLASS_MANAGE,
            PermissionCatalog.STORAGE_FOLDER_LIST,
            PermissionCatalog.STORAGE_FILE_READ);

    /**
     * 계정 조회
     */
    private final AccountDirectory accountDirectory;

    /**
     * 계정 생성
     */
    private final AccountAdministration accountAdministration;

    /**
     * 슈퍼유저 부여
     */
    private final SuperuserManagement superuserManagement;

    /**
     * 학원 권한 정책 초기화
     */
    private final AcademyAccessInitializer accessInitializer;

    /**
     * 소속 관리
     */
    private final MembershipAdministration membershipAdministration;

    /**
     * 역할 관리
     */
    private final RoleAdministration roleAdministration;

    /**
     * 역할 배정 관리
     */
    private final RoleAssignmentAdministration assignmentAdministration;

    /**
     * 폴더 ACL 관리
     */
    private final ResourceAclManagement aclManagement;

    /**
     * 자료실 트리 변경
     */
    private final StorageMutation storageMutation;

    /**
     * 파일 전송
     */
    private final StorageTransfer storageTransfer;

    /**
     * 직원 설정
     */
    private final WorklogStaffDirectory staffDirectory;

    /**
     * 태그
     */
    private final TagCatalog tagCatalog;

    /**
     * 업무 원장
     */
    private final TaskBoard taskBoard;

    /**
     * 상담 처리
     */
    private final CounselDesk counselDesk;

    /**
     * 일일보고 정의
     */
    private final JournalDesk journalDesk;

    /**
     * 일일보고
     */
    private final DailyReports dailyReports;

    /**
     * 담당 반 자료
     */
    private final ClassroomDesk classroomDesk;

    /**
     * 공지
     */
    private final NoticeBoard noticeBoard;

    /**
     * 일정
     */
    private final TeamCalendar teamCalendar;

    /**
     * 날짜 기준
     */
    private final WorkCalendar calendar;

    /**
     * 시연 계정이 함께 쓰는 비밀번호
     */
    @Value("${npr.demo.password}")
    private String password;

    /**
     * 정책을 바꿀 때마다 갱신하는 현재 정책 버전
     */
    private long policyVersion;

    /**
     * 시연 데이터를 한 번만 넣음
     */
    @Override
    public void run(ApplicationArguments args) {
        if (accountDirectory.findCredentialsByUsername(ADMIN_USERNAME).isPresent()) {
            return;
        }
        var admin = account(ADMIN_USERNAME, "시스템 관리자");
        superuserManagement.grant(admin, null, REASON);
        var lead = account("lead", "한빛 팀장");

        // 학원의 뿌리: 자료실 루트 폴더와 권한 정책, 첫 관리자 역할
        var root = storageMutation.initializeRoot(ACADEMY_ID, admin, "NPR 초등부").id();
        var leadPermissions = PermissionCatalog.definitions().stream()
                .filter(permission -> !NOT_FOR_LEAD.contains(permission))
                .map(PermissionDefinition::key)
                .collect(Collectors.toSet());
        policyVersion = accessInitializer
                .initialize(new InitializeAcademyAccessCommand(
                        new AuthorizationSubject(admin), ACADEMY_ID, root, lead, "팀장", leadPermissions, "demo-seed"))
                .policyVersion();

        var actor = new AuthorizationSubject(lead);
        var teacherRole = role(actor, "강사", TEACHER_PERMISSIONS);
        var otherRole = role(actor, "다른 팀", OTHER_TEAM_PERMISSIONS);

        // 강사 네 명과 다른 팀 한 명. 가상 직원 코드 S01~S05에 차례로 연결
        var staffCodes = new LinkedHashMap<UUID, String>();
        var teachers = new ArrayList<UUID>();
        for (var name : List.of("한결", "다온", "소담", "마루")) {
            var teacher = member(actor, "teacher" + (teachers.size() + 1), name + " 선생님", teacherRole);
            teachers.add(teacher);
            staffCodes.put(teacher, "S0" + teachers.size());
        }
        var other = member(actor, "other1", "보람 선생님", otherRole);
        staffCodes.put(other, "S05");

        seedStorage(actor, lead, root, teacherRole, otherRole);
        seedWorklog(lead, teachers, staffCodes);
        log.info("시연 데이터를 넣었습니다. 학원 ID: {}", ACADEMY_ID);
    }

    /**
     * 자료실 폴더, 예시 파일, 역할별 ACL
     *
     * 역할 권한과 폴더 ACL이 함께 맞아야 열리는 것을 보여 주는 구성임. 강사 역할은 올리기 권한이 있지만 쓰기 ACL은
     * 교재 폴더에만 있어 시험지 폴더에는 올릴 수 없고, 운영 문서 폴더는 목록에도 보이지 않음
     *
     * @param actor ACL을 주는 주체
     * @param lead 폴더를 만드는 계정 ID
     * @param root 루트 폴더 ID
     * @param teacherRole 강사 역할 ID
     * @param otherRole 다른 팀 역할 ID
     */
    private void seedStorage(AuthorizationSubject actor, UUID lead, UUID root, UUID teacherRole, UUID otherRole) {
        var textbooks = storageMutation.createFolder(ACADEMY_ID, lead, root, "교재").id();
        var grade4 = storageMutation.createFolder(ACADEMY_ID, lead, textbooks, "초4").id();
        storageMutation.createFolder(ACADEMY_ID, lead, textbooks, "초5");
        var exams = storageMutation.createFolder(ACADEMY_ID, lead, root, "시험지").id();
        var operations = storageMutation.createFolder(ACADEMY_ID, lead, root, "운영 문서").id();
        upload(lead, grade4, "1단원 학습지.txt", "분수의 덧셈과 뺄셈 학습지 (시연용 예시 파일)");
        upload(lead, exams, "10월 주간테스트.txt", "10월 2주차 주간테스트 문항 (시연용 예시 파일)");
        upload(lead, operations, "근무 규정.txt", "팀장만 보는 운영 문서 (시연용 예시 파일)");

        // 루트는 목록만, 하위로 내려가지 않게 줌. 폴더마다 필요한 만큼만 따로 엶
        for (var role : List.of(teacherRole, otherRole)) {
            grant(actor, root, List.of(), role, ResourceAction.LIST, false);
            grant(actor, textbooks, List.of(root), role, ResourceAction.LIST, true);
            grant(actor, textbooks, List.of(root), role, ResourceAction.READ, true);
        }
        grant(actor, textbooks, List.of(root), teacherRole, ResourceAction.WRITE, true);
        grant(actor, exams, List.of(root), teacherRole, ResourceAction.LIST, true);
        grant(actor, exams, List.of(root), teacherRole, ResourceAction.READ, true);
    }

    /**
     * 업무일지: 담당 반, 업무, 오늘의 일일보고, 공지, 일정과 약간의 진행 상황
     *
     * @param lead 팀장 계정 ID
     * @param teachers 강사 계정 ID
     * @param staffCodes 계정 ID별 가상 직원 코드
     */
    private void seedWorklog(UUID lead, List<UUID> teachers, Map<UUID, String> staffCodes) {
        var today = calendar.today();
        var assignable = Set.copyOf(teachers);
        tagCatalog.ensureDefaults(ACADEMY_ID);
        for (var entry : staffCodes.entrySet()) {
            staffDirectory.linkTngStaff(ACADEMY_ID, entry.getKey(), entry.getValue());
            staffDirectory.syncClassrooms(ACADEMY_ID, entry.getKey());
        }
        var tags = new HashMap<String, UUID>();
        for (var tag : tagCatalog.tags(ACADEMY_ID)) {
            tags.put(tag.name(), tag.id());
        }

        // 종류별 업무 하나씩
        var grading = taskBoard.create(
                ACADEMY_ID,
                lead,
                new TaskDraft(
                        "주간테스트 채점 결과 입력",
                        "반별 채점을 마치고 **평균과 특이 사항**을 보고란에 적어 주세요.\n- 70점 미만 학생은 보충 계획을 함께 적기",
                        tags.get("채점"),
                        today.minusDays(2),
                        today.plusDays(2),
                        TaskKind.GENERAL,
                        true,
                        Set.of(),
                        true,
                        false,
                        List.of(new TaskLink("채점 기준", "https://example.com/grading"))),
                assignable);
        var stock = taskBoard.create(
                ACADEMY_ID,
                lead,
                new TaskDraft(
                        "교재 재고 확인",
                        "교실별 남은 교재 수를 확인해 주세요.",
                        tags.get("교재"),
                        today,
                        today.plusDays(5),
                        TaskKind.GENERAL,
                        false,
                        Set.of(teachers.get(0), teachers.get(1)),
                        false,
                        false,
                        List.of()),
                assignable);
        var mt = taskBoard.create(
                ACADEMY_ID, lead, simpleTask("월말 MT 채점", tags.get("채점"), today.minusDays(1), today.plusDays(6), TaskKind.MT), assignable);
        var counsel = taskBoard.create(
                ACADEMY_ID,
                lead,
                simpleTask("10월 학부모 전체 상담", tags.get("상담"), today.minusDays(3), today.plusDays(10), TaskKind.COUNSEL),
                assignable);

        // 오늘의 일일보고와 설정
        journalDesk.updateSettings(ACADEMY_ID, today.minusDays(3), today.minusDays(2), false);
        journalDesk.create(ACADEMY_ID, lead, today);
        journalDesk.addItem(ACADEMY_ID, today, "교실 정리·환기 확인", true);
        journalDesk.addItem(ACADEMY_ID, today, "숙제 검사 결과 입력", false);
        var journal = journalDesk.addItem(ACADEMY_ID, today, "결석생 보강 일정 안내", true);

        // 첫 번째 강사: 업무를 처리하고 상담 몇 건을 보내고 일일보고까지 제출
        var first = teachers.get(0);
        taskBoard.saveReport(ACADEMY_ID, grading.id(), first, assignable, "초4 M1 평균 82점. 70점 미만 2명은 금요일 보충 예정.");
        taskBoard.markStatus(ACADEMY_ID, grading.id(), first, assignable, true);
        taskBoard.markStatus(ACADEMY_ID, stock.id(), first, assignable, false);
        taskBoard.toggleMt(ACADEMY_ID, mt.id(), first, assignable, TngDayGroup.MWF, true);
        var classroom = counselDesk.rosterClassrooms(ACADEMY_ID, counsel.id(), first).getFirst();
        var entries = counselDesk.syncRoster(ACADEMY_ID, counsel.id(), first, classroom.code());
        for (var entry : entries.subList(0, Math.min(3, entries.size()))) {
            counselDesk.send(ACADEMY_ID, entry.id(), first, today, "10월 학습 상담", "수업 태도가 좋고 숙제 이행이 꾸준함.");
        }
        var answers = new HashMap<UUID, ChecklistAnswer>();
        for (var item : journal.items()) {
            answers.put(item.id(), new ChecklistAnswer(true, "확인했습니다."));
        }
        dailyReports.saveDraft(ACADEMY_ID, first, today, new ReportInput(answers, true, true));
        for (var todayClass : classroomDesk.classroomsOn(ACADEMY_ID, first, today)) {
            classroomDesk.publishNotebook(
                    ACADEMY_ID, first, todayClass.code(), today, "오늘의 알림장", "교재 32~35쪽 풀어 오기. 주간테스트 오답 정리.");
        }
        dailyReports.submit(ACADEMY_ID, first, today, assignable);

        // 두 번째 강사: 작성 중인 일일보고
        dailyReports.saveDraft(ACADEMY_ID, teachers.get(1), today, new ReportInput(Map.of(), true, false));

        noticeBoard.create(ACADEMY_ID, lead, "**주간테스트** 채점 결과는 목요일까지 입력해 주세요.");
        noticeBoard.create(ACADEMY_ID, lead, "이번 주 토요일 학부모 설명회가 있습니다. 자료는 자료실 > 교재 폴더를 확인해 주세요.");
        var eventTag = tags.get("행사");
        teamCalendar.createTeamEvent(
                ACADEMY_ID, lead, new EventDraft("학부모 설명회", "2층 대강의실", today.plusDays(4), today.plusDays(4), eventTag));
        teamCalendar.createTeamEvent(
                ACADEMY_ID, lead, new EventDraft("중간고사 대비 보강", "", today.plusDays(8), today.plusDays(10), null));
        teamCalendar.createPersonalEvent(
                ACADEMY_ID, first, new EventDraft("교재 연구", "", today.plusDays(1), today.plusDays(1), null));
    }

    /**
     * 계정 생성
     *
     * @param username 로그인 아이디
     * @param displayName 표시 이름
     * @return 계정 ID
     */
    private UUID account(String username, String displayName) {
        return accountAdministration
                .createAccount(new CreateAccountCommand(UUID.randomUUID(), username, displayName, password, REASON))
                .accountId();
    }

    /**
     * 역할을 만들고 권한을 붙임
     *
     * @param actor 변경하는 주체
     * @param name 역할 이름
     * @param permissions 붙일 권한
     * @return 역할 ID
     */
    private UUID role(AuthorizationSubject actor, String name, List<PermissionDefinition> permissions) {
        var created = roleAdministration.createRole(actor, ACADEMY_ID, name, policyVersion);
        var keys = permissions.stream().map(PermissionDefinition::key).collect(Collectors.toSet());
        policyVersion = roleAdministration
                .replaceRolePermissions(actor, ACADEMY_ID, created.value().id(), keys, created.policyVersion())
                .policyVersion();
        return created.value().id();
    }

    /**
     * 계정을 만들어 학원에 소속시키고 역할을 줌
     *
     * @param actor 변경하는 주체
     * @param username 로그인 아이디
     * @param displayName 표시 이름
     * @param roleId 줄 역할 ID
     * @return 계정 ID
     */
    private UUID member(AuthorizationSubject actor, String username, String displayName, UUID roleId) {
        var accountId = account(username, displayName);
        var membership = membershipAdministration.createMembership(actor, ACADEMY_ID, accountId, policyVersion);
        policyVersion = assignmentAdministration
                .replaceMembershipRoles(
                        actor, ACADEMY_ID, membership.value().id(), Set.of(roleId), membership.policyVersion())
                .policyVersion();
        return accountId;
    }

    /**
     * 폴더 ACL 한 건 부여
     *
     * @param actor 부여하는 주체
     * @param folder 폴더 ID
     * @param ancestors 폴더의 조상 ID
     * @param roleId 허용할 역할 ID
     * @param action 허용할 작업
     * @param inherit 하위 항목에도 적용할지
     */
    private void grant(
            AuthorizationSubject actor,
            UUID folder,
            List<UUID> ancestors,
            UUID roleId,
            ResourceAction action,
            boolean inherit) {
        var resource = new ResourceContext(ACADEMY_ID, ResourceType.STORAGE_NODE, folder, ancestors);
        policyVersion = aclManagement
                .grant(actor, resource, new ResourceAclSubject.Role(roleId), action, inherit, policyVersion)
                .policyVersion();
    }

    /**
     * 예시 텍스트 파일 올리기
     *
     * @param actor 올리는 계정 ID
     * @param folder 올릴 폴더 ID
     * @param name 파일 이름
     * @param text 본문
     */
    private void upload(UUID actor, UUID folder, String name, String text) {
        storageTransfer.upload(
                ACADEMY_ID,
                actor,
                folder,
                name,
                "text/plain",
                new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));
    }

    /**
     * 전원에게 배정하는 완료 조건 없는 업무 입력
     *
     * @param title 업무 이름
     * @param tagId 태그 ID
     * @param start 시작일
     * @param due 마감일
     * @param kind 업무 종류
     * @return 업무 입력
     */
    private static TaskDraft simpleTask(String title, UUID tagId, LocalDate start, LocalDate due, TaskKind kind) {
        return new TaskDraft(title, "", tagId, start, due, kind, true, Set.of(), false, false, List.of());
    }
}
