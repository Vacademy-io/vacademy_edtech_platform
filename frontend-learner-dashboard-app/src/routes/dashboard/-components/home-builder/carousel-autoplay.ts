/**
 * Banner carousel autoplay, as a pure state machine (spec 7.4.1).
 *
 *   PLAYING      rotates every ROTATE_MS.
 *   PAUSED_TEMP  held while the learner hovers, focuses or touches the
 *                carousel, while it is off screen or while the page is hidden.
 *                Resumes by itself once every hold is released.
 *   PAUSED_USER  the learner took control (pause button, swipe, dot, arrow key).
 *                Only the play button resumes it: no auto-resume this page view.
 *
 * A carousel with one slide, autoplay off, or prefers-reduced-motion starts in
 * PAUSED_USER, so it never moves on its own (WCAG 2.2.2).
 */
export const ROTATE_MS = 6000;

export type AutoplayState = "PLAYING" | "PAUSED_TEMP" | "PAUSED_USER";

/** Reasons a carousel is held still for now. */
export type HoldReason = "hover" | "focus" | "touch" | "offscreen" | "hidden";

export interface AutoplayModel {
  state: AutoplayState;
  holds: readonly HoldReason[];
}

export type AutoplayEvent =
  | { type: "HOLD"; reason: HoldReason }
  | { type: "RELEASE"; reason: HoldReason }
  /** The learner took control: pause button, swipe, dot click, arrow key. */
  | { type: "USER_CONTROL" }
  | { type: "PLAY" };

export function canAutoplay(opts: {
  slides: number;
  autoRotate: boolean;
  reducedMotion: boolean;
}): boolean {
  return opts.slides > 1 && opts.autoRotate && !opts.reducedMotion;
}

export function initialAutoplay(opts: {
  slides: number;
  autoRotate: boolean;
  reducedMotion: boolean;
}): AutoplayModel {
  return { state: canAutoplay(opts) ? "PLAYING" : "PAUSED_USER", holds: [] };
}

export function autoplayReducer(model: AutoplayModel, event: AutoplayEvent): AutoplayModel {
  switch (event.type) {
    case "HOLD": {
      const holds = model.holds.includes(event.reason) ? model.holds : [...model.holds, event.reason];
      if (model.state === "PAUSED_USER") return holds === model.holds ? model : { ...model, holds };
      return { state: "PAUSED_TEMP", holds };
    }
    case "RELEASE": {
      if (!model.holds.includes(event.reason)) return model;
      const holds = model.holds.filter((r) => r !== event.reason);
      if (model.state === "PAUSED_USER") return { ...model, holds };
      return { state: holds.length === 0 ? "PLAYING" : "PAUSED_TEMP", holds };
    }
    case "USER_CONTROL":
      return model.state === "PAUSED_USER" ? model : { ...model, state: "PAUSED_USER" };
    case "PLAY": {
      // Pressing play is the learner's explicit request, so the holds the click
      // itself creates (hover over the button, focus on it, the finger on it)
      // must not keep the carousel still. Off screen and a hidden tab still do.
      const holds = model.holds.filter((r) => r === "offscreen" || r === "hidden");
      return { state: holds.length === 0 ? "PLAYING" : "PAUSED_TEMP", holds };
    }
  }
}

/** Next slide index, wrapping to the first. */
export const nextIndex = (index: number, count: number): number =>
  count <= 0 ? 0 : (index + 1) % count;

/** Previous slide index, wrapping to the last. */
export const prevIndex = (index: number, count: number): number =>
  count <= 0 ? 0 : (index - 1 + count) % count;

/** Whether the play/pause button shows "Pause" (the carousel moves or will resume by itself). */
export const showsPause = (model: AutoplayModel): boolean => model.state !== "PAUSED_USER";
