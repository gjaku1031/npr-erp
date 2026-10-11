#!/usr/bin/env python3
"""NPR 중앙 Markdown 문서와 명시적인 진입점의 링크·제목을 검사한다."""
from pathlib import Path
from urllib.parse import unquote, urlsplit
import re
import sys
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
ENTRYPOINTS = ["README.md"]
LINK = re.compile(r"\[[^\]\n]*\]\(([^\s)]+)(?:\s+\"[^\"]*\")?\)")


def prose(text: str) -> str:
    """코드 예제의 가짜 링크와 제목을 제외한다."""
    return re.sub(r"^(`{3,}|~{3,}).*?^\1[^\n]*$", "", text, flags=re.M | re.S)


def anchors(text: str) -> set[str]:
    result = set(re.findall(r'<a\s+(?:id|name)=[\"\']([^\"\']+)', text))
    counts: dict[str, int] = {}
    for title in re.findall(r"^#{1,6}\s+(.+?)\s*#*\s*$", prose(text), re.M):
        title = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", title).lower()
        slug = "".join(c for c in title if c in "-_ " or unicodedata.category(c)[0] in "LN")
        slug = re.sub(r"\s", "-", slug)
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        result.add(f"{slug}-{count}" if count else slug)
    return result


def main() -> int:
    # 저장소에 두지 않는 외부 연동 계약 문서는 검사하지 않음
    excluded = DOCS / "integrations"
    files = sorted(p for p in DOCS.rglob("*.md") if excluded not in p.parents) + [ROOT / p for p in ENTRYPOINTS]
    errors: list[str] = []
    inbound: set[Path] = set()
    for source in files:
        if not source.is_file():
            errors.append(f"문서 없음: {source.relative_to(ROOT)}")
            continue
        text = prose(source.read_text())
        if source.is_relative_to(DOCS) and len(re.findall(r"^# .+", text, re.M)) != 1:
            errors.append(f"H1 제목은 하나여야 함: {source.relative_to(ROOT)}")
        for value in LINK.findall(text):
            parsed = urlsplit(value)
            if parsed.scheme or parsed.netloc:
                continue
            target = (source.parent / unquote(parsed.path)).resolve() if parsed.path else source
            if not target.is_relative_to(ROOT):
                errors.append(f"프로젝트 밖 링크: {source.relative_to(ROOT)} → {value}")
                continue
            if not target.exists():
                errors.append(f"끊어진 링크: {source.relative_to(ROOT)} → {value}")
            elif target.suffix == ".md":
                if source != target:
                    inbound.add(target)
                if parsed.fragment and unquote(parsed.fragment) not in anchors(target.read_text()):
                    errors.append(f"없는 제목 링크: {source.relative_to(ROOT)} → {value}")
    for path in files:
        if path.is_relative_to(DOCS) and path not in inbound:
            errors.append(f"다른 문서에서 찾을 수 없는 문서: {path.relative_to(ROOT)}")
    if errors:
        print("\n".join(errors))
        return 1
    print(f"문서 {len(files)}개: 제목·상대 링크·목차 연결 검사 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
