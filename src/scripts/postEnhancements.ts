declare global {
  interface Window {
    __sonBlogPostEnhancementsReady?: boolean;
    __sonBlogPostEnhancementsCleanup?: () => void;
    __closeLightbox?: (() => void) | null;
  }
}

export {};

const scheduleIdle = (callback: () => void, timeout = 900): (() => void) => {
  if (window.requestIdleCallback) {
    const id = window.requestIdleCallback(callback, { timeout });
    return () => window.cancelIdleCallback?.(id);
  }

  const id = window.setTimeout(callback, 1);
  return () => window.clearTimeout(id);
};

function setupPostEnhancements(): void {
  window.__sonBlogPostEnhancementsCleanup?.();

  const article = document.querySelector<HTMLElement>("#article");
  const postMain = document.querySelector<HTMLElement>(".post-page-main");
  if (!article || !postMain) return;

  const controller = new AbortController();
  const { signal } = controller;
  const cleanupFns: Array<() => void> = [];

  function onCleanup(cleanup: () => void): void {
    cleanupFns.push(cleanup);
  }

  setupProgressBar(signal, onCleanup);

  const cancelIdleSetup = scheduleIdle(() => {
    if (signal.aborted) return;
    buildArticleToc(signal, onCleanup);
    addHeadingLinks(article);
    attachCopyButtons(article);
    initLightbox(article, signal);
  });
  onCleanup(cancelIdleSetup);

  window.__sonBlogPostEnhancementsCleanup = () => {
    controller.abort();
    window.__closeLightbox?.();
    window.__closeLightbox = null;
    for (const cleanup of cleanupFns.splice(0)) cleanup();
  };
}

function setupProgressBar(
  signal: AbortSignal,
  onCleanup: (cleanup: () => void) => void
): void {
  document.querySelectorAll(".progress-container").forEach(element => {
    element.remove();
  });

  const progressContainer = document.createElement("div");
  progressContainer.className =
    "progress-container fixed top-0 z-10 h-1 w-full bg-background";

  const progressBar = document.createElement("div");
  progressBar.className = "progress-bar h-1 w-0 bg-accent";
  progressBar.id = "myBar";

  progressContainer.appendChild(progressBar);
  document.body.appendChild(progressContainer);
  onCleanup(() => progressContainer.remove());

  let ticking = false;
  const update = () => {
    ticking = false;
    const winScroll =
      document.body.scrollTop || document.documentElement.scrollTop;
    const height =
      document.documentElement.scrollHeight -
      document.documentElement.clientHeight;
    progressBar.style.width =
      height > 0 ? `${Math.min(100, (winScroll / height) * 100)}%` : "0%";
  };

  const requestUpdate = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  };

  document.addEventListener("scroll", requestUpdate, {
    passive: true,
    signal,
  });
  window.addEventListener("resize", requestUpdate, {
    passive: true,
    signal,
  });
  requestUpdate();
}

function buildArticleToc(
  signal: AbortSignal,
  onCleanup: (cleanup: () => void) => void
): void {
  const targets = [
    {
      toc: document.getElementById("article-toc"),
      list: document.getElementById("article-toc-list"),
    },
    {
      toc: document.getElementById("article-mobile-toc"),
      list: document.getElementById("article-mobile-toc-list"),
    },
  ].filter(
    (target): target is { toc: HTMLElement; list: HTMLElement } =>
      target.toc instanceof HTMLElement && target.list instanceof HTMLElement
  );
  const headings = Array.from(
    document.querySelectorAll<HTMLElement>("#article h2[id], #article h3[id]")
  );

  if (targets.length === 0 || headings.length < 2) {
    for (const target of targets) target.toc.remove();
    return;
  }

  const linksById = new Map<string, HTMLAnchorElement[]>();

  for (const { toc, list } of targets) {
    const fragment = document.createDocumentFragment();

    for (const heading of headings) {
      const id = heading.id;
      const text = heading.textContent?.replace("#", "").trim();
      if (!id || !text) continue;

      const item = document.createElement("li");
      item.className =
        heading.tagName === "H3"
          ? "article-toc-item article-toc-item--nested"
          : "article-toc-item";

      const link = document.createElement("a");
      link.href = `#${id}`;
      link.textContent = text;

      const links = linksById.get(id) ?? [];
      links.push(link);
      linksById.set(id, links);

      item.appendChild(link);
      fragment.appendChild(item);
    }

    list.replaceChildren(fragment);
    toc.hidden = false;
  }

  if (linksById.size < 2) {
    for (const target of targets) target.toc.remove();
    return;
  }

  const mobileToc = document.getElementById("article-mobile-toc");
  mobileToc?.addEventListener(
    "click",
    event => {
      const target = event.target;
      if (target instanceof Element && target.closest("a")) {
        window.setTimeout(() => {
          if (mobileToc instanceof HTMLDetailsElement) mobileToc.open = false;
        }, 120);
      }
    },
    { signal }
  );

  const setActive = (id: string) => {
    for (const [linkId, links] of linksById.entries()) {
      for (const link of links) {
        link.classList.toggle("is-active", linkId === id);
      }
    }
  };

  setActive(headings[0].id);

  if (!("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    entries => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible?.target instanceof HTMLElement && visible.target.id) {
        setActive(visible.target.id);
      }
    },
    { rootMargin: "-18% 0px -72% 0px", threshold: [0, 1] }
  );

  for (const heading of headings) observer.observe(heading);
  signal.addEventListener("abort", () => observer.disconnect(), { once: true });
  onCleanup(() => observer.disconnect());
}

