import dynamic from 'next/dynamic';
import Head from 'next/head';

// 전 클라이언트 SPA — SSR 비활성화(localStorage/브라우저 상태 사용)
const AppRoot = dynamic(() => import('@/components/AppRoot'), {
  ssr: false,
  loading: () => (
    <div className="splash">
      <img src="/brand/logo_main.png" alt="업무일지" />
      <div className="spinner" />
    </div>
  ),
});

export default function Home() {
  return (
    <>
      <Head>
        <title>업무일지</title>
      </Head>
      <AppRoot />
    </>
  );
}
