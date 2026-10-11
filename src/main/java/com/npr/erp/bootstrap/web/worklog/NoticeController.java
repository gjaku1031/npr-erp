package com.npr.erp.bootstrap.web.worklog;

import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.bootstrap.web.AcademyContext;
import com.npr.erp.bootstrap.web.Guard;
import com.npr.erp.worklog.NoticeBoard;
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
 * 공지 관리 화면
 */
@Controller
@RequestMapping("/a/{academyId}/notices")
@RequiredArgsConstructor
public class NoticeController {
    /**
     * 권한 확인
     */
    private final Guard guard;

    /**
     * 공지
     */
    private final NoticeBoard noticeBoard;

    /**
     * 공지 목록
     *
     * @param context 요청 문맥
     * @param model 화면 모델
     * @return 공지 관리 템플릿
     */
    @GetMapping
    public String list(AcademyContext context, Model model) {
        guard.require(context, PermissionCatalog.WORKLOG_NOTICE_MANAGE);
        model.addAttribute("notices", noticeBoard.notices(context.academyId()));
        return "worklog/notices";
    }

    /**
     * 공지 작성
     *
     * @param context 요청 문맥
     * @param body 본문
     * @return 공지 목록
     */
    @PostMapping
    public String create(AcademyContext context, @RequestParam String body) {
        guard.require(context, PermissionCatalog.WORKLOG_NOTICE_MANAGE);
        noticeBoard.create(context.academyId(), context.accountId(), body);
        return "redirect:" + context.path("/notices");
    }

    /**
     * 공지 한 건의 수정, 노출 변경, 순서 이동, 삭제
     *
     * @param context 요청 문맥
     * @param noticeId 공지 ID
     * @param action 수정(update), 숨기기(hide), 노출(show), 위로(up), 아래로(down), 삭제(delete)
     * @param body 수정할 본문
     * @return 공지 목록
     */
    @PostMapping("/{noticeId}")
    public String change(
            AcademyContext context,
            @PathVariable UUID noticeId,
            @RequestParam String action,
            @RequestParam(required = false) String body) {
        guard.require(context, PermissionCatalog.WORKLOG_NOTICE_MANAGE);
        var academyId = context.academyId();
        switch (action) {
            case "update" -> noticeBoard.update(academyId, noticeId, body);
            case "hide" -> noticeBoard.setActive(academyId, noticeId, false);
            case "show" -> noticeBoard.setActive(academyId, noticeId, true);
            case "up" -> noticeBoard.move(academyId, noticeId, true);
            case "down" -> noticeBoard.move(academyId, noticeId, false);
            case "delete" -> noticeBoard.delete(academyId, noticeId);
            default -> throw new IllegalArgumentException("알 수 없는 동작: " + action);
        }
        return "redirect:" + context.path("/notices");
    }
}