function addHeadingLinks(article: HTMLElement): void {
  const headings = Array.from(
    article.querySelectorAll<HTMLElement>(
      "h2[id], h3[id], h4[id], h5[id], h6[id]"
    )
  );

  for (const heading of headings) {
    if (heading.querySelector(".heading-link")) continue;
    heading.classList.add("group");

    const link = document.createElement("a");
    link.className =
      "heading-link ms-2 no-underline opacity-0 transition-opacity group-hover:opacity-70 focus-visible:opacity-100";
    link.href = `#${heading.id}`;
    link.setAttribute(
      "aria-label",
      `Link to ${heading.textContent?.replace("#", "").trim() || "section"}`
    );

    const span = document.createElement("span");
    span.ariaHidden = "true";
    span.innerText = "#";

    link.appendChild(span);
    heading.appendChild(link);
  }
}

function attachCopyButtons(article: HTMLElement): void {
  const copyButtonLabel = "Copy";
  const codeBlocks = Array.from(
    article.querySelectorAll<HTMLPreElement>("pre")
  );

  for (const codeBlock of codeBlocks) {
    if (
      codeBlock.classList.contains("mermaid") ||
      codeBlock.querySelector(".copy-code")
    ) {
      continue;
    }

    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";

    const copyButton = document.createElement("button");
    copyButton.className =
      "copy-code absolute end-3 rounded bg-muted border border-muted px-2 py-1 text-xs leading-4 text-foreground font-medium";
    copyButton.style.top = "var(--file-name-offset, -0.75rem)";
    copyButton.innerHTML = copyButtonLabel;

    codeBlock.setAttribute("tabindex", "0");
    codeBlock.appendChild(copyButton);

    codeBlock.parentNode?.insertBefore(wrapper, codeBlock);
    wrapper.appendChild(codeBlock);

    copyButton.addEventListener("click", async () => {
      const code = codeBlock.querySelector("code");
      await navigator.clipboard.writeText(code?.innerText ?? "");
      copyButton.innerText = "Copied";
      window.setTimeout(() => {
        copyButton.innerText = copyButtonLabel;
      }, 700);
    });
  }
}

