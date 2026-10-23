import { Html, Head, Main, NextScript } from 'next/document';

// 배포별 캐시버스팅 — 커밋 SHA(git 연동 배포) 없으면 빌드 시각으로 폴백(CLI 배포도 매 빌드 갱신).
// 모듈 스코프라 정적 프리렌더 빌드 시 1회 평가 → 배포별 고정값.
const V = process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8) : String(Date.now());

export default function Document() {
  return (
    <Html lang="ko">
      <Head>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        {/* 웹폰트: @import 체인(fonts.css→googleapis→폰트) 대신 preconnect + 직접 link로 FCP 개선 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&family=Poppins:wght@600;700&display=swap" />
        {/* 디자인 토큰 + 컴포넌트 CSS — 기존 파일 그대로 링크(디자인 100% 보존). ?v=SHA로 배포별 캐시버스팅 */}
        <link rel="stylesheet" href={`/tokens/colors.css?v=${V}`} />
        <link rel="stylesheet" href={`/tokens/typography.css?v=${V}`} />
        <link rel="stylesheet" href={`/tokens/spacing.css?v=${V}`} />
        <link rel="stylesheet" href={`/tokens/radius.css?v=${V}`} />
        <link rel="stylesheet" href={`/tokens/elevation.css?v=${V}`} />
        <link rel="stylesheet" href={`/tokens/base.css?v=${V}`} />
        <link rel="stylesheet" href={`/app.css?v=${V}`} />
        {/* 저장된 다크모드 설정을 React 렌더 전에 적용 (깜빡임 방지) */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{if(localStorage.getItem('npr_dark')==='1')document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
      </Head>
      <body>
        <Main />
        <NextScript />
        <div id="modal-root" />
        <div id="toast" className="toast" />
      </body>
    </Html>
  );
}
