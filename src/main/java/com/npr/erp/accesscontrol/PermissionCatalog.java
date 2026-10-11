package com.npr.erp.accesscontrol;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 코드가 소유하는 기능 권한 목록
 *
 * 관리자는 이 권한들을 조합해 역할을 만들 수 있지만 새 키를 만들거나 뜻을 바꿀 수는 없음. 새 권한은 배포로 추가함.
 * 플랫폼 슈퍼유저 자격은 이 목록과 따로 관리함
 */
public final class PermissionCatalog {
    /**
     * 권한 관리 영역 이름
     */
    private static final String GROUP_ACCESS = "권한 관리";

    /**
     * 저장소 영역 이름
     */
    private static final String GROUP_STORAGE = "자료실";

    /**
     * 업무일지 영역 이름
     */
    private static final String GROUP_WORKLOG = "업무일지";

    /**
     * 학원 소속 조회
     */
    public static final PermissionDefinition ACCESS_MEMBERSHIP_READ =
            academy("access.membership.read", "학원 소속 직원 목록을 조회합니다.", GROUP_ACCESS);

    /**
     * 학원 소속 추가·종료
     */
    public static final PermissionDefinition ACCESS_MEMBERSHIP_MANAGE =
            academy("access.membership.manage", "활성 계정을 학원 직원으로 추가하거나 소속을 종료합니다.", GROUP_ACCESS);

    /**
     * 역할과 역할별 권한 조회
     */
    public static final PermissionDefinition ACCESS_ROLE_READ =
            academy("access.role.read", "역할과 역할에 연결된 권한을 조회합니다.", GROUP_ACCESS);

    /**
     * 역할 생성·이름 변경·비활성화와 권한 구성 변경
     */
    public static final PermissionDefinition ACCESS_ROLE_MANAGE = academy(
            "access.role.manage", "역할을 만들고 이름을 바꾸고 비활성화하며 권한 구성을 바꿉니다.", GROUP_ACCESS);

    /**
     * 역할 배정 조회
     */
    public static final PermissionDefinition ACCESS_ASSIGNMENT_READ =
            academy("access.assignment.read", "직원에게 배정된 역할을 조회합니다.", GROUP_ACCESS);

    /**
     * 역할 배정 변경
     */
    public static final PermissionDefinition ACCESS_ASSIGNMENT_MANAGE =
            academy("access.assignment.manage", "직원의 역할 배정을 바꿉니다.", GROUP_ACCESS);

    /**
     * 감사 기록 조회
     */
    public static final PermissionDefinition ACCESS_AUDIT_READ =
            academy("access.audit.read", "권한 판단과 정책 변경 기록을 조회합니다.", GROUP_ACCESS);

    /**
     * 폴더의 하위 목록 조회
     */
    public static final PermissionDefinition STORAGE_FOLDER_LIST = resource(
            "storage.folder.list", "접근할 수 있는 폴더의 하위 목록을 조회합니다.", ResourceAction.LIST);

    /**
     * 폴더 아래에 폴더 생성
     */
    public static final PermissionDefinition STORAGE_FOLDER_CREATE = resource(
            "storage.folder.create", "접근할 수 있는 폴더 아래에 폴더를 만듭니다.", ResourceAction.WRITE);

    /**
     * 파일 내려받기
     */
    public static final PermissionDefinition STORAGE_FILE_READ =
            resource("storage.file.read", "접근할 수 있는 폴더의 파일을 내려받습니다.", ResourceAction.READ);

    /**
     * 파일 올리기
     */
    public static final PermissionDefinition STORAGE_FILE_WRITE =
            resource("storage.file.write", "접근할 수 있는 폴더에 파일을 올립니다.", ResourceAction.WRITE);

    /**
     * 폴더 ACL 조회
     */
    public static final PermissionDefinition STORAGE_ACL_READ =
            resource("storage.acl.read", "폴더에 설정된 접근 허용 목록을 조회합니다.", ResourceAction.READ);