function initLightbox(article: HTMLElement, signal: AbortSignal): void {
  const prefersReducedMotion = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let overlay: HTMLDivElement | null = null;
  let lastFocused: Element | null = null;

  window.requestAnimationFrame(() => {
    if (signal.aborted) return;
    const images = Array.from(
      article.querySelectorAll<HTMLImageElement>("img")
    );
    for (const image of images) {
      if (image.closest("a")) continue;
      image.setAttribute("role", "button");
      image.setAttribute("tabindex", "0");
      image.setAttribute("aria-haspopup", "dialog");
      image.setAttribute(
        "aria-label",
        image.alt ? `Zoom image: ${image.alt}` : "Zoom image"
      );
    }
  });

  function close(): void {
    if (!overlay) return;
    const el = overlay;
    overlay = null;
    window.__closeLightbox = null;

    document.removeEventListener("keydown", onKeyDown);
    document.body.style.overflow = "";
    if (lastFocused instanceof HTMLElement) lastFocused.focus();
    lastFocused = null;

    if (prefersReducedMotion()) {
      el.remove();
      return;
    }

    const remove = () => el.remove();
    el.addEventListener("transitionend", remove, { once: true });
    window.setTimeout(remove, 250);
    el.classList.remove("opacity-100");
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      close();
    } else if (e.key === "Tab") {
      trapFocus(e);
    }
  }

  function trapFocus(e: KeyboardEvent): void {
    if (!overlay) return;
    const focusables = overlay.querySelectorAll<HTMLElement>(
      'a[href], button, [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function open(src: string, alt: string, trigger: HTMLImageElement): void {
    if (overlay) return;
    lastFocused = trigger ?? document.activeElement;

    overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute(
      "aria-label",
      alt ? `Image preview: ${alt}` : "Image preview"
    );
    overlay.className =
      "fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/70 backdrop-blur-sm opacity-0 transition-opacity duration-200 motion-reduce:transition-none";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close image preview");
    closeButton.className =
      "absolute end-4 top-4 rounded p-2 text-3xl leading-none text-white";
    closeButton.innerHTML = "&#10005;";
    closeButton.addEventListener("click", close);

    const image = document.createElement("img");
    image.src = src;
    image.alt = "";
    image.className =
      "max-h-[90dvh] max-w-[90dvw] cursor-default object-contain";

    overlay.append(closeButton, image);
    overlay.addEventListener("click", e => {
      if (e.target === overlay && currentScale <= 1) close();
    });

    let currentScale = 1;
    let translateX = 0;
    let translateY = 0;
    let initialDist = 0;
    let initialScale = 1;
    let panStartX = 0;
    let panStartY = 0;
    let panStartTranslateX = 0;
    let panStartTranslateY = 0;
    let lastTapTime = 0;

    function applyTransform(): void {
      image.style.transform = `scale(${currentScale}) translate(${translateX}px, ${translateY}px)`;
    }

    function resetTransform(): void {
      currentScale = 1;
      translateX = 0;
      translateY = 0;
      image.style.transform = "";
    }

    overlay.addEventListener(
      "touchstart",
      e => {
        const touches = e.touches;
        if (touches.length === 2) {
          initialDist = Math.hypot(
            touches[1].clientX - touches[0].clientX,
            touches[1].clientY - touches[0].clientY
          );
          initialScale = currentScale;
        } else if (touches.length === 1) {
          const now = Date.now();
          if (now - lastTapTime < 300) {
            e.preventDefault();
            if (currentScale > 1) {
              resetTransform();
            } else {
              currentScale = 2;
              translateX = 0;
              translateY = 0;
              applyTransform();
            }
            lastTapTime = 0;
          } else {
            lastTapTime = now;
          }

          panStartX = touches[0].clientX;
          panStartY = touches[0].clientY;
          panStartTranslateX = translateX;
          panStartTranslateY = translateY;
        }
      },
      { passive: false }
    );

    overlay.addEventListener(
      "touchmove",
      e => {
        const touches = e.touches;
        if (touches.length === 2) {
          e.preventDefault();
          const dist = Math.hypot(
            touches[1].clientX - touches[0].clientX,
            touches[1].clientY - touches[0].clientY
          );
          currentScale = Math.min(
            4,
            Math.max(1, initialScale * (dist / initialDist))
          );
          applyTransform();
        } else if (touches.length === 1) {
          if (currentScale > 1) {
            e.preventDefault();
            translateX =
              panStartTranslateX +
              (touches[0].clientX - panStartX) / currentScale;
            translateY =
              panStartTranslateY +
              (touches[0].clientY - panStartY) / currentScale;
            const maxX = Math.max(
              0,
              (image.clientWidth - overlay!.clientWidth / currentScale) / 2
            );
            const maxY = Math.max(
              0,
              (image.clientHeight - overlay!.clientHeight / currentScale) / 2
            );
            translateX = Math.min(maxX, Math.max(-maxX, translateX));
            translateY = Math.min(maxY, Math.max(-maxY, translateY));
            applyTransform();
          } else {
            e.preventDefault();
          }
        }
      },
      { passive: false }
    );

    overlay.addEventListener("touchend", e => {
      if (e.touches.length === 0 && currentScale <= 1.05) resetTransform();
    });

    overlay.addEventListener("touchcancel", e => {
      if (e.touches.length === 0 && currentScale <= 1.05) resetTransform();
    });

    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    window.__closeLightbox = close;

    window.requestAnimationFrame(() => overlay?.classList.add("opacity-100"));
    closeButton.focus();
  }

  function triggerFromEvent(e: Event): HTMLImageElement | null {
    const target = e.target;
    if (!(target instanceof Element)) return null;
    const image = target.closest<HTMLImageElement>("img");
    if (!image || !article.contains(image) || image.closest("a")) return null;
    return image;
  }

  article.addEventListener(
    "click",
    e => {
      const image = triggerFromEvent(e);
      if (!image) return;
      e.preventDefault();
      open(image.currentSrc || image.src, image.alt, image);
    },
    { signal }
  );

  article.addEventListener(
    "keydown",
    e => {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      const image = triggerFromEvent(e);
      if (!image) return;
      e.preventDefault();
      open(image.currentSrc || image.src, image.alt, image);
    },
    { signal }
  );
}

if (!window.__sonBlogPostEnhancementsReady) {
  window.__sonBlogPostEnhancementsReady = true;
  document.addEventListener("astro:before-swap", () => {
    window.__sonBlogPostEnhancementsCleanup?.();
  });
  document.addEventListener("astro:page-load", setupPostEnhancements);
}

setupPostEnhancements();
