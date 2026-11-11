import { useEffect, type RefObject } from "react";

/**
 * Keeping a row of buttons at the foot of the screen (the quiz's Previous / Next
 * and the result's actions), above any bar the page already pins there, such as
 * the app's bottom bar.
 */

export interface Box {
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * How much of the screen's foot the page's own pinned bars cover: the tallest
 * box that sits on the bottom edge and spans (nearly) the full width. Narrow
 * floating buttons and full-screen layers do not count.
 */
export function footInset(boxes: Box[], viewportWidth: number, viewportHeight: number): number {
  let inset = 0;
  for (const b of boxes) {
    const onFoot = b.bottom >= viewportHeight - 1;
    const wide = b.width >= viewportWidth * 0.9;
    const bar = b.height > 0 && b.height < viewportHeight / 2;
    if (onFoot && wide && bar) inset = Math.max(inset, viewportHeight - b.top);
  }
  return Math.max(0, Math.round(inset));
}

/** The share of the screen the pinned row and the bars under it may take together. */
export const PIN_MAX_SHARE = 1 / 3;

/**
 * Pin only while the row and the bars under it leave most of the screen for the
 * question: with large text or a short screen the row stays in the page instead.
 */
export function shouldPin(rowHeight: number, inset: number, viewportHeight: number): boolean {
  return rowHeight > 0 && viewportHeight > 0 && rowHeight + inset <= viewportHeight * PIN_MAX_SHARE;
}

/** The fixed-position boxes on the bottom edge of the screen, outside `own`. */
function pinnedBoxesAtFoot(own: Element | null): Box[] {
  if (typeof document.elementsFromPoint !== "function") return [];
  const w = window.innerWidth;
  const h = window.innerHeight;
  const seen = new Set<Element>();
  const boxes: Box[] = [];
  for (const x of [w * 0.25, w * 0.5, w * 0.75]) {
    for (const hit of document.elementsFromPoint(x, h - 1)) {
      if (own?.contains(hit)) continue;
      let el: Element | null = hit;
      while (el && el !== document.body && getComputedStyle(el).position !== "fixed") el = el.parentElement;
      if (!el || el === document.body || seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      boxes.push({ top: r.top, bottom: r.bottom, width: r.width, height: r.height });
    }
  }
  return boxes;
}

/** Where `el` starts on the page (not the screen), never below 0. */
export function pageTop(rectTop: number, scrollY: number): number {
  return Math.max(0, Math.round(rectTop + scrollY));
}

/**
 * Sets data-foot="pin", --fun-quiz-foot (the height of the page's own bars) and
 * --fun-quiz-top (where the root starts on the page) on `root` while `row`
 * should stay at the foot of the screen. The stylesheet does the pinning, and on
 * a phone lets a short question fill the screen so the row sits at its foot;
 * without this the row simply stays where it is in the page.
 */
export function useFootPin(root: RefObject<HTMLElement | null>, row: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const host = root.current;
    const bar = row.current;
    if (!host || !bar) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inset = footInset(pinnedBoxesAtFoot(host), window.innerWidth, window.innerHeight);
        host.style.setProperty("--fun-quiz-foot", `${inset}px`);
        host.style.setProperty("--fun-quiz-top", `${pageTop(host.getBoundingClientRect().top, window.scrollY)}px`);
        if (shouldPin(bar.offsetHeight, inset, window.innerHeight)) host.setAttribute("data-foot", "pin");
        else host.removeAttribute("data-foot");
      });
    };
    measure();
    // The page's bars can arrive a moment after the quiz does.
    const late = window.setTimeout(measure, 600);
    window.addEventListener("resize", measure);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(bar);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(late);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [root, row]);
}
