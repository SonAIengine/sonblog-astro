import type mermaidDefault from "mermaid";

type Mermaid = typeof mermaidDefault;
type MermaidConfig = Parameters<Mermaid["initialize"]>[0];

declare global {
  interface Window {
    __sonBlogDiagramEnhancementsReady?: boolean;
    __sonBlogDiagramEnhancementsCleanup?: () => void;
  }
}

const FONT_STACK =
  'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';

let mermaidPromise: Promise<Mermaid> | null = null;
let activeTheme = getTheme();

function getTheme(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "dark"
    ? "dark"
    : "light";
}

function decodeBase64(value: string): string {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

function mermaidConfig(theme: "light" | "dark"): MermaidConfig {
  const dark = theme === "dark";

  return {
    startOnLoad: false,
    theme: "base",
    look: "neo",
    darkMode: dark,
    securityLevel: "loose",
    htmlLabels: true,
    fontFamily: FONT_STACK,
    altFontFamily: FONT_STACK,
    fontSize: 15,
    maxTextSize: 100000,
    maxEdges: 1200,
    markdownAutoWrap: true,
    themeVariables: {
      fontFamily: FONT_STACK,
      fontSize: "15px",
      background: dark ? "#08090a" : "#fcfcfd",
      mainBkg: dark ? "#111317" : "#ffffff",
      secondBkg: dark ? "#16181d" : "#f4f7f7",
      tertiaryColor: dark ? "#1f2937" : "#eef6f5",
      primaryColor: dark ? "#132f2d" : "#e7f6f4",
      primaryTextColor: dark ? "#f7f8f8" : "#08090a",
      primaryBorderColor: dark ? "#2dd4bf" : "#0f766e",
      secondaryColor: dark ? "#20242b" : "#f3f4f6",
      secondaryTextColor: dark ? "#e5e7eb" : "#111827",
      secondaryBorderColor: dark ? "#4b5563" : "#cfd6dc",
      lineColor: dark ? "#6ee7d8" : "#187f77",
      textColor: dark ? "#f7f8f8" : "#08090a",
      clusterBkg: dark ? "#101419" : "#f6fbfa",
      clusterBorder: dark ? "#2f3a43" : "#d6e4e2",
      edgeLabelBackground: dark ? "#101419" : "#ffffff",
      noteBkgColor: dark ? "#2a2315" : "#fff7d6",
      noteTextColor: dark ? "#f8e7b1" : "#382a05",
      noteBorderColor: dark ? "#836b1f" : "#d8b33d",
      actorBkg: dark ? "#12161c" : "#ffffff",
      actorBorder: dark ? "#2dd4bf" : "#0f766e",
      actorTextColor: dark ? "#f7f8f8" : "#08090a",
      actorLineColor: dark ? "#48515c" : "#d8dee4",
      signalColor: dark ? "#6ee7d8" : "#187f77",
      signalTextColor: dark ? "#f7f8f8" : "#111827",
      activationBkgColor: dark ? "#163b38" : "#d7f3ef",
      activationBorderColor: dark ? "#2dd4bf" : "#0f766e",
      labelBoxBkgColor: dark ? "#111317" : "#ffffff",
      labelBoxBorderColor: dark ? "#374151" : "#d8dee4",
      labelTextColor: dark ? "#f7f8f8" : "#111827",
    },
    themeCSS: `
      .node rect,
      .node polygon,
      .node path,
      .node circle,
      .node ellipse {
        stroke-width: 1.35px;
      }
      .edgePath .path {
        stroke-width: 1.65px;
      }
      .edgeLabel,
      .nodeLabel,
      .cluster-label {
        letter-spacing: 0;
      }
    `,
    flowchart: {
      curve: "basis",
      diagramPadding: 18,
      nodeSpacing: 52,
      rankSpacing: 64,
      padding: 18,
      wrappingWidth: 210,
    },
    sequence: {
      actorMargin: 72,
      boxMargin: 14,
      boxTextMargin: 8,
      diagramMarginX: 36,
      diagramMarginY: 24,
      messageMargin: 48,
      mirrorActors: false,
      rightAngles: false,
      showSequenceNumbers: false,
      wrap: true,
      width: 180,
    },
    gantt: {
      barHeight: 22,
      barGap: 5,
      fontSize: 13,
      gridLineStartPadding: 24,
      leftPadding: 80,
      numberSectionStyles: 4,
      topPadding: 48,
    },
    er: {
      diagramPadding: 18,
      entityPadding: 16,
      layoutDirection: "TB",
      minEntityHeight: 80,
      minEntityWidth: 120,
      stroke: dark ? "#6ee7d8" : "#187f77",
    },
  };
}

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(module => module.default);
  }
  return mermaidPromise;
}

