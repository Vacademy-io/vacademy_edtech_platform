import { describe, expect, it } from "vitest";
import {
  ROTATE_MS,
  autoplayReducer,
  canAutoplay,
  initialAutoplay,
  nextIndex,
  prevIndex,
  showsPause,
  type AutoplayEvent,
  type AutoplayModel,
} from "./carousel-autoplay";

const run = (model: AutoplayModel, ...events: AutoplayEvent[]) => events.reduce(autoplayReducer, model);
const playing = initialAutoplay({ slides: 3, autoRotate: true, reducedMotion: false });

describe("carousel autoplay", () => {
  it("rotates every 6 s (owner decision)", () => {
    expect(ROTATE_MS).toBe(6000);
  });

  it("starts PLAYING only with 2+ slides, auto_rotate on and no reduced motion", () => {
    expect(playing.state).toBe("PLAYING");
    expect(initialAutoplay({ slides: 1, autoRotate: true, reducedMotion: false }).state).toBe("PAUSED_USER");
    expect(initialAutoplay({ slides: 3, autoRotate: false, reducedMotion: false }).state).toBe("PAUSED_USER");
    expect(initialAutoplay({ slides: 3, autoRotate: true, reducedMotion: true }).state).toBe("PAUSED_USER");
    expect(canAutoplay({ slides: 2, autoRotate: true, reducedMotion: false })).toBe(true);
  });

  it("hover, focus, touch, off screen and a hidden tab hold it; it resumes when all are released", () => {
    for (const reason of ["hover", "focus", "touch", "offscreen", "hidden"] as const) {
      const held = run(playing, { type: "HOLD", reason });
      expect(held.state).toBe("PAUSED_TEMP");
      expect(run(held, { type: "RELEASE", reason }).state).toBe("PLAYING");
    }
    const two = run(playing, { type: "HOLD", reason: "hover" }, { type: "HOLD", reason: "focus" });
    expect(run(two, { type: "RELEASE", reason: "hover" }).state).toBe("PAUSED_TEMP");
    expect(run(two, { type: "RELEASE", reason: "hover" }, { type: "RELEASE", reason: "focus" }).state).toBe("PLAYING");
  });

  it("holding twice for the same reason needs one release", () => {
    const m = run(playing, { type: "HOLD", reason: "hover" }, { type: "HOLD", reason: "hover" });
    expect(run(m, { type: "RELEASE", reason: "hover" }).state).toBe("PLAYING");
  });

  it("a release without a hold changes nothing", () => {
    expect(run(playing, { type: "RELEASE", reason: "touch" })).toBe(playing);
  });

  it("taking control (pause, swipe, dot, arrow) stops it for the page view", () => {
    const m = run(playing, { type: "HOLD", reason: "touch" }, { type: "USER_CONTROL" }, { type: "RELEASE", reason: "touch" });
    expect(m.state).toBe("PAUSED_USER");
    expect(run(m, { type: "HOLD", reason: "hover" }, { type: "RELEASE", reason: "hover" }).state).toBe("PAUSED_USER");
  });

  it("only the play button resumes, even while the pointer and focus are on it", () => {
    const paused = run(playing, { type: "HOLD", reason: "hover" }, { type: "HOLD", reason: "focus" }, { type: "USER_CONTROL" });
    const resumed = run(paused, { type: "PLAY" });
    expect(resumed.state).toBe("PLAYING");
    // ...but an off-screen carousel still waits.
    const offscreen = run(paused, { type: "HOLD", reason: "offscreen" }, { type: "PLAY" });
    expect(offscreen.state).toBe("PAUSED_TEMP");
    expect(run(offscreen, { type: "RELEASE", reason: "offscreen" }).state).toBe("PLAYING");
  });

  it("the button shows Pause unless the learner paused it", () => {
    expect(showsPause(playing)).toBe(true);
    expect(showsPause(run(playing, { type: "HOLD", reason: "hover" }))).toBe(true);
    expect(showsPause(run(playing, { type: "USER_CONTROL" }))).toBe(false);
  });

  it("wraps around both ways", () => {
    expect(nextIndex(2, 3)).toBe(0);
    expect(nextIndex(0, 3)).toBe(1);
    expect(prevIndex(0, 3)).toBe(2);
    expect(nextIndex(0, 0)).toBe(0);
  });
});
