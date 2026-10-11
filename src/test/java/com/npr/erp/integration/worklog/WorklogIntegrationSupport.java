package com.npr.erp.integration.worklog;

import com.npr.erp.identity.AccountAdministration;
import com.npr.erp.identity.CreateAccountCommand;
import com.npr.erp.worklog.TagCatalog;
import com.npr.erp.worklog.TagView;
import com.npr.erp.worklog.WorkCalendar;
import com.npr.erp.worklog.WorklogException;
import com.npr.erp.worklog.WorklogStaffDirectory;
import java.time.LocalDate;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 업무일지 통합 테스트의 공통 준비
 *
 * 테스트마다 새 학원에 팀장 한 명과 강사 두 명을 두고, 두 강사를 가상 직원 S01·S02에 연결해 담당 반을 가져옴
 */
abstract class WorklogIntegrationSupport {
    /**
     * 계정 생성
     */
    @Autowired
    protected AccountAdministration accountAdministration;

    /**
     * 직원 설정
     */
    @Autowired
    protected WorklogStaffDirectory staffDirectory;

    /**
     * 태그 관리
     */
    @Autowired
    protected TagCatalog tagCatalog;

    /**
     * 날짜 기준
     */
    @Autowired
    protected WorkCalendar calendar;

    /**
     * 테스트마다 새로 만드는 학원 ID
     */
    protected UUID academyId;

    /**
     * 팀장 계정 ID
     */
    protected UUID leadId;

    /**
     * 가상 직원 S01에 연결한 강사 계정 ID
     */
    protected UUID teacherA;

    /**
     * 가상 직원 S02에 연결한 강사 계정 ID
     */
    protected UUID teacherB;

    /**
     * 두 강사로 이루어진 배정 후보이자 보고 대상
     */
    protected Set<UUID> teachers;

    /**
     * 오늘
     */
    protected LocalDate today;

    /**
     * 새 학원, 계정, 기본 태그, 담당 반 준비
     */
    @BeforeEach
    void prepareAcademy() {
        academyId = UUID.randomUUID();
        leadId = createAccount("lead");
        teacherA = createAccount("teacher-a");
        teacherB = createAccount("teacher-b");
        teachers = Set.of(teacherA, teacherB);
        today = calendar.today();

        tagCatalog.ensureDefaults(academyId);
        staffDirectory.linkTngStaff(academyId, teacherA, "S01");
        staffDirectory.syncClassrooms(academyId, teacherA);
        staffDirectory.linkTngStaff(academyId, teacherB, "S02");
        staffDirectory.syncClassrooms(academyId, teacherB);
    }

    /**
     * 이름이 겹치지 않는 계정 생성
     *
     * @param prefix 사용자 이름 앞부분
     * @return 계정 ID
     */
    protected UUID createAccount(String prefix) {
        var username = "worklog-" + prefix + "-" + UUID.randomUUID();
        return accountAdministration
                .createAccount(new CreateAccountCommand(UUID.randomUUID(), username, username, "test-password", "통합 테스트"))
                .accountId();
    }

    /**
     * 이름으로 태그 조회
     *
     * @param name 태그 이름
     * @return 태그
     */
    protected TagView tag(String name) {
        return tagCatalog.tags(academyId).stream()
                .filter(tag -> tag.name().equals(name))
                .findFirst()
                .orElseThrow();
    }

    /**
     * 예외의 오류 코드를 확인하는 검증 함수
     *
     * @param code 기대하는 오류 코드
     * @return 예외 검증 함수
     */
    protected static Consumer<Throwable> code(String code) {
        return failure -> {
            if (!(failure instanceof WorklogException exception) || !exception.getCode().equals(code)) {
                throw new AssertionError("오류 코드 " + code + "를 기대했지만 " + failure, failure);
            }
        };
    }
}
