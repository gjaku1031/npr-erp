package com.npr.erp.bootstrap.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 요청마다 식별자를 붙임
 *
 * 로그와 권한 감사 기록이 같은 식별자를 갖게 해 한 요청의 흐름을 따라갈 수 있게 함
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {
    /**
     * 로그 문맥의 키
     */
    public static final String MDC_KEY = "requestId";

    /**
     * 응답 헤더 이름
     */
    private static final String HEADER = "X-Request-Id";

    /**
     * 요청 식별자를 로그 문맥과 응답 헤더에 넣고, 요청이 끝나면 지움
     */
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var requestId = UUID.randomUUID().toString();
        MDC.put(MDC_KEY, requestId);
        response.setHeader(HEADER, requestId);
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_KEY);
        }
    }
}
