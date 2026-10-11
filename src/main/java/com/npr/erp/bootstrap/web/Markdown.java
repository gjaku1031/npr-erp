package com.npr.erp.bootstrap.web;

import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import org.springframework.web.util.HtmlUtils;

/**
 * 공지와 업무 내용에 쓰는 작은 마크다운 변환기
 *
 * 입력 전체를 먼저 HTML 이스케이프한 뒤 굵게, 링크, 제목, 목록만 태그로 바꿈. 그래서 사용자가 넣은 태그는 글자로만
 * 보이고, 링크는 http와 https 주소만 걸림
 */
@Component("markdown")
public class Markdown {
    /**
     * 굵게: 별표 두 개로 감싼 부분
     */
    private static final Pattern BOLD = Pattern.compile("\\*\\*(.+?)\\*\\*");

    /**
     * 이름 붙은 링크
     */
    private static final Pattern LINK = Pattern.compile("\\[([^\\]]+)]\\((https?://[^\\s)]+)\\)");

    /**
     * 이름 없이 적은 주소. 이미 링크로 바뀐 주소는 건드리지 않음
     */
    private static final Pattern BARE_URL = Pattern.compile("(?<![\"=>])(https?://[^\\s<]+)");

    /**
     * 제목과 목록의 줄머리 기호
     */
    private static final Pattern BLOCK_MARKER = Pattern.compile("^\\s*(#{1,6}\\s+|[-*]\\s+|\\d+\\.\\s+)");

    /**
     * 한 줄로 이어 붙인 형태로 변환. 화면 위쪽 공지 띠에 씀
     *
     * @param source 마크다운
     * @return 줄머리 기호를 빼고 줄을 가운뎃점으로 이은 HTML
     */
    public String inline(String source) {
        var lines = new StringBuilder();
        for (var line : normalize(source).split("\n")) {
            var text = BLOCK_MARKER.matcher(line).replaceFirst("").strip();
            if (text.isEmpty()) {
                continue;
            }
            if (!lines.isEmpty()) {
                lines.append(" · ");
            }
            lines.append(spans(text));
        }
        return lines.toString();
    }

    /**
     * 문단, 제목, 목록을 살린 형태로 변환
     *
     * @param source 마크다운
     * @return HTML
     */
    public String block(String source) {
        var html = new StringBuilder();
        var listTag = "";
        for (var line : normalize(source).split("\n")) {
            var trimmed = line.strip();
            var nextList = "";
            if (trimmed.matches("[-*]\\s+.*")) {
                nextList = "ul";
            } else if (trimmed.matches("\\d+\\.\\s+.*")) {
                nextList = "ol";
            }

            // 목록이 끝나거나 종류가 바뀌면 닫고, 새로 시작하면 엶
            if (!listTag.equals(nextList)) {
                if (!listTag.isEmpty()) {
                    html.append("</").append(listTag).append('>');
                }
                if (!nextList.isEmpty()) {
                    html.append('<').append(nextList).append('>');
                }
                listTag = nextList;
            }
            if (trimmed.isEmpty()) {
                continue;
            }
            var text = spans(BLOCK_MARKER.matcher(trimmed).replaceFirst(""));
            if (!nextList.isEmpty()) {
                html.append("<li>").append(text).append("</li>");
            } else if (trimmed.startsWith("#")) {
                html.append("<h4>").append(text).append("</h4>");
            } else {
                html.append("<p>").append(text).append("</p>");
            }
        }
        if (!listTag.isEmpty()) {
            html.append("</").append(listTag).append('>');
        }
        return html.toString();
    }

    /**
     * 이스케이프하고 줄바꿈을 통일
     *
     * @param source 마크다운. null이면 빈 문자열
     * @return 이스케이프한 본문
     */
    private static String normalize(String source) {
        return HtmlUtils.htmlEscape(source == null ? "" : source).replace("\r\n", "\n").replace('\r', '\n');
    }

    /**
     * 한 줄 안의 굵게와 링크를 태그로 변환
     *
     * @param escaped 이스케이프한 한 줄
     * @return HTML
     */
    private static String spans(String escaped) {
        var linked = LINK.matcher(escaped)
                .replaceAll("<a href=\"$2\" target=\"_blank\" rel=\"noopener noreferrer\">$1</a>");
        linked = BARE_URL.matcher(linked)
                .replaceAll("<a href=\"$1\" target=\"_blank\" rel=\"noopener noreferrer\">$1</a>");
        return BOLD.matcher(linked).replaceAll("<strong>$1</strong>");
    }
}
