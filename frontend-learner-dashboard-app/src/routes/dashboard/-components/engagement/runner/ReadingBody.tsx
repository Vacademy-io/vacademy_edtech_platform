import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDashed } from "@phosphor-icons/react";
import { HtmlSlideIframe } from "@/components/common/study-library/level-material/subject-material/module-material/chapter-material/slide-material/html-slide-iframe";
import type { EngagementItem } from "@/services/engagement";
import { ecn, skinClasses } from "../engagement-tone";

/**
 * A reading or visual note, rendered edge to edge in the app's own typography
 * (D15): 17 px / 1.65 in the app font, a 65-character measure, images that fit,
 * long words that wrap. The frame is sized to its content, so a short reading
 * no longer sits in a 480 px box, and a leading heading that repeats the task
 * title (already in the runner header) is dropped.
 *
 * The frame stays sandboxed (opaque origin); the host's font and colours reach
 * it as `--vac-*` variables plus the page's Google Fonts stylesheets.
 */

function normaliseText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

const WRAPPERS = new Set(["MAIN", "ARTICLE", "SECTION", "DIV", "HEADER", "HGROUP"]);

/** Visible text before the element's first child element ("Intro <h1>…"). */
function hasLeadingText(el: Element): boolean {
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 1) return false;
    if (node.nodeType === 3 && (node.textContent ?? "").trim()) return true;
  }
  return false;
}

/**
 * Drop the document's first element when it is a heading whose text equals the
 * title. Returns the input untouched when nothing is removed (or no DOM parser).
 */
export function stripLeadingTitleHeading(html: string, title?: string | null): string {
  if (!html || !title || typeof DOMParser === "undefined") return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (hasLeadingText(doc.body)) return html;
    let first: Element | null = doc.body.firstElementChild;
    // Look through wrappers (<main>, <article>, <div>…) that open with an element.
    while (first && WRAPPERS.has(first.tagName) && first.firstElementChild && !hasLeadingText(first)) {
      first = first.firstElementChild;
    }
    if (!first || !/^H[1-3]$/.test(first.tagName)) return html;
    if (normaliseText(first.textContent ?? "") !== normaliseText(title)) return html;
    first.remove();
    const doctype = /^\s*<!doctype/i.test(html) ? "<!DOCTYPE html>" : "";
    return `${doctype}${doc.documentElement.outerHTML}`;
  } catch {
    return html;
  }
}

