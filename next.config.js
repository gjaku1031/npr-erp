/** @type {import('next').NextConfig} */
// libsql = 네이티브 모듈 → webpack 번들 대신 런타임에 node_modules에서 require.
const NATIVE = ['libsql'];

const nextConfig = {
  reactStrictMode: false, // 낙관적 업데이트/외부 상태 이중 렌더 방지
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  // public/ 정적 자산 캐시(콘텐츠 해시가 없어 immutable 대신 SWR로 안전하게):
  //  · 배포로 파일이 바뀌면 max-age 만료 전까진 stale-while-revalidate로 백그라운드 갱신
  //  · _next/static(해시 파일)은 Next가 이미 immutable 처리하므로 건드리지 않음
  async headers() {
    const css = [{ key: 'Cache-Control', value: 'public, max-age=3600, stale-while-revalidate=604800' }];
    const img = [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }];
    return [
      { source: '/app.css', headers: css },
      { source: '/tokens/:path*', headers: css },
      { source: '/brand/:path*', headers: img },
      { source: '/favicon.png', headers: img },
      { source: '/apple-touch-icon.png', headers: img },
    ];
  },
  experimental: {
    // /api 서버리스 함수에 libsql 네이티브 바이너리 포함(externals라 명시 포함).
    outputFileTracingIncludes: {
      '/api/[[...slug]]': [
        './node_modules/libsql/**/*',
        './node_modules/@libsql/**/*',
        './node_modules/@neon-rs/**/*',
        './node_modules/detect-libc/**/*',
      ],
      // 주간테스트 생성 함수가 런타임에 읽는 승인된 1~7명 PPT 템플릿.
      '/api/utility/weekly-ppt': [
        './assets/templates/*.pptx',
        './node_modules/@kfonts/nanum-gothic/src/NanumGothic.ttf',
        './node_modules/@kfonts/nanum-gothic/src/NanumGothicBold.ttf',
        './node_modules/libsql/**/*',
        './node_modules/@libsql/**/*',
        './node_modules/@neon-rs/**/*',
        './node_modules/detect-libc/**/*',
      ],
    },
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externFn = ({ request }, cb) => (request && NATIVE.includes(request) ? cb(null, 'commonjs ' + request) : cb());
      const prev = config.externals || [];
      config.externals = [externFn, ...(Array.isArray(prev) ? prev : [prev])];
    }
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { message: /Critical dependency: the request of a dependency is an expression/ },
    ];
    return config;
  },
};
module.exports = nextConfig;