    /**
     * 폴더 ACL 부여·회수
     */
    public static final PermissionDefinition STORAGE_ACL_MANAGE = resource(
            "storage.acl.manage", "폴더의 접근 허용 목록을 부여하거나 회수합니다.", ResourceAction.MANAGE_ACL);

    /**
     * 이름 변경·이동·휴지통·복원
     */
    public static final PermissionDefinition STORAGE_NODE_MODIFY = resource(
            "storage.node.modify",
            "파일과 폴더의 이름을 바꾸고 옮기고 휴지통으로 보내거나 복원합니다.",
            ResourceAction.WRITE);

    /**
     * 휴지통 항목의 영구 삭제
     */
    public static final PermissionDefinition STORAGE_NODE_DELETE =
            resource("storage.node.delete", "휴지통의 파일과 폴더를 영구 삭제합니다.", ResourceAction.WRITE);

    /**
     * 업무 생성·수정·삭제와 전체 진행 조회
     */
    public static final PermissionDefinition WORKLOG_TASK_MANAGE =
            academy("worklog.task.manage", "업무를 만들고 고치고 지우며 전체 진행 상황을 봅니다.", GROUP_WORKLOG);

    /**
     * 배정받은 업무의 처리와 보고
     */
    public static final PermissionDefinition WORKLOG_TASK_PERFORM =
            academy("worklog.task.perform", "배정받은 업무를 처리하고 보고합니다.", GROUP_WORKLOG);

    /**
     * 날짜별 일일보고 정의와 설정 관리
     */
    public static final PermissionDefinition WORKLOG_JOURNAL_MANAGE =
            academy("worklog.journal.manage", "날짜별 일일보고 항목, 주간테스트 날짜, 특강기간을 관리합니다.", GROUP_WORKLOG);

    /**
     * 본인 일일보고 작성과 제출
     */
    public static final PermissionDefinition WORKLOG_REPORT_WRITE =
            academy("worklog.report.write", "본인의 일일보고를 작성하고 제출합니다.", GROUP_WORKLOG);

    /**
     * 전체 제출 현황 조회와 확인 처리
     */
    public static final PermissionDefinition WORKLOG_REPORT_REVIEW =
            academy("worklog.report.review", "전체 직원의 일일보고 제출 현황을 보고 확인 처리합니다.", GROUP_WORKLOG);

    /**
     * 공지 작성과 노출 관리
     */
    public static final PermissionDefinition WORKLOG_NOTICE_MANAGE =
            academy("worklog.notice.manage", "공지를 쓰고 노출 순서를 관리합니다.", GROUP_WORKLOG);

    /**
     * 팀 일정 관리
     */
    public static final PermissionDefinition WORKLOG_EVENT_MANAGE =
            academy("worklog.event.manage", "팀 일정을 만들고 고치고 지웁니다.", GROUP_WORKLOG);

    /**
     * 캘린더 조회와 개인일정 관리
     */
    public static final PermissionDefinition WORKLOG_CALENDAR_USE =
            academy("worklog.calendar.use", "캘린더를 보고 개인일정을 관리합니다.", GROUP_WORKLOG);

    /**
     * 직원의 담당 반 연결과 태그 관리
     */
    public static final PermissionDefinition WORKLOG_STAFF_MANAGE =
            academy("worklog.staff.manage", "직원의 담당 반 연결과 태그를 관리합니다.", GROUP_WORKLOG);

    /**
     * 상담 작성과 전송
     */
    public static final PermissionDefinition WORKLOG_COUNSEL_WRITE =
            academy("worklog.counsel.write", "상담을 작성하고 외부 시스템으로 보냅니다.", GROUP_WORKLOG);