/** Only the host's own Google Fonts stylesheets, quoted safely for @import. */
function hostFontImports(): string {
  if (typeof document === "undefined") return "";
  try {
    return Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
      .map((link) => link.href)
      .filter((href) => /^https:\/\/fonts\.googleapis\.com\/[^"'()\\\s]+$/.test(href))
      .map((href) => `@import url("${href}");`)
      .join("");
  } catch {
    return "";
  }
}

/**
 * The host's font and colours as `--vac-*` variables. Read from the live theme,
 * so a white-labelled font or an institute colour reaches the reading too.
 */
export function hostReadingVars(): Record<string, string> {
  if (typeof document === "undefined") return {};
  try {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string) => style.getPropertyValue(name).trim();
    const hsl = (name: string) => {
      const value = read(name);
      return value ? `hsl(${value})` : "";
    };
    const vars: Record<string, string> = {
      "--vac-font": read("--app-font-family"),
      "--vac-ink": hsl("--foreground"),
      "--vac-muted": hsl("--muted-foreground"),
      "--vac-primary": hsl("--primary-500"),
      "--vac-border": hsl("--border"),
    };
    return Object.fromEntries(Object.entries(vars).filter(([, v]) => Boolean(v)));
  } catch {
    return {};
  }
}

/** Base styles for a reading. The document's own CSS, placed after this, still wins. */
export function readingBaseCss({ measure }: { measure: boolean }): string {
  return [
    hostFontImports(),
    "html{-webkit-text-size-adjust:100%;text-size-adjust:100%;}",
    "html,body{background:transparent;}",
    "body{margin:0;padding:20px 20px 32px;font-family:var(--vac-font,system-ui,sans-serif);font-size:17px;line-height:1.65;color:var(--vac-ink,CanvasText);overflow-wrap:anywhere;}",
    measure ? "body>*{max-width:65ch;margin-inline:auto;}" : "",
    "h1,h2,h3,h4{line-height:1.3;font-weight:700;margin:1.4em 0 .5em;}",
    "h1{font-size:1.6em;margin-top:0;}h2{font-size:1.3em;}h3{font-size:1.12em;}h4{font-size:1em;}",
    "p,ul,ol,blockquote,pre,figure,table{margin-top:0;margin-bottom:1em;}",
    "ul,ol{padding-inline-start:1.4em;}li{margin-bottom:.35em;}",
    "img,video,svg,canvas,iframe{max-width:100%;height:auto;}",
    "a{color:var(--vac-primary,LinkText);}",
    "blockquote{margin-inline:0;padding-inline-start:1em;border-inline-start:3px solid var(--vac-border,currentColor);color:var(--vac-muted,inherit);}",
    "pre{white-space:pre-wrap;overflow-x:auto;}",
    "table{border-collapse:collapse;display:block;max-width:100%;overflow-x:auto;}",
    "th,td{border:1px solid var(--vac-border,currentColor);padding:.4em .6em;text-align:start;}",
    "hr{border:0;border-top:1px solid var(--vac-border,currentColor);margin:1.5em 0;}",
  ].join("");
}

export interface ReadingBodyProps {
  item: EngagementItem;
  /** The runner's scroll container: the end-of-content sentinel is observed against it. */
  scrollRoot: HTMLElement | null;
  /** The learner scrolled to the end of the content. */
  onReachedEnd: () => void;
}

export function ReadingBody({ item, scrollRoot, onReachedEnd }: ReadingBodyProps) {
  const { t, i18n } = useTranslation("dashboardEngagement");
  const html = useMemo(
    () => stripLeadingTitleHeading(item.contentHtml ?? "", item.title),
    [item.contentHtml, item.title]
  );
  const baseCss = useMemo(
    () => readingBaseCss({ measure: item.itemType === "READING_HTML" }),
    [item.itemType]
  );
  const vars = useMemo(() => hostReadingVars(), []);
  const [measured, setMeasured] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const reachedRef = useRef(onReachedEnd);
  reachedRef.current = onReachedEnd;

  /*
   * Armed only after the frame reports its height: before that it is still at
   * its initial size and the sentinel under it could be on screen for a moment,
   * which would tick "Reached the end" for a reading nobody scrolled.
   * threshold 0: a sentinel has almost no height, so any non-zero threshold can
   * compute a ratio of 0 while it is visible and never fire.
   */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!measured || !sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) reachedRef.current();
      },
      { root: scrollRoot, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [measured, scrollRoot]);

  // Safety net: a document whose script never reports a height still gets armed.
  useEffect(() => {
    if (measured) return;
    const timer = window.setTimeout(() => setMeasured(true), 3_000);
    return () => window.clearTimeout(timer);
  }, [measured]);

  if (!item.contentHtml) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <FileDashed aria-hidden className={ecn("size-8", skinClasses("mutedInk"))} />
        <p className={ecn("text-body", skinClasses("mutedInk"))}>{t("runner.reading.empty")}</p>
        <div ref={sentinelRef} aria-hidden className="h-px w-full" />
        {/* No frame to measure: the sentinel is armed right away. */}
        <ArmOnMount onArm={() => setMeasured(true)} />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <HtmlSlideIframe
        html={html}
        baseCss={baseCss}
        injectVars={vars}
        measure="content"
        minHeight={80}
        title={item.title}
        dir="auto"
        lang={i18n.language}
        className="block bg-transparent"
        onMeasured={() => setMeasured(true)}
      />
      <div ref={sentinelRef} aria-hidden className="h-px w-full" />
    </div>
  );
}

function ArmOnMount({ onArm }: { onArm: () => void }) {
  const armRef = useRef(onArm);
  armRef.current = onArm;
  useEffect(() => {
    armRef.current();
  }, []);
  return null;
}
