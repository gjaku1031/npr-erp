package com.npr.erp.bootstrap.web;

import com.npr.erp.accesscontrol.AcademyCapabilityReader;
import com.npr.erp.accesscontrol.AuthorizationSubject;
import com.npr.erp.bootstrap.security.AccountPrincipal;
import com.npr.erp.identity.AccountDirectory;
import com.npr.erp.storage.StorageCatalog;
import com.npr.erp.storage.StorageNodeView;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

/**
 * 학원 경로로 들어온 요청의 문맥을 만듦
 *
 * 소속이 없는 학원이면 권한 요약을 읽는 단계에서 거부됨. 그래서 학원 경로 아래의 컨트롤러는 항상 소속이 확인된
 * 문맥을 받음
 */
@Component
@RequiredArgsConstructor
public class AcademyContextInterceptor implements HandlerInterceptor {
    /**
     * 경로 변수 이름
     */
    private static final String PATH_VARIABLE = "academyId";

    /**
     * 학원 이름을 정하지 못했을 때의 표시
     */
    private static final String FALLBACK_NAME = "학원";

    /**
     * 권한 요약 조회
     */
    private final AcademyCapabilityReader capabilityReader;

    /**
     * 계정 조회
     */
    private final AccountDirectory accountDirectory;

    /**
     * 자료실 조회. 루트 폴더 이름을 학원 이름으로 씀
     */
    private final StorageCatalog storageCatalog;

    /**
     * 경로에 학원 ID가 있으면 문맥을 만들어 요청 속성에 넣음
     */
    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (!(request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE) instanceof Map<?, ?> variables)
                || !(variables.get(PATH_VARIABLE) instanceof String rawAcademyId)) {
            return true;
        }
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AccountPrincipal principal)) {
            return true;
        }

        var academyId = UUID.fromString(rawAcademyId);
        var account = accountDirectory.requireActive(principal.getAccountId());
        var capabilities = capabilityReader.capabilities(new AuthorizationSubject(account.accountId()), academyId);
        var academyName = storageCatalog.findRoot(academyId).map(StorageNodeView::name).orElse(FALLBACK_NAME);
        request.setAttribute(
                AcademyContext.ATTRIBUTE, new AcademyContext(academyId, academyName, account, capabilities));
        return true;
    }
}
