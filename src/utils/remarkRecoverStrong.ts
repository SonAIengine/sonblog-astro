import { visit } from "unist-util-visit";

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
  [key: string]: unknown;
};

type Position = {
  index: number;
  offset: number;
};

const DELIMITER = "**";

function findDelimiter(
  children: MdastNode[],
  fromIndex: number,
  fromOffset: number
): Position | null {
  for (let index = fromIndex; index < children.length; index += 1) {
    const child = children[index];
    if (child.type !== "text" || typeof child.value !== "string") continue;

    const offset = child.value.indexOf(
      DELIMITER,
      index === fromIndex ? fromOffset : 0
    );
    if (offset >= 0) return { index, offset };
  }

  return null;
}

function appendRange(
  source: MdastNode[],
  target: MdastNode[],
  start: Position,
  end: Position
): void {
  for (let index = start.index; index <= end.index; index += 1) {
    const child = source[index];

    if (child.type === "text" && typeof child.value === "string") {
      const startOffset = index === start.index ? start.offset : 0;
      const endOffset = index === end.index ? end.offset : child.value.length;
      const value = child.value.slice(startOffset, endOffset);
      if (value) target.push({ ...child, value });
      continue;
    }

    if (index !== start.index && index !== end.index) {
      target.push(child);
    }
  }
}

function appendTail(
  source: MdastNode[],
  target: MdastNode[],
  start: Position
): void {
  for (let index = start.index; index < source.length; index += 1) {
    const child = source[index];

    if (child.type === "text" && typeof child.value === "string") {
      const value = child.value.slice(index === start.index ? start.offset : 0);
      if (value) target.push({ ...child, value });
      continue;
    }

    target.push(child);
  }
}

function recoverStrongChildren(children: MdastNode[]): MdastNode[] {
  const next: MdastNode[] = [];
  let cursor: Position = { index: 0, offset: 0 };

  while (cursor.index < children.length) {
    const open = findDelimiter(children, cursor.index, cursor.offset);
    if (!open) {
      appendTail(children, next, cursor);
      break;
    }

    const contentStart = {
      index: open.index,
      offset: open.offset + DELIMITER.length,
    };
    const close = findDelimiter(
      children,
      contentStart.index,
      contentStart.offset
    );

    if (!close) {
      appendTail(children, next, cursor);
      break;
    }

    appendRange(children, next, cursor, open);

    const strongChildren: MdastNode[] = [];
    appendRange(children, strongChildren, contentStart, close);
    if (strongChildren.length > 0) {
      next.push({ type: "strong", children: strongChildren });
    }

    cursor = {
      index: close.index,
      offset: close.offset + DELIMITER.length,
    };
  }

  return next;
}

/**
 * CommonMark는 `**"quoted"**`, `**문장(괄호)**이다`처럼 delimiter 주변이
 * 문장부호/한글로 붙는 일부 문맥을 strong으로 인식하지 않는다. 파서가 놓쳐
 * 텍스트로 남긴 `**...**`만 후처리해 본문에 별표가 노출되지 않게 한다.
 */
export function remarkRecoverStrong() {
  return (tree: any) => {
    visit(tree, node => {
      if (!Array.isArray(node.children) || node.children.length === 0) return;
      if (node.type === "code" || node.type === "inlineCode") return;
      node.children = recoverStrongChildren(node.children);
    });
  };
}
