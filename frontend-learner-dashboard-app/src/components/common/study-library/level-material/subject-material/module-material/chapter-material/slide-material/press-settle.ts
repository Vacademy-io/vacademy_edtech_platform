/** Longer than the gap between the taps of a double tap. */
export const TAP_SETTLE_MS = 450;
/**
 * Questions wait longer, because that is where a stray tap costs an answer and where
 * the wait costs nothing: nobody has read a question this soon after it appears.
 */
export const QUESTION_SETTLE_MS = 800;
/**
 * A click is sent by the browser some time after the finger lifts (45 ms measured
 * on an idle machine), and it lands on whatever is on top when it arrives.
 */
export const TRAILING_CLICK_MS = 300;
/** However long a finger stays down, or if its lift is never heard, the screen frees up by now. */
export const PRESS_CEILING_MS = 2500;

type PressEvent = "lift" | "cancel" | "click";

/** Which presses are down right now, whatever they began on. */
export interface PressTracker {
  held: () => number;
  subscribe: (listener: (event: PressEvent) => void) => () => void;
  /** The screen stopped waiting for these presses, so their clicks must not reach it. */
  disownHeld: () => void;
  /**
   * A press that began before this time (the clock of event timestamps) has no click.
   * The timestamp says when the finger came down, however late the busy page heard it.
   */
  refusePressesBefore: (time: number) => void;
}

export function createPressTracker(target: EventTarget): PressTracker {
  const down = new Set<number>();
  const disowned = new Set<number>();
  const listeners = new Set<(event: PressEvent) => void>();
  let swallowClickUntil = 0;
  let lastPressAt: number | null = null;
  let refuseBefore = 0;

  const notify = (event: PressEvent) => {
    listeners.forEach((listener) => listener(event));
  };
  const release = (pointerId: number) => {
    const wasDown = down.delete(pointerId);
    disowned.delete(pointerId);
    return wasDown;
  };

  target.addEventListener(
    "pointerdown",
    (e) => {
      const { pointerId, isPrimary, timeStamp } = e as PointerEvent;
      lastPressAt = timeStamp;
      // A primary pointer means none other is down, so anything left here lost its lift.
      if (isPrimary) {
        down.clear();
        disowned.clear();
      }
      down.add(pointerId);
    },
    { capture: true, passive: true },
  );
  target.addEventListener(
    "pointerup",
    (e) => {
      const { pointerId } = e as PointerEvent;
      if (disowned.has(pointerId)) swallowClickUntil = Date.now() + TRAILING_CLICK_MS;
      if (release(pointerId)) notify("lift");
    },
    { capture: true, passive: true },
  );
  target.addEventListener(
    "pointercancel",
    (e) => {
      if (release((e as PointerEvent).pointerId)) notify("cancel");
    },
    { capture: true, passive: true },
  );
  target.addEventListener(
    "click",
    (e) => {
      const pressAt = lastPressAt;
      lastPressAt = null;
      // Keyboard clicks have detail 0 and no press behind them.
      const refused =
        (e as MouseEvent).detail > 0 && pressAt !== null && pressAt < refuseBefore;
      if (refused || Date.now() < swallowClickUntil) {
        swallowClickUntil = 0;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      notify("click");
    },
    { capture: true },
  );

  return {
    held: () => down.size,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    disownHeld: () => down.forEach((id) => disowned.add(id)),
    refusePressesBefore: (time) => {
      refuseBefore = time;
    },
  };
}

/**
 * Calls onSettled once the window has passed and no press from it is left: every
 * finger is up and the click of the last one has landed, or never came. A press
 * that is still going at the ceiling is let go, without its click.
 * Returns a function that cancels the wait.
 */
export function waitForPressesToSettle(
  tracker: PressTracker,
  onSettled: () => void,
  settleMs: number = TAP_SETTLE_MS,
): () => void {
  let windowOver = false;
  let clickTimer: number | undefined;
  let done = false;

  tracker.refusePressesBefore(performance.now() + settleMs);

  const stop = () => {
    done = true;
    window.clearTimeout(windowTimer);
    window.clearTimeout(ceilingTimer);
    window.clearTimeout(clickTimer);
    unsubscribe();
  };
  const settleIfClear = () => {
    if (done || !windowOver || clickTimer !== undefined || tracker.held() > 0) return;
    stop();
    onSettled();
  };
  const endClickWait = () => {
    window.clearTimeout(clickTimer);
    clickTimer = undefined;
  };

  const unsubscribe = tracker.subscribe((event) => {
    if (event === "lift") {
      endClickWait();
      clickTimer = window.setTimeout(() => {
        clickTimer = undefined;
        settleIfClear();
      }, TRAILING_CLICK_MS);
    } else if (event === "cancel") {
      settleIfClear();
    } else if (clickTimer !== undefined) {
      endClickWait();
      // After this click has finished going through the page.
      window.setTimeout(settleIfClear, 0);
    }
  });
  const windowTimer = window.setTimeout(() => {
    windowOver = true;
    settleIfClear();
  }, settleMs);
  const ceilingTimer = window.setTimeout(() => {
    tracker.disownHeld();
    stop();
    onSettled();
  }, PRESS_CEILING_MS);

  return () => {
    if (done) return;
    stop();
    // The screen is gone, so the next one's presses are its own business.
    tracker.refusePressesBefore(0);
  };
}
