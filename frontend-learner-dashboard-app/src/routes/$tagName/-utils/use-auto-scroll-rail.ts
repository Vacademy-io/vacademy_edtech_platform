import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type RefObject } from "react";

/** Fastest an authored rail may advance; quicker than this nobody can read a card. */
export const AUTO_SCROLL_MIN_MS = 1500;
export const AUTO_SCROLL_DEFAULT_MS = 3000;

export const resolveAutoScrollInterval = (raw: unknown): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.max(AUTO_SCROLL_MIN_MS, Math.round(n)) : AUTO_SCROLL_DEFAULT_MS;
};

/**
 * Attributes for the second copy of a looping rail's cards: marked so the hook
 * can find where the copy starts, and kept out of screen readers and keyboard
 * focus (the visitor already met these cards once). `inert` is a React 19
 * prop the installed React 18 types do not list yet, hence the cast.
 */
export const RAIL_CLONE_PROPS = {
  "data-rail-clone": "",
  "aria-hidden": true,
  inert: true,
} as unknown as HTMLAttributes<HTMLElement>;

/**
 * Do the rail's own cards (not the loop copy, not a "+N more" tail marked
 * data-rail-tail) overflow its visible width? Measured the same way whether
 * or not the copy is rendered, so showing the copy can never flip the answer
 * (a flip would re-render the rail in a loop at one exact width).
 */
const cardsOverflow = (el: HTMLElement): boolean => {
  const cards = Array.from(el.children).filter(
    (c) => !c.hasAttribute("data-rail-clone") && !c.hasAttribute("data-rail-tail"),
  ) as HTMLElement[];
  if (cards.length < 2) return false;
  const first = cards[0];
  const last = cards[cards.length - 1];
  const span = last.offsetLeft + last.offsetWidth - first.offsetLeft;
  const cs = window.getComputedStyle(el);
  const view = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  return span > view + 8;
};

/** Distance from the first card to the first cloned card = one full lap. */
const loopPeriod = (el: HTMLElement): number => {
  const first = el.firstElementChild as HTMLElement | null;
  const clone = el.querySelector<HTMLElement>(":scope > [data-rail-clone]");
  return first && clone && clone !== first ? clone.offsetLeft - first.offsetLeft : 0;
};

/** Move without animation: the two laps look identical, so the visitor sees nothing. */
const jumpTo = (el: HTMLElement, left: number) => el.scrollTo({ left, behavior: "instant" as ScrollBehavior });

/**
 * Advances a horizontal scroll rail (an `overflow-x-auto` flex row of cards)
 * by one card every `intervalMs`, and wraps back to the first card at the end.
 *
 * With `loop`, the rail never rewinds: the caller renders its cards twice
 * (the second copy with RAIL_CLONE_PROPS) while `looping` is true, and on
 * reaching the copy the rail is silently moved back one lap, so the row reads
 * as an endless 12 → 1 → 2 ring. `looping` is only true when the cards do not
 * all fit — duplicating a row that fits would show every card twice.
 *
 * It only moves the rail's own scroll position, so swipe, the arrows and
 * snap points keep working as before. It holds still while the visitor is
 * using the rail (hover, keyboard focus, a touch in the last few seconds),
 * while the rail is off screen or the tab is hidden, and under
 * prefers-reduced-motion — an advert that keeps moving under a reader's
 * finger is worse than none.
 */