    /**
     * 담당 반 알림장 조회와 게시
     */
    public static final PermissionDefinition WORKLOG_NOTEBOOK_WRITE =
            academy("worklog.notebook.write", "담당 반의 알림장을 조회하고 게시합니다.", GROUP_WORKLOG);

    /**
     * 본인 담당 반 가져오기와 개인 상담일정
     */
    public static final PermissionDefinition WORKLOG_SELFCLASS_MANAGE =
            academy("worklog.selfclass.manage", "본인 담당 반을 직접 가져오고 개인 상담일정을 만듭니다.", GROUP_WORKLOG);

    /**
     * 전체 권한 정의. 관리 화면에 이 순서로 보임
     */
    private static final List<PermissionDefinition> DEFINITIONS = List.of(
            ACCESS_MEMBERSHIP_READ,
            ACCESS_MEMBERSHIP_MANAGE,
            ACCESS_ROLE_READ,
            ACCESS_ROLE_MANAGE,
            ACCESS_ASSIGNMENT_READ,
            ACCESS_ASSIGNMENT_MANAGE,
            ACCESS_AUDIT_READ,
            STORAGE_FOLDER_LIST,
            STORAGE_FOLDER_CREATE,
            STORAGE_FILE_READ,
            STORAGE_FILE_WRITE,
            STORAGE_ACL_READ,
            STORAGE_ACL_MANAGE,
            STORAGE_NODE_MODIFY,
            STORAGE_NODE_DELETE,
            WORKLOG_TASK_MANAGE,
            WORKLOG_TASK_PERFORM,
            WORKLOG_JOURNAL_MANAGE,
            WORKLOG_REPORT_WRITE,
            WORKLOG_REPORT_REVIEW,
            WORKLOG_NOTICE_MANAGE,
            WORKLOG_EVENT_MANAGE,
            WORKLOG_CALENDAR_USE,
            WORKLOG_STAFF_MANAGE,
            WORKLOG_COUNSEL_WRITE,
            WORKLOG_NOTEBOOK_WRITE,
            WORKLOG_SELFCLASS_MANAGE);

    /**
     * 키로 찾기 위한 색인. 키가 중복되면 클래스 초기화가 실패함
     */
    private static final Map<PermissionKey, PermissionDefinition> BY_KEY =
            DEFINITIONS.stream().collect(Collectors.toUnmodifiableMap(PermissionDefinition::key, Function.identity()));

    /**
     * 인스턴스를 만들지 않는 상수 모음
     */
    private PermissionCatalog() {
    }

    /**
     * 전체 권한 정의 조회
     *
     * @return 정의 순서의 불변 목록
     */
    public static List<PermissionDefinition> definitions() {
        return DEFINITIONS;
    }

    /**
     * 키로 권한 정의 조회
     *
     * @param key 권한 키
     * @return 정의되지 않은 키이면 빈 값
     */
    public static Optional<PermissionDefinition> find(PermissionKey key) {
        return Optional.ofNullable(BY_KEY.get(key));
    }

    /**
     * 학원 범위 권한 정의 생성
     *
     * @param key 권한 키 원문
     * @param description 관리자에게 보여 줄 설명
     * @param group 영역 이름
     * @return 학원 범위 권한
     */
    private static PermissionDefinition academy(String key, String description, String group) {
        return new PermissionDefinition(
                new PermissionKey(key), description, group, PermissionTargetType.ACADEMY, null, null);
    }

    /**
     * 저장소 리소스 권한 정의 생성
     *
     * @param key 권한 키 원문
     * @param description 관리자에게 보여 줄 설명
     * @param action 함께 요구할 ACL 작업
     * @return 저장소 노드에 대한 리소스 권한
     */
    private static PermissionDefinition resource(String key, String description, ResourceAction action) {
        return new PermissionDefinition(
                new PermissionKey(key),
                description,
                GROUP_STORAGE,
                PermissionTargetType.RESOURCE,
                ResourceType.STORAGE_NODE,
                action);
    }
}
