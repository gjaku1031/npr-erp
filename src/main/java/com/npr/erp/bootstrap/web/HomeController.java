package com.npr.erp.bootstrap.web;

import com.npr.erp.accesscontrol.AcademyCapabilityReader;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.bootstrap.security.AccountPrincipal;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * 로그인 화면과 첫 화면
 */
@Controller
@RequiredArgsConstructor
public class HomeController {
    /**
     * 권한 요약 조회
     */
    private final AcademyCapabilityReader capabilityReader;

    /**
     * 로그인 화면
     *
     * @return 로그인 템플릿
     */
    @GetMapping("/login")
    public String login() {
        return "login";
    }

    /**
     * 로그인한 사람을 소속 학원의 홈으로 보냄
     *
     * @param principal 로그인한 계정
     * @return 첫 소속 학원의 홈. 소속이 없으면 안내 화면
     */
    @GetMapping("/")
    public String home(@AuthenticationPrincipal AccountPrincipal principal) {
        var academyIds = capabilityReader.accessibleAcademyIds(new AuthorizationSubject(principal.getAccountId()));
        return academyIds.isEmpty() ? "no-academy" : "redirect:/a/" + academyIds.getFirst();
    }
}
