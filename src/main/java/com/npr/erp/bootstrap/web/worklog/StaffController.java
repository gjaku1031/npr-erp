package com.npr.erp.bootstrap.web.worklog;

import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.bootstrap.web.AcademyContext;
import com.npr.erp.bootstrap.web.Guard;
import com.npr.erp.tng.TngGateway;
import com.npr.erp.worklog.DailyReports;
import com.npr.erp.worklog.ReportBoardEntry;
import com.npr.erp.worklog.ReportState;
import com.npr.erp.worklog.TagCatalog;
import com.npr.erp.worklog.WorkCalendar;
import com.npr.erp.worklog.WorklogNotFoundException;
import com.npr.erp.worklog.WorklogStaffDirectory;
import java.util.HashMap;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * 직원의 담당 반 연결과 태그 관리 화면
 *
 * 계정을 만들고 역할을 주는 일은 권한 관리 화면에서 함. 여기서는 업무일지가 쓰는 설정만 다룸
 */
@Controller
@RequestMapping("/a/{academyId}/staff")
@RequiredArgsConstructor
public class StaffController {
    /**
     * 권한 확인
     */
    private final Guard guard;

    /**
     * 직원 설정
     */
    private final WorklogStaffDirectory staffDirectory;

    /**
     * 태그
     */
    private final TagCatalog tagCatalog;

    /**
     * 일일보고
     */
    private final DailyReports dailyReports;

    /**
     * 외부 시스템 포트
     */
    private final TngGateway tngGateway;

    /**
     * 날짜 기준
     */
    private final WorkCalendar calendar;

    /**
     * 직원 목록과 태그
     *
     * @param context 요청 문맥
     * @param model 화면 모델
     * @return 직원 현황 템플릿
     */
    @GetMapping
    public String overview(AcademyContext context, Model model) {
        guard.require(context, PermissionCatalog.WORKLOG_STAFF_MANAGE);

        var reporters = guard.holders(context, PermissionCatalog.WORKLOG_REPORT_WRITE);
        var people = classroomUsers(context);

        var states = new HashMap<UUID, ReportState>();
        for (ReportBoardEntry entry : dailyReports.board(context.academyId(), calendar.today(), reporters)) {
            states.put(entry.accountId(), entry.state());
        }
        model.addAttribute("staff", staffDirectory.staffOf(context.academyId(), people).values());
        model.addAttribute("reportStates", states);
        model.addAttribute("tngStaff", tngGateway.staff());
        model.addAttribute("tags", tagCatalog.tags(context.academyId()));
        return "worklog/staff";
    }

    /**
     * 외부 시스템 직원 코드 연결 또는 담당 반 다시 가져오기
     *
     * @param context 요청 문맥
     * @param accountId 대상 계정 ID
     * @param action 연결(link) 또는 가져오기(sync)
     * @param staffCode 연결할 직원 코드
     * @return 직원 현황 화면
     */
    @PostMapping("/{accountId}")
    public String change(
            AcademyContext context,
            @PathVariable UUID accountId,
            @RequestParam String action,
            @RequestParam(required = false) String staffCode) {
        guard.require(context, PermissionCatalog.WORKLOG_STAFF_MANAGE);
        if (!classroomUsers(context).contains(accountId)) {
            throw new WorklogNotFoundException("STAFF_NOT_FOUND", "담당 반을 쓰는 직원이 아닙니다.");
        }
        if ("link".equals(action)) {
            var linked = staffDirectory.linkTngStaff(context.academyId(), accountId, staffCode);
            if (linked.tngStaffCode() != null) {
                staffDirectory.syncClassrooms(context.academyId(), accountId);
            }
        } else {
            staffDirectory.syncClassrooms(context.academyId(), accountId);
        }
        return "redirect:" + context.path("/staff");
    }

    /**
     * 담당 반을 쓰는 사람: 업무를 받거나, 보고를 쓰거나, 본인 반을 직접 관리하는 사람
     *
     * @param context 요청 문맥
     * @return 계정 ID 순으로 정렬한 집합
     */
    private Set<UUID> classroomUsers(AcademyContext context) {
        var people = new TreeSet<UUID>(guard.holders(context, PermissionCatalog.WORKLOG_REPORT_WRITE));
        people.addAll(guard.holders(context, PermissionCatalog.WORKLOG_TASK_PERFORM));
        people.addAll(guard.holders(context, PermissionCatalog.WORKLOG_SELFCLASS_MANAGE));
        return people;
    }

    /**
     * 태그 생성
     *
     * @param context 요청 문맥
     * @param name 이름
     * @param color 색
     * @param emoji 이모지
     * @return 직원 현황 화면의 태그 부분
     */
    @PostMapping("/tags")
    public String createTag(
            AcademyContext context, @RequestParam String name, @RequestParam String color, @RequestParam String emoji) {
        guard.require(context, PermissionCatalog.WORKLOG_STAFF_MANAGE);
        tagCatalog.create(context.academyId(), name, color, emoji);
        return "redirect:" + context.path("/staff") + "#tags";
    }

    /**
     * 태그 수정 또는 삭제
     *
     * @param context 요청 문맥
     * @param tagId 태그 ID
     * @param action 수정(update) 또는 삭제(delete)
     * @param name 이름
     * @param color 색
     * @param emoji 이모지
     * @return 직원 현황 화면의 태그 부분
     */
    @PostMapping("/tags/{tagId}")
    public String changeTag(
            AcademyContext context,
            @PathVariable UUID tagId,
            @RequestParam String action,
            @RequestParam(required = false) String name,
            @RequestParam(required = false) String color,
            @RequestParam(required = false) String emoji) {
        guard.require(context, PermissionCatalog.WORKLOG_STAFF_MANAGE);
        if ("delete".equals(action)) {
            tagCatalog.delete(context.academyId(), tagId);
        } else {
            tagCatalog.update(context.academyId(), tagId, name, color, emoji);
        }
        return "redirect:" + context.path("/staff") + "#tags";
    }
}
