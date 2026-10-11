package com.npr.erp.bootstrap.web;

import com.npr.erp.accesscontrol.PermissionCatalog;
import com.npr.erp.worklog.NoticeBoard;
import com.npr.erp.worklog.WorkCalendar;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ModelAttribute;

/**
 * 모든 화면이 함께 쓰는 모델 값
 */
@ControllerAdvice
@RequiredArgsConstructor
public class GlobalModel {
    /**
     * 공지
     */
    private final NoticeBoard noticeBoard;

    /**
     * 날짜 기준
     */
    private final WorkCalendar calendar;

    /**
     * 현재 경로, 오늘, 학원 문맥, 공지 띠를 모델에 넣음
     *
     * 공지 띠는 공지를 받아 보는 쪽에만 보임. 공지를 관리하는 사람의 화면에는 띠를 띄우지 않음
     *
     * @param request 요청
     * @param model 화면 모델
     */
    @ModelAttribute
    public void populate(HttpServletRequest request, Model model) {
        model.addAttribute("path", request.getRequestURI());
        model.addAttribute("today", calendar.today());
        if (!(request.getAttribute(AcademyContext.ATTRIBUTE) instanceof AcademyContext context)) {
            return;
        }
        model.addAttribute(AcademyContext.ATTRIBUTE, context);
        var receivesNotices = context.can(PermissionCatalog.WORKLOG_TASK_PERFORM)
                || context.can(PermissionCatalog.WORKLOG_REPORT_WRITE);
        if ("GET".equals(request.getMethod())
                && receivesNotices
                && !context.can(PermissionCatalog.WORKLOG_NOTICE_MANAGE)) {
            model.addAttribute("banner", noticeBoard.activeNotices(context.academyId()));
        }
    }
}
