/**
 * Pure maths of the live test's two-pane split (start pane | divider | end pane).
 * Shared by the Spreadsheet & Written Response (CBE) view and the
 * "passage beside the question" view. No React, no DOM: unit-tested on its own.
 */

/** Start-pane width limits, in % of the split, and its default. */
export const SPLIT_MIN = 22;
export const SPLIT_MAX = 62;
/** Pixel floors the % limits must respect (min-w-reg-250 / min-w-reg-400, divider w-3). */
export const START_MIN_PX = 250;
export const END_MIN_PX = 400;
export const DIVIDER_PX = 12;
/** Keyboard steps (arrow, Shift+arrow). */
export const SPLIT_STEP = 2;
export const SPLIT_STEP_LARGE = 10;

export type SplitBounds = { min: number; max: number };
export const DEFAULT_BOUNDS: SplitBounds = { min: SPLIT_MIN, max: SPLIT_MAX };

export const clampSplit = (value: number, bounds: SplitBounds = DEFAULT_BOUNDS): number =>
  Math.min(bounds.max, Math.max(bounds.min, value));

/** % limits for a split of `width` px, so neither pane drops below its minimum width. */
export const boundsForWidth = (width: number): SplitBounds => {
  if (width <= 0) return DEFAULT_BOUNDS;
  const max = Math.max(0, Math.min(SPLIT_MAX, ((width - DIVIDER_PX - END_MIN_PX) / width) * 100));
  const min = Math.max(SPLIT_MIN, (START_MIN_PX / width) * 100);
  // Too narrow for both minimums: give the end (answer) pane the room.
  return max < min ? { min: max, max } : { min, max };
};

/**
 * Whether a row `width` px wide holds both panes at their pixel floors. An
 * unmeasured row (0, e.g. before layout) counts as wide enough.
 */
export const splitFits = (width: number): boolean =>
  width <= 0 || width >= START_MIN_PX + DIVIDER_PX + END_MIN_PX;

/** A remembered split (raw storage string) as a usable %, or the fallback. */
export const parseStoredSplit = (raw: string | null | undefined, fallback: number): number => {
  const stored = Number(raw);
  return Number.isFinite(stored) && stored > 0 ? clampSplit(stored) : fallback;
};

/**
 * New split for a keyboard key on the divider, or null when the key is not one
 * the divider handles. Arrows move the divider the way they point, in either
 * text direction.
 */
export const splitForKey = (
  key: string,
  shiftKey: boolean,
  rtl: boolean,
  split: number,
  bounds: SplitBounds,
): number | null => {
  const step = shiftKey ? SPLIT_STEP_LARGE : SPLIT_STEP;
  const towardEnd = rtl ? -step : step;
  switch (key) {
    case "ArrowRight":
      return split + towardEnd;
    case "ArrowLeft":
      return split - towardEnd;
    case "Home":
      return bounds.min;
    case "End":
      return bounds.max;
    default:
      return null;
  }
};

/** Split % for a pointer at `clientX` over a container spanning `left`..`right`. */
export const splitFromPointer = (
  clientX: number,
  left: number,
  right: number,
  rtl: boolean,
): number | null => {
  const width = right - left;
  if (width <= 0) return null;
  const fromStart = rtl ? right - clientX : clientX - left;
  return (fromStart / width) * 100;
};