export const useAutoScrollRail = (
  trackRef: RefObject<HTMLElement | null>,
  {
    enabled,
    intervalMs,
    itemCount = 0,
    loop = false,
  }: {
    enabled: boolean;
    intervalMs?: number;
    /** Re-attach when the cards change — the rail often mounts after its data loads. */
    itemCount?: number;
    /** Endless ring instead of rewinding (see above). */
    loop?: boolean;
  }
): { looping: boolean } => {
  const hovered = useRef(false);
  const focused = useRef(false);
  const touchedAt = useRef(0);
  const onScreen = useRef(true);
  const [looping, setLooping] = useState(false);
  const loopingRef = useRef(false);
  loopingRef.current = looping;

  const reducedMotion = () =>
    typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  // Loop only when the rail's own cards overflow it (see cardsOverflow).
  useEffect(() => {
    const el = trackRef.current;
    if (!enabled || !loop || !el || reducedMotion()) {
      setLooping(false);
      return;
    }
    const measure = () => setLooping(cardsOverflow(el));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [trackRef, enabled, loop, itemCount, looping]);

  useEffect(() => {
    const el = trackRef.current;
    if (!enabled || !el || typeof window === "undefined") return;
    if (reducedMotion()) return;

    // Listen on the rail's wrapper, not just the track: the prev/next arrows
    // sit beside the track, and a tick firing while the visitor clicks an
    // arrow fights the click (a wrap back to the start undid it).
    const root = el.parentElement ?? el;
    const enter = () => (hovered.current = true);
    const leave = () => (hovered.current = false);
    const focusIn = () => (focused.current = true);
    const focusOut = (e: FocusEvent) => {
      if (!root.contains(e.relatedTarget as Node | null)) focused.current = false;
    };
    const touch = () => (touchedAt.current = Date.now());
    root.addEventListener("mouseenter", enter);
    root.addEventListener("mouseleave", leave);
    root.addEventListener("focusin", focusIn);
    root.addEventListener("focusout", focusOut);
    root.addEventListener("pointerdown", touch, { passive: true });
    root.addEventListener("touchstart", touch, { passive: true });
    root.addEventListener("wheel", touch, { passive: true });

    const io =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(([entry]) => (onScreen.current = !!entry?.isIntersecting), { threshold: 0.25 })
        : null;
    io?.observe(el);

    // A swipe or arrow click can carry the rail into the copy too: once it
    // settles there, move it back one lap so it never reaches a hard end.
    let settle: number | undefined;
    const onScroll = () => {
      if (!loopingRef.current) return;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        const lap = loopPeriod(el);
        if (lap > 0 && el.scrollLeft >= lap - 2) jumpTo(el, el.scrollLeft - lap);
      }, 160);
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    const tick = () => {
      if (hovered.current || focused.current || !onScreen.current || document.hidden) return;
      if (Date.now() - touchedAt.current < 4000) return;
      if (el.scrollWidth - el.clientWidth < 8) return; // everything already fits
      const first = el.firstElementChild as HTMLElement | null;
      const second = first?.nextElementSibling as HTMLElement | null;
      // One card = the distance between two neighbouring cards (width + gap).
      const step = first && second ? second.offsetLeft - first.offsetLeft : el.clientWidth;
      const lap = loopingRef.current ? loopPeriod(el) : 0;
      if (lap > 0) {
        if (el.scrollLeft >= lap - 2) jumpTo(el, el.scrollLeft - lap);
        el.scrollBy({ left: step, behavior: "smooth" });
        return;
      }
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 8;
      if (atEnd) el.scrollTo({ left: 0, behavior: "smooth" });
      else el.scrollBy({ left: step, behavior: "smooth" });
    };
    const timer = window.setInterval(tick, resolveAutoScrollInterval(intervalMs));

    return () => {
      window.clearInterval(timer);
      window.clearTimeout(settle);
      el.removeEventListener("scroll", onScroll);
      io?.disconnect();
      root.removeEventListener("mouseenter", enter);
      root.removeEventListener("mouseleave", leave);
      root.removeEventListener("focusin", focusIn);
      root.removeEventListener("focusout", focusOut);
      root.removeEventListener("pointerdown", touch);
      root.removeEventListener("touchstart", touch);
      root.removeEventListener("wheel", touch);
    };
  }, [trackRef, enabled, intervalMs, itemCount]);

  return { looping };
};

/**
 * Prev/next arrows for a horizontal rail: whether each way has room to travel,
 * and a scroll of just under one view (a sliver of the previous card stays in
 * sight, which tells the visitor the row continues).
 */
export const useRailArrows = (trackRef: RefObject<HTMLElement | null>, { enabled, itemCount = 0 }: { enabled: boolean; itemCount?: number }) => {
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const sync = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 8);
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, [trackRef]);
  useEffect(() => {
    const el = trackRef.current;
    if (!enabled || !el) return;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      el.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [trackRef, enabled, itemCount, sync]);
  const scrollByPage = useCallback(
    (dir: number) => {
      const el = trackRef.current;
      if (el) el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: "smooth" });
    },
    [trackRef]
  );
  return { canPrev, canNext, scrollByPage };
};
