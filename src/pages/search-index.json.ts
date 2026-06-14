// 빌드 타임 검색 인덱스: 각 글의 제목·설명·태그·카테고리·날짜·본문(평문)을
// graph 노드와 매칭되는 URL과 함께 JSON으로 emit. 클라이언트(graphViz.js)가
// 이 인덱스로 Orama BM25 텍스트 검색 + (후속) 시멘틱/그래프 검색을 수행한다.
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { getSortedPosts } from "@/utils/getSortedPosts";
import { getPostUrl } from "@/utils/getPostPaths";

// 마크다운 → 평문 (코드블록/링크/이미지/기호 제거)
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
    .replace(/\s+/g, " ")
    .trim();
}

// 파일 경로에서 최상위 카테고리 추출 (posts/{category}/...)
function categoryFromPath(filePath?: string): string {
  if (!filePath) return "";
  const after = filePath.split(/posts[\\/]/).pop() || "";
  const seg = after.split(/[\\/]/)[0] || "";
  return seg.endsWith(".md") || seg.endsWith(".mdx") ? "" : seg;
}

export const GET: APIRoute = async () => {
  const posts = getSortedPosts(await getCollection("posts"));

  const docs = posts.map((p, i) => {
    const url = getPostUrl(p.id, p.filePath);
    const body = toPlainText((p as { body?: string }).body ?? "").slice(0, 4000);
    const d = p.data.modDatetime ?? p.data.pubDatetime;
    return {
      i, // 안정적 정수 id (벡터 인덱스와 1:1 대응)
      url,
      title: p.data.title,
      description: p.data.description ?? "",
      tags: p.data.tags ?? [],
      category: categoryFromPath(p.filePath),
      series: p.data.series ?? "",
      date: d ? new Date(d).toISOString().slice(0, 10) : "",
      body,
    };
  });

  return new Response(JSON.stringify(docs), {
    headers: { "Content-Type": "application/json" },
  });
};
