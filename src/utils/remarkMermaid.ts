import { visit } from "unist-util-visit";

/**
 * ```mermaid 코드 블록을 <pre class="mermaid">로 변환한다.
 * Shiki(코드 하이라이터)가 처리하기 전에 mdast 단계에서 바꿔
 * 클라이언트의 mermaid.js가 렌더하도록 한다.
 */
export function remarkMermaid() {
  return (tree: any) => {
    visit(tree, "code", (node: any, index: any, parent: any) => {
      if (node.lang === "mermaid" && parent && typeof index === "number") {
        const escaped = String(node.value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        parent.children[index] = {
          type: "html",
          value: `<pre class="mermaid">${escaped}</pre>`,
        };
      }
    });
  };
}
