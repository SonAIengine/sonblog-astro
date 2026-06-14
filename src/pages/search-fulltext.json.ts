// 서버 검색(synaptic) 전용 전체 본문 인덱스.
// 프론트 BM25용 search-index.json은 4000자로 작게 유지하고, synaptic 서버는
// 이 파일(글당 전체 본문)을 읽어 청크 단위로 색인한다. 클라이언트는 받지 않음.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { getSortedPosts } from "@/utils/getSortedPosts";
import { getPostUrl } from "@/utils/getPostPaths";

// 마크다운 → 평문 (코드블록/링크/이미지/기호 제거). 단락 구분(\n\n)은 보존해
// 서버가 단락 경계로 청크를 나눌 수 있게 한다.
function toPlainText(md: string): string {
  return (md || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, " ")
    .replace(/^>\s?/gm, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_~`#|>]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

function categoryFromPath(filePath?: string): string {
  if (!filePath) return "";
  const after = filePath.split(/posts[\\/]/).pop() || "";
  const seg = after.split(/[\\/]/)[0] || "";
  return seg.endsWith(".md") || seg.endsWith(".mdx") ? "" : seg;
}

export const GET: APIRoute = async () => {
  const posts = getSortedPosts(await getCollection("posts"));

  const docs = posts.map(p => {
    const url = getPostUrl(p.id, p.filePath);
    const d = p.data.modDatetime ?? p.data.pubDatetime;
    return {
      url,
      title: p.data.title,
      description: p.data.description ?? "",
      tags: p.data.tags ?? [],
      category: categoryFromPath(p.filePath),
      date: d ? new Date(d).toISOString().slice(0, 10) : "",
      // 전체 본문 (극단 케이스만 상한)
      body: toPlainText((p as { body?: string }).body ?? "").slice(0, 30000),
    };
  });

  return new Response(JSON.stringify(docs), {
    headers: { "Content-Type": "application/json" },
  });
};
