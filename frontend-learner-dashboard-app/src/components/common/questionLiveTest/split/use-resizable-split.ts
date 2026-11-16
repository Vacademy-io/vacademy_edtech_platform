import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  DEFAULT_BOUNDS,
  boundsForWidth,
  clampSplit,
  parseStoredSplit,
  splitForKey,
  splitFromPointer,
  type SplitBounds,
} from "./split-math";

const isRtl = () => typeof document !== "undefined" && document.documentElement.dir === "rtl";

const readStoredSplit = (storageKey: string, fallback: number): number => {
  try {
    return parseStoredSplit(window.localStorage.getItem(storageKey), fallback);
  } catch {
    return fallback;
  }
};

const storeSplit = (storageKey: string, value: number) => {
  try {
    window.localStorage.setItem(storageKey, String(Math.round(value)));
  } catch {
    /* private mode / blocked storage: the split just isn't remembered */
  }
};

export interface ResizableSplit {
  /** Attach to the flex row holding both panes and the divider. */
  splitRef: React.RefObject<HTMLDivElement>;
  /** Start-pane width, in % of the row (already clamped to what fits). */
  split: number;
  bounds: SplitBounds;
  defaultPct: number;
  updateSplit: (value: number) => void;
  onDividerPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDividerPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDividerPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDividerKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

/**
 * State and handlers of a learner-resizable two-pane split: the % is remembered
 * per device under `storageKey`, re-clamped whenever the row resizes so neither
 * pane drops below its minimum width. `active` = the split is on screen
 * (desktop, both panes shown); the row is measured only then.
 */
export function useResizableSplit({
  storageKey,
  defaultPct,
  active,
}: {
  storageKey: string;
  defaultPct: number;
  active: boolean;
}): ResizableSplit {
  const [storedSplit, setSplit] = useState<number>(() => readStoredSplit(storageKey, defaultPct));
  const [bounds, setBounds] = useState<SplitBounds>(DEFAULT_BOUNDS);
  // The stored % re-clamped to what fits the current width.
  const split = clampSplit(storedSplit, bounds);
  const splitRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const updateSplit = useCallback(
    (value: number) => {
      const next = clampSplit(value, bounds);
      setSplit(next);
      storeSplit(storageKey, next);
    },
    [bounds, storageKey],
  );

  // Recompute the limits whenever the split container resizes.
  useEffect(() => {
    if (!active) return;
    const container = splitRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = boundsForWidth(container.getBoundingClientRect().width);
      setBounds((prev) =>
        Math.abs(prev.min - next.min) < 0.1 && Math.abs(prev.max - next.max) < 0.1 ? prev : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [active]);

  const onDividerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
  };
  const onDividerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = splitFromPointer(event.clientX, rect.left, rect.right, isRtl());
    if (next !== null) updateSplit(next);
  };
  const onDividerPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onDividerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = splitForKey(event.key, event.shiftKey, isRtl(), split, bounds);
    if (next === null) return;
    updateSplit(next);
    event.preventDefault();
  };

  return {
    splitRef,
    split,
    bounds,
    defaultPct,
    updateSplit,
    onDividerPointerDown,
    onDividerPointerMove,
    onDividerPointerUp,
    onDividerKeyDown,
  };
}
