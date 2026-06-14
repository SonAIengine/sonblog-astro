// 빌드 타임 시멘틱 임베딩 생성기.
// dist/search-index.json(엔드포인트 산출물)을 읽어 각 글을 다국어 임베딩하고,
// int8 양자화 벡터를 public/search-vectors.json 에 URL 키로 저장한다.
// 클라이언트는 같은 모델로 쿼리만 임베딩(WebGPU) 후 코사인 유사도로 검색.
//
// 문서 벡터는 장치 무관(한 번만 생성) → 여기선 CPU(선택적으로 CUDA 시도).
// 실행: pnpm build 후 → node scripts/embed-search.mjs
import fs from "node:fs";
import path from "node:path";
import { pipeline, env } from "@huggingface/transformers";

const MODEL = "Xenova/multilingual-e5-small";
const DTYPE = "q8"; // 클라이언트와 동일하게 맞춤 (~112MB)
const IN = path.resolve("dist/search-index.json");
const OUT = path.resolve("public/search-vectors.json");

if (!fs.existsSync(IN)) {
  console.error(`[embed] ${IN} 없음 — 먼저 'astro build'로 인덱스를 생성하세요.`);
  process.exit(1);
}
const docs = JSON.parse(fs.readFileSync(IN, "utf-8"));
env.allowLocalModels = false; // HF 허브에서 모델 로드(캐시)

async function makeExtractor() {
  // CUDA 런타임이 있으면 GPU, 없으면 CPU로 폴백
  for (const device of ["cuda", "cpu"]) {
    try {
      const ex = await pipeline("feature-extraction", MODEL, { dtype: DTYPE, device });
      console.log(`[embed] device=${device}`);
      return ex;
    } catch (e) {
      console.log(`[embed] device=${device} 불가 (${String(e).slice(0, 80)})`);
    }
  }
  throw new Error("extractor 생성 실패");
}

function quantize(float32) {
  const int8 = new Int8Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    int8[i] = Math.max(-127, Math.min(127, Math.round(float32[i] * 127)));
  }
  return Buffer.from(int8.buffer).toString("base64");
}

const extractor = await makeExtractor();

const vectors = {};
let dim = 0;
let done = 0;
for (const d of docs) {
  // e5 계열: 문서는 "passage: " 프리픽스
  const text =
    `passage: ${d.title}. ${(d.tags || []).join(", ")}. ${d.description} ${d.body}`.slice(
      0,
      1400
    );
  const out = await extractor(text, { pooling: "mean", normalize: true });
  const vec = out.data; // Float32Array, 정규화됨
  dim = vec.length;
  vectors[d.url] = quantize(vec);
  if (++done % 40 === 0) console.log(`[embed] ${done}/${docs.length}`);
}

fs.writeFileSync(
  OUT,
  JSON.stringify({ model: MODEL, dtype: DTYPE, dim, count: done, vectors })
);
const kb = Math.round(fs.statSync(OUT).size / 1024);
console.log(`[embed] 완료: ${done}개, dim=${dim}, ${OUT} (${kb}KB)`);
