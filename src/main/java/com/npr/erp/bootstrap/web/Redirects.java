package com.npr.erp.bootstrap.web;

import jakarta.servlet.http.HttpServletRequest;
import java.net.URI;
import java.net.URISyntaxException;

/**
 * 처리한 뒤 돌아갈 화면 계산
 */
public final class Redirects {
    /**
     * 인스턴스를 만들지 않는 도우미
     */
    private Redirects() {
    }

    /**
     * 요청을 보낸 화면으로 돌아가는 리다이렉트
     *
     * 같은 서버의 경로일 때만 Referer를 따르고, 아니면 대체 경로로 보냄. 바깥 주소로 튕겨 내는 데 쓰이지 않게 함
     *
     * @param request 요청
     * @param fallback Referer를 쓸 수 없을 때 갈 경로
     * @return 리다이렉트 뷰 이름
     */
    public static String back(HttpServletRequest request, String fallback) {
        return "redirect:" + backPath(request, fallback);
    }

    /**
     * 요청을 보낸 화면의 경로
     *
     * @param request 요청
     * @param fallback Referer를 쓸 수 없을 때 갈 경로
     * @return 같은 서버 안의 경로
     */
    public static String backPath(HttpServletRequest request, String fallback) {
        var referer = request.getHeader("Referer");
        if (referer == null) {
            return fallback;
        }
        try {
            var uri = new URI(referer);
            var sameHost = uri.getHost() == null || uri.getHost().equalsIgnoreCase(request.getServerName());
            var path = uri.getRawPath();
            if (!sameHost || path == null || !path.startsWith("/") || path.startsWith("//")) {
                return fallback;
            }
            return uri.getRawQuery() == null ? path : path + "?" + uri.getRawQuery();
        } catch (URISyntaxException invalid) {
            return fallback;
        }
    }
}
