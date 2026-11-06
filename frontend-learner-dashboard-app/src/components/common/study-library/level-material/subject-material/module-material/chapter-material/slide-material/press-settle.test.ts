import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPressTracker,
  PRESS_CEILING_MS,
  QUESTION_SETTLE_MS,
  TAP_SETTLE_MS,
  TRAILING_CLICK_MS,
  waitForPressesToSettle,
  type PressTracker,
} from "./press-settle";

const pointer = (type: string, pointerId: number, isPrimary = pointerId === 1) =>
  Object.assign(new Event(type, { cancelable: true }), { pointerId, isPrimary });

describe("waitForPressesToSettle", () => {
  let page: EventTarget;
  let tracker: PressTracker;
  let settled: ReturnType<typeof vi.fn>;

  const start = () => waitForPressesToSettle(tracker, settled);
  const click = () => {
    const e = new Event("click", { cancelable: true });
    page.dispatchEvent(e);
    return e;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    page = new EventTarget();
    tracker = createPressTracker(page);
    settled = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("settles when the window ends if nothing is pressed", () => {
    start();
    vi.advanceTimersByTime(TAP_SETTLE_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("holds past the window while a finger is down, then until its click has landed", () => {
    start();
    vi.advanceTimersByTime(300);
    page.dispatchEvent(pointer("pointerdown", 1));
    vi.advanceTimersByTime(400);
    expect(settled).not.toHaveBeenCalled();

    page.dispatchEvent(pointer("pointerup", 1));
    vi.advanceTimersByTime(50);
    expect(settled).not.toHaveBeenCalled();

    click();
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("does not let a lift just inside the window lose the race with its click", () => {
    start();
    page.dispatchEvent(pointer("pointerdown", 1));
    vi.advanceTimersByTime(TAP_SETTLE_MS - 10);
    page.dispatchEvent(pointer("pointerup", 1));
    vi.advanceTimersByTime(TRAILING_CLICK_MS - 1);
    expect(settled).not.toHaveBeenCalled();
  });

  it("still ends the wait when a lift brings no click, as after a real long press", () => {
    start();
    page.dispatchEvent(pointer("pointerdown", 1));
    vi.advanceTimersByTime(600);
    page.dispatchEvent(pointer("pointerup", 1));
    vi.advanceTimersByTime(TRAILING_CLICK_MS);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("does not wait for a click after a cancel, because none comes", () => {
    start();
    page.dispatchEvent(pointer("pointerdown", 1));
    vi.advanceTimersByTime(600);
    page.dispatchEvent(pointer("pointercancel", 1));
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("waits for every finger", () => {
    start();
    page.dispatchEvent(pointer("pointerdown", 1));
    page.dispatchEvent(pointer("pointerdown", 2));
    vi.advanceTimersByTime(600);
    page.dispatchEvent(pointer("pointerup", 2));
    vi.advanceTimersByTime(TRAILING_CLICK_MS + 50);
    expect(settled).not.toHaveBeenCalled();
    page.dispatchEvent(pointer("pointerup", 1));
    click();
    vi.advanceTimersByTime(0);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("counts a press that began before the wait", () => {
    page.dispatchEvent(pointer("pointerdown", 1));
    start();
    vi.advanceTimersByTime(TAP_SETTLE_MS + 200);
    expect(settled).not.toHaveBeenCalled();
    page.dispatchEvent(pointer("pointerup", 1));
    click();
    vi.advanceTimersByTime(0);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("lets go at the ceiling and swallows that press's click only", () => {
    start();
    page.dispatchEvent(pointer("pointerdown", 1));
    vi.advanceTimersByTime(PRESS_CEILING_MS);
    expect(settled).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(4000);
    page.dispatchEvent(pointer("pointerup", 1));
    expect(click().defaultPrevented).toBe(true);
    expect(click().defaultPrevented).toBe(false);
  });

  it("does not swallow a later click when the lift of a disowned press was never heard", () => {
    start();
    page.dispatchEvent(pointer("pointerdown", 1));
    vi.advanceTimersByTime(PRESS_CEILING_MS);

    page.dispatchEvent(pointer("pointerdown", 1));
    page.dispatchEvent(pointer("pointerup", 1));
    expect(click().defaultPrevented).toBe(false);
  });

  it("forgets a press whose lift was lost as soon as a new first finger lands", () => {
    page.dispatchEvent(pointer("pointerdown", 7, true));
    expect(tracker.held()).toBe(1);
    page.dispatchEvent(pointer("pointerdown", 8, true));
    page.dispatchEvent(pointer("pointerup", 8));
    expect(tracker.held()).toBe(0);
  });

  it("cancelled by its screen leaving, it never reports", () => {
    const cancel = start();
    cancel();
    vi.advanceTimersByTime(PRESS_CEILING_MS);
    expect(settled).not.toHaveBeenCalled();
  });

  describe("presses a busy page hears late", () => {
    const at = (type: string, timeStamp: number) => {
      const e = new Event(type, { cancelable: true });
      Object.defineProperty(e, "timeStamp", { value: timeStamp });
      return Object.assign(e, { pointerId: 1, isPrimary: true, detail: 1 });
    };
    let now: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      now = vi.spyOn(performance, "now").mockReturnValue(1000);
    });
    afterEach(() => {
      now.mockRestore();
    });

    it("refuses the click of a press that began inside the window, heard after it", () => {
      waitForPressesToSettle(tracker, settled, QUESTION_SETTLE_MS);
      vi.advanceTimersByTime(QUESTION_SETTLE_MS);
      expect(settled).toHaveBeenCalledTimes(1);

      page.dispatchEvent(at("pointerdown", 1000 + QUESTION_SETTLE_MS - 50));
      page.dispatchEvent(at("pointerup", 1000 + QUESTION_SETTLE_MS - 10));
      const c = at("click", 1000 + QUESTION_SETTLE_MS + 40);
      page.dispatchEvent(c);
      expect(c.defaultPrevented).toBe(true);
    });

    it("lets through a press that began after the window", () => {
      waitForPressesToSettle(tracker, settled, QUESTION_SETTLE_MS);
      vi.advanceTimersByTime(QUESTION_SETTLE_MS);

      page.dispatchEvent(at("pointerdown", 1000 + QUESTION_SETTLE_MS + 1));
      page.dispatchEvent(at("pointerup", 1000 + QUESTION_SETTLE_MS + 60));
      const c = at("click", 1000 + QUESTION_SETTLE_MS + 70);
      page.dispatchEvent(c);
      expect(c.defaultPrevented).toBe(false);
    });

    it("never refuses a keyboard click", () => {
      waitForPressesToSettle(tracker, settled, QUESTION_SETTLE_MS);
      page.dispatchEvent(at("pointerdown", 1000));
      page.dispatchEvent(at("pointerup", 1010));
      const c = Object.assign(at("click", 1020), { detail: 0 });
      page.dispatchEvent(c);
      expect(c.defaultPrevented).toBe(false);
    });

    it("stops refusing once the screen is gone", () => {
      const cancel = waitForPressesToSettle(tracker, settled, QUESTION_SETTLE_MS);
      cancel();
      page.dispatchEvent(at("pointerdown", 1100));
      page.dispatchEvent(at("pointerup", 1110));
      const c = at("click", 1120);
      page.dispatchEvent(c);
      expect(c.defaultPrevented).toBe(false);
    });
  });
});
