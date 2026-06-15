import { internalLinkTargets } from "../data/internalLinks";

const SKIP_TAGS = new Set([
  "a",
  "button",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "kbd",
  "pre",
  "samp",
  "script",
  "style",
]);

type AutoLinkOptions = {
  maxLinks?: number;
  maxLinksPerTarget?: number;
};

type Candidate = {
  href: string;
  keyword: string;
  keywordLower: string;
  slug: string;
  title: string;
};

const DEFAULT_MAX_LINKS = 8;
const DEFAULT_MAX_LINKS_PER_TARGET = 2;

function isTokenChar(char: string | undefined): boolean {
  return !!char && /[\p{L}\p{N}_]/u.test(char);
}

function hasCjk(text: string): boolean {
  return /[\u3131-\u318e\uac00-\ud7a3]/u.test(text);
}

function isBoundaryMatch(text: string, index: number, length: number): boolean {
  const keyword = text.slice(index, index + length);
  if (hasCjk(keyword)) return true;
  return !isTokenChar(text[index - 1]) && !isTokenChar(text[index + length]);
}

function makeCandidates(): Candidate[] {
  return internalLinkTargets
    .flatMap(target =>
      target.keywords.map(keyword => ({
        href: target.href,
        keyword,
        keywordLower: keyword.toLowerCase(),
        slug: target.slug,
        title: target.title,
      }))
    )
    .sort((a, b) => b.keyword.length - a.keyword.length);
}

function findNextMatch(
  text: string,
  candidates: Candidate[],
  targetCounts: Map<string, number>,
  maxLinksPerTarget: number
) {
  const lower = text.toLowerCase();
  let best:
    | {
        candidate: Candidate;
        index: number;
      }
    | undefined;

  for (const candidate of candidates) {
    if ((targetCounts.get(candidate.href) ?? 0) >= maxLinksPerTarget) continue;

    let from = 0;
    while (from < lower.length) {
      const index = lower.indexOf(candidate.keywordLower, from);
      if (index === -1) break;
      if (isBoundaryMatch(text, index, candidate.keyword.length)) {
        if (
          !best ||
          index < best.index ||
          (index === best.index &&
            candidate.keyword.length > best.candidate.keyword.length)
        ) {
          best = { candidate, index };
        }
        break;
      }
      from = index + candidate.keyword.length;
    }
  }

  return best;
}

function linkNode(candidate: Candidate, text: string) {
  return {
    type: "element",
    tagName: "a",
    properties: {
      href: candidate.href,
      title: `${candidate.title} topic`,
      className: ["auto-internal-link"],
      "data-auto-link": candidate.slug,
    },
    children: [{ type: "text", value: text }],
  };
}

function replaceTextNode(
  node: any,
  candidates: Candidate[],
  targetCounts: Map<string, number>,
  state: { total: number },
  maxLinks: number,
  maxLinksPerTarget: number
) {
  let text = String(node.value ?? "");
  const children = [];

  while (text && state.total < maxLinks) {
    const match = findNextMatch(
      text,
      candidates,
      targetCounts,
      maxLinksPerTarget
    );
    if (!match) break;

    const { candidate, index } = match;
    const linkedText = text.slice(index, index + candidate.keyword.length);
    if (index > 0) children.push({ type: "text", value: text.slice(0, index) });
    children.push(linkNode(candidate, linkedText));
    targetCounts.set(
      candidate.href,
      (targetCounts.get(candidate.href) ?? 0) + 1
    );
    state.total += 1;
    text = text.slice(index + candidate.keyword.length);
  }

  if (text) children.push({ type: "text", value: text });
  return children.length > 1 ? children : null;
}

export function rehypeAutoInternalLinks(options: AutoLinkOptions = {}) {
  const candidates = makeCandidates();
  const maxLinks = options.maxLinks ?? DEFAULT_MAX_LINKS;
  const maxLinksPerTarget =
    options.maxLinksPerTarget ?? DEFAULT_MAX_LINKS_PER_TARGET;

  return (tree: any) => {
    const targetCounts = new Map<string, number>();
    const state = { total: 0 };

    function walk(node: any, skip = false) {
      if (!node || !Array.isArray(node.children) || state.total >= maxLinks) {
        return;
      }

      const shouldSkip =
        skip || (node.type === "element" && SKIP_TAGS.has(node.tagName));

      for (let index = 0; index < node.children.length; index += 1) {
        const child = node.children[index];
        if (
          !shouldSkip &&
          child?.type === "text" &&
          String(child.value ?? "").trim()
        ) {
          const replacement = replaceTextNode(
            child,
            candidates,
            targetCounts,
            state,
            maxLinks,
            maxLinksPerTarget
          );
          if (replacement) {
            node.children.splice(index, 1, ...replacement);
            index += replacement.length - 1;
          }
          continue;
        }

        walk(child, shouldSkip);
      }
    }

    walk(tree);
  };
}
