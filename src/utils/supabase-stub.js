// Cosmograph(@cosmograph/cosmograph)는 setData()마다 익명 사용 통계
// (브라우저 UA, hostname, 노드/엣지 수)를 자사 Supabase로 전송한다.
// 개인 블로그에서는 외부 전송을 원치 않고, supabase-js(수백 KB)를 번들에
// 포함시킬 이유도 없으므로 createClient를 no-op으로 대체한다.
// astro.config.ts의 vite.resolve.alias 에서 '@supabase/supabase-js' → 이 파일.
const noopClient = {
  from() {
    return {
      insert: async () => ({ error: null, data: null }),
    };
  },
};

export function createClient() {
  return noopClient;
}

export default { createClient };
