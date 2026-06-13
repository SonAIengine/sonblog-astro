import { visit } from "unist-util-visit";

/**
 * ```mermaid 코드 블록을 <pre class="mermaid" data-mermaid-src="..."> 로 변환한다.
 *
 * 다이어그램 코드를 base64로 인코딩해 data 속성에 담는다.
 * HTML escape(`-->` → `--&gt;`, `<br/>` → `&lt;br/&gt;`)가 mermaid.run 렌더
 * 시점에 깨지는 문제를 원천 차단하기 위함이다. 클라이언트(PostLayout)에서
 * base64를 디코드해 textContent로 넣은 뒤 mermaid.run으로 렌더한다.
 */
export function remarkMermaid() {
  return (tree: any) => {
    visit(tree, "code", (node: any, index: any, parent: any) => {
      if (node.lang === "mermaid" && parent && typeof index === "number") {
        const encoded = Buffer.from(String(node.value), "utf-8").toString(
          "base64"
        );
        parent.children[index] = {
          type: "html",
          value: `<pre class="mermaid" data-mermaid-src="${encoded}"></pre>`,
        };
      }
    });
  };
}