function createFrame(encoded: string): HTMLElement {
  const frame = document.createElement("figure");
  frame.className = "diagram-frame diagram-frame--mermaid";
  frame.dataset.mermaidSrc = encoded;
  frame.dataset.diagramKind = "mermaid";
  frame.setAttribute("aria-label", "Mermaid diagram");
  return frame;
}

function createCanvas(code: string): HTMLElement {
  const canvas = document.createElement("div");
  canvas.className = "mermaid diagram-canvas";
  canvas.textContent = code;
  return canvas;
}

function enhanceRenderedSvg(frame: HTMLElement): void {
  const svg = frame.querySelector("svg");
  if (!(svg instanceof SVGSVGElement)) return;

  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Diagram");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.removeAttribute("height");

  const width =
    svg.viewBox.baseVal?.width ||
    Number.parseFloat(svg.getAttribute("width") ?? "0");

  if (Number.isFinite(width) && width > 0) {
    frame.dataset.diagramWidth = String(Math.round(width));
    svg.style.width = `${Math.round(width)}px`;
  }
}

function showRenderError(
  frame: HTMLElement,
  code: string,
  error: unknown
): void {
  const pre = document.createElement("pre");
  pre.className = "diagram-error";
  pre.tabIndex = 0;
  pre.textContent = code;

  const message = document.createElement("p");
  message.className = "diagram-error-message";
  message.textContent = "Diagram render failed. Source is shown below.";

  frame.replaceChildren(message, pre);
  console.error("mermaid failed:", error);
}

async function renderMermaid(target: HTMLElement): Promise<void> {
  const encoded =
    target.dataset.mermaidSrc ?? target.getAttribute("data-mermaid-src");
  if (!encoded) return;

  const frame = target.matches(".diagram-frame--mermaid")
    ? target
    : createFrame(encoded);

  const code = decodeBase64(encoded);
  const canvas = createCanvas(code);

  frame.setAttribute("aria-busy", "true");
  frame.replaceChildren(canvas);
  if (frame !== target) target.replaceWith(frame);

  try {
    const mermaid = await loadMermaid();
    mermaid.initialize(mermaidConfig(getTheme()));
    await mermaid.run({ nodes: [canvas] });
    enhanceRenderedSvg(frame);
  } catch (error) {
    showRenderError(frame, code, error);
  } finally {
    frame.removeAttribute("aria-busy");
  }
}

function setupMermaid(): void {
  const rendered = new WeakSet<HTMLElement>();
  let observer: IntersectionObserver | null = null;

  if ("IntersectionObserver" in window) {
    observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!(entry.target instanceof HTMLElement)) continue;
          if (!entry.isIntersecting) continue;
          observer?.unobserve(entry.target);
          rendered.add(entry.target);
          void renderMermaid(entry.target);
        }
      },
      { rootMargin: "700px 0px" }
    );
  }

  function scan(): void {
    document
      .querySelectorAll<HTMLElement>(
        "pre.mermaid[data-mermaid-src], .diagram-frame--mermaid[data-mermaid-src]"
      )
      .forEach(element => {
        if (rendered.has(element)) return;
        if (observer && element.matches("pre.mermaid[data-mermaid-src]")) {
          observer.observe(element);
          return;
        }
        rendered.add(element);
        void renderMermaid(element);
      });
  }

  const mutationObserver = new MutationObserver(() => {
    const nextTheme = getTheme();
    if (nextTheme === activeTheme) return;
    activeTheme = nextTheme;
    document
      .querySelectorAll<HTMLElement>(
        ".diagram-frame--mermaid[data-mermaid-src]"
      )
      .forEach(frame => {
        void renderMermaid(frame);
      });
  });

  mutationObserver.observe(document.documentElement, {
    attributeFilter: ["data-theme"],
  });

  document.addEventListener("astro:page-load", scan);
  scan();

  window.__sonBlogDiagramEnhancementsCleanup = () => {
    observer?.disconnect();
    mutationObserver.disconnect();
    document.removeEventListener("astro:page-load", scan);
  };
}

if (!window.__sonBlogDiagramEnhancementsReady) {
  window.__sonBlogDiagramEnhancementsReady = true;
  setupMermaid();
}
