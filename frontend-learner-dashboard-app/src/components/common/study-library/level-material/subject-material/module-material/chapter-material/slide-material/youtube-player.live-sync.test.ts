// @vitest-environment jsdom
/**
 * Live-class wall-clock sync in the YouTube player.
 *
 * A live class is a scheduled playback: the video must sit at "now − scheduled
 * start" for everyone. These tests drive the player with a fake YouTube iframe
 * whose position advances with the (fake) clock, and whose playVideo() on an
 * ENDED video restarts from 0 — the real API's behaviour, and the trap behind
 * every "the class started over" report.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  Trans: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
vi.mock("@/stores/study-library/youtube-video-tracking-store", () => ({
  useTrackingStore: (sel: (s: { addActivity: () => void }) => unknown) =>
    sel({ addActivity: () => {} }),
}));
vi.mock("@/hooks/study-library/useVideoSync", () => ({
  useVideoSync: () => ({ syncVideoTrackingData: () => {} }),
}));
vi.mock("@/hooks/useSlideContentProtection", () => ({
  useSlideContentProtection: () => ({ protectionEnabled: false }),
}));
vi.mock("@/stores/study-library/chapter-sidebar-store", () => ({
  useContentStore: () => ({ activeItem: null }),
}));
vi.mock("@/stores/mediaRefsStore", () => ({
  useMediaRefsStore: (
    sel: (s: { setCurrentYoutubeTime: () => void; setCurrentYoutubeVideoLength: () => void }) => unknown
  ) => sel({ setCurrentYoutubeTime: () => {}, setCurrentYoutubeVideoLength: () => {} }),
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: async () => ({ value: null }), set: async () => {} },
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => "web" },
}));
vi.mock("@/utils/app-plugin", () => ({
  App: { addListener: async () => ({ remove: async () => {} }) },
}));
vi.mock("./video-question-overlay", () => ({ default: () => null }));
vi.mock("@phosphor-icons/react", () => {
  const icon = (name: string) => () => React.createElement("i", { "data-icon": name });
  return {
    ArrowsOut: icon("ArrowsOut"), FastForward: icon("FastForward"), Pause: icon("Pause"),
    Play: icon("Play"), Rewind: icon("Rewind"), X: icon("X"), Gauge: icon("Gauge"),
    CheckCircle: icon("CheckCircle"), Clock: icon("Clock"),
  };
});

// ---------------------------------------------------------------------------
// Fake YouTube iframe player. Position advances with Date.now() while PLAYING.
// ---------------------------------------------------------------------------
const ENDED = 0, PLAYING = 1, PAUSED = 2, BUFFERING = 3, CUED = 5;

type Handlers = { onReady?: (e: unknown) => void; onStateChange?: (e: unknown) => void };
const yt: { handlers: Handlers } = { handlers: {} };

class FakePlayer {
  state = CUED;
  duration: number;
  /** Duration is hidden (0) until the first play — how a phone behaves. */
  durationHiddenUntilPlay: boolean;
  /** iOS: playVideo() and seekTo() are ignored until the learner has tapped. */
  autoplayBlocked = false;
  userGestureSeen = false;
  private hasPlayed = false;
  private posAtAnchor = 0;
  private anchorWall = Date.now();
  calls: string[] = [];

  constructor(duration: number, durationHiddenUntilPlay = false) {
    this.duration = duration;
    this.durationHiddenUntilPlay = durationHiddenUntilPlay;
  }

  private emit(state: number) {
    this.state = state;
    yt.handlers.onStateChange?.({ data: state, target: this });
  }
  /** The WebView froze: the video stopped, but no event has been delivered. */
  private frozen = false;
  freezeSilently() {
    this.anchor(this.position());
    this.frozen = true;
  }
  position() {
    if (this.state !== PLAYING || this.frozen) return this.posAtAnchor;
    return Math.min(this.duration, this.posAtAnchor + (Date.now() - this.anchorWall) / 1000);
  }
  private anchor(pos: number) {
    this.posAtAnchor = pos;
    this.anchorWall = Date.now();
  }
  /** Called by tests after advancing the clock: a video that ran out ENDS. */
  checkEnd() {
    if (this.state === PLAYING && this.position() >= this.duration) {
      this.anchor(this.duration);
      this.emit(ENDED);
    }
  }

  async getIframe() { return { src: "https://www.youtube.com/embed/x" }; }
  async getDuration() {
    return this.durationHiddenUntilPlay && !this.hasPlayed ? 0 : this.duration;
  }
  async getCurrentTime() { return this.position(); }
  async getPlayerState() { return this.state; }
  async getVolume() { return 100; }
  async setVolume() {}
  async unMute() {}
  async setPlaybackRate() {}
  unloadModule() {}
  setOption() {}
  private gestureMissing() {
    return this.autoplayBlocked && !this.userGestureSeen && !this.hasPlayed;
  }
  async playVideo() {
    this.calls.push(`play@${Math.round(this.position())}`);
    if (this.gestureMissing()) return;
    this.frozen = false;
    this.hasPlayed = true;
    // The real API: playing an ENDED video starts it over.
    const from = this.state === ENDED ? 0 : this.position();
    this.anchor(from);
    this.emit(PLAYING);
  }
  async pauseVideo() {
    this.calls.push(`pause@${Math.round(this.position())}`);
    this.frozen = false;
    if (this.state === PLAYING) {
      this.anchor(this.position());
      this.emit(PAUSED);
    }
  }
  async seekTo(seconds: number) {
    this.calls.push(`seek@${Math.round(seconds)}`);
    if (this.gestureMissing()) return;
    this.frozen = false;
    const wasPaused = this.state === PAUSED;
    this.anchor(Math.min(seconds, this.duration));
    if (wasPaused) return; // a paused player stays paused
    this.hasPlayed = true;
    this.emit(BUFFERING);
    this.emit(PLAYING);
  }
}

let fake: FakePlayer;
vi.mock("react-youtube", () => {
  const FakeYouTube = (props: Handlers) => {
    yt.handlers = props;
    React.useEffect(() => {
      props.onReady?.({ target: fake });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement("div", { "data-testid": "yt" });
  };
  return { default: FakeYouTube };
});

import YouTubePlayerWrapper from "./youtube-player";

// ---------------------------------------------------------------------------

const T0 = new Date("2026-09-13T12:30:00.000Z").getTime();
let root: Root | null = null;
let container: HTMLDivElement | null = null;

const mount = (props: Record<string, unknown>) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(React.createElement(YouTubePlayerWrapper as never, props as never));
  });
};

/** Advance the fake clock, letting timers, promises and the fake video run. */
const elapse = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  act(() => fake.checkEnd());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

const setHidden = async (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
  });
};

const liveProps = (startOffsetSeconds: number, extra: Record<string, unknown> = {}) => ({
  videoId: "abc123",
  isLiveStream: true,
  liveClassStartTime: new Date(T0 + startOffsetSeconds * 1000).toISOString(),
  allowPlayPause: false,
  allowRewind: false,
  enableConcentrationScore: false,
  ...extra,
});

const buttonsWith = (icon: string) =>
  Array.from(document.querySelectorAll("button")).filter((b) => b.querySelector(`i[data-icon="${icon}"]`));
const playButtons = () => buttonsWith("Play");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

describe("live class wall-clock sync", () => {
  it("a learner joining 5 minutes late lands 5 minutes in, not at the start", async () => {
    fake = new FakePlayer(600);
    mount(liveProps(-300)); // class started 5 min ago
    await elapse(4000);
    expect(fake.state).toBe(PLAYING);
    expect(fake.position()).toBeGreaterThanOrEqual(300);
    expect(fake.position()).toBeLessThan(310);
  });

  it("late join on a phone: duration only known after the first play still lands mid-video", async () => {
    fake = new FakePlayer(600, true); // getDuration() is 0 until playback starts
    mount(liveProps(-300));
    await elapse(6000); // ready-sync gives up on the duration; autoplay starts at 0
    // The PLAYING event finishes the job: the seek lands once the length is known.
    expect(fake.calls.some((c) => c.startsWith("seek@30"))).toBe(true);
    expect(fake.position()).toBeGreaterThanOrEqual(300);
    expect(fake.position()).toBeLessThan(312);
  });

  it("late join on iOS: autoplay and pre-tap seeks are ignored, the tap still lands mid-video", async () => {
    fake = new FakePlayer(600, true);
    fake.autoplayBlocked = true;
    mount(liveProps(-300));
    await elapse(8000);
    expect(fake.state).toBe(CUED);
    expect(document.body.textContent).toContain("youtubePlayer.manualPlay.tapToStart");

    fake.userGestureSeen = true;
    const tap = playButtons().find((b) => b.getAttribute("aria-label") === "youtubePlayer.manualPlay.ariaLabel");
    expect(tap).toBeDefined();
    await act(async () => { tap!.click(); await vi.advanceTimersByTimeAsync(0); });
    // Mobile Safari drops a play that lags the tap, so the play must not wait
    // behind the duration poll: it is PLAYING within a beat of the tap …
    await elapse(50);
    expect(fake.state).toBe(PLAYING);
    // … and the PLAYING event finishes the seek once the length is known.
    await elapse(1000);
    expect(fake.state).toBe(PLAYING);
    // Class is ~309s in by now; the old player would be playing from 0 here.
    expect(fake.position()).toBeGreaterThanOrEqual(300);
    expect(fake.position()).toBeLessThan(316);
  });

  it("switching away and back 90s later resumes at the live position, not the paused one", async () => {
    fake = new FakePlayer(600);
    mount(liveProps(-120)); // 2 min in
    await elapse(4000);
    expect(fake.position()).toBeGreaterThanOrEqual(120);

    await setHidden(true);
    // The OS pauses the video while the app is in the background.
    await act(async () => { await fake.pauseVideo(); });
    const pausedAt = fake.position();
    await elapse(90_000);
    expect(fake.position()).toBe(pausedAt); // nothing moved while away

    await setHidden(false);
    await elapse(2000);
    expect(fake.state).toBe(PLAYING);
    // Expected ≈ 120 + 4 + 90 + 2 = 216s; the paused position was ~124s.
    expect(fake.position()).toBeGreaterThanOrEqual(210);
    expect(fake.position()).toBeLessThan(222);
  });

  it("an 8-minute video in a 10-minute slot holds its last frame instead of starting over", async () => {
    fake = new FakePlayer(480);
    mount(liveProps(-450)); // 7:30 in, 30s of video left
    await elapse(4000);
    expect(fake.state).toBe(PLAYING);

    const playsBeforeEnd = fake.calls.filter((c) => c.startsWith("play@")).length;
    await elapse(40_000); // past the end of the video
    expect(fake.state).not.toBe(PLAYING);
    expect(fake.position()).toBe(480);
    // Nothing restarted it — no play call landed after the end.
    const playsAfterEnd = fake.calls.filter((c) => c.startsWith("play@")).length - playsBeforeEnd;
    expect(playsAfterEnd).toBe(0);

    // Two more minutes of the slot: still held, still no Play button offered.
    await elapse(120_000);
    expect(fake.position()).toBe(480);
    expect(document.body.textContent).toContain("youtubePlayer.live.ended");
    expect(playButtons()).toHaveLength(0);
  });

  it("joining after the video has already run out shows 'ended' and never plays from 0", async () => {
    fake = new FakePlayer(480);
    mount(liveProps(-540)); // 9 min into a slot with an 8-min video
    await elapse(4000);
    expect(fake.state).not.toBe(PLAYING);
    expect(document.body.textContent).toContain("youtubePlayer.live.ended");
    expect(playButtons()).toHaveLength(0);
  });

  it("joining before the scheduled start holds at 0, then begins on time", async () => {
    fake = new FakePlayer(600);
    mount(liveProps(60)); // starts in 60s
    await elapse(4000);
    expect(fake.state).not.toBe(PLAYING);
    expect(fake.position()).toBe(0);
    expect(document.body.textContent).toContain("youtubePlayer.live.notStarted");

    await elapse(58_000);
    expect(fake.state).toBe(PLAYING);
    expect(fake.position()).toBeLessThan(6);
    expect(document.body.textContent).not.toContain("youtubePlayer.live.notStarted");
  });

  it("a pause the learner chose resumes where they paused (pause control on)", async () => {
    fake = new FakePlayer(600);
    mount(liveProps(-120, { allowPlayPause: true }));
    await elapse(4000);
    expect(fake.state).toBe(PLAYING);

    const pause = buttonsWith("Pause")[0];
    await act(async () => { pause.click(); await vi.advanceTimersByTimeAsync(0); });
    expect(fake.state).toBe(PAUSED);
    const pausedAt = fake.position();
    const seeksBefore = fake.calls.filter((c) => c.startsWith("seek@")).length;

    await elapse(30_000);
    const play = playButtons()[0];
    await act(async () => { play.click(); await vi.advanceTimersByTimeAsync(0); });
    await elapse(500);
    expect(fake.state).toBe(PLAYING);
    expect(fake.calls.filter((c) => c.startsWith("seek@")).length).toBe(seeksBefore);
    expect(fake.position()).toBeLessThan(pausedAt + 3);
  });

  it("a deliberate pause survives a tab switch: position kept, still paused (pause control on)", async () => {
    fake = new FakePlayer(600);
    mount(liveProps(-120, { allowPlayPause: true }));
    await elapse(4000);
    const pause = buttonsWith("Pause")[0];
    await act(async () => { pause.click(); await vi.advanceTimersByTimeAsync(0); });
    expect(fake.state).toBe(PAUSED);
    const pausedAt = fake.position();
    const seeksBefore = fake.calls.filter((c) => c.startsWith("seek@")).length;

    await setHidden(true);
    await elapse(60_000);
    await setHidden(false);
    await elapse(2000);
    expect(fake.state).toBe(PAUSED);
    expect(fake.position()).toBe(pausedAt);
    expect(fake.calls.filter((c) => c.startsWith("seek@")).length).toBe(seeksBefore);
  });

  it("a rewind the learner is allowed to make is not snapped forward", async () => {
    fake = new FakePlayer(600);
    mount(liveProps(-120, { allowPlayPause: true, allowRewind: true }));
    await elapse(4000);
    expect(fake.state).toBe(PLAYING);
    const before = fake.position();

    const rewind = buttonsWith("Rewind")[0];
    await act(async () => { rewind.click(); await vi.advanceTimersByTimeAsync(0); });
    await elapse(5000);
    expect(fake.state).toBe(PLAYING);
    // 10s back, 5s played since: ~5s behind where it was, and left there.
    expect(fake.position()).toBeLessThan(before);
    expect(fake.position()).toBeGreaterThan(before - 8);
  });

  it("OS pause reported only after the app is back: still resumes at the live position", async () => {
    fake = new FakePlayer(600);
    mount(liveProps(-120));
    await elapse(4000);
    expect(fake.state).toBe(PLAYING);

    await setHidden(true);
    // The WebView froze before the player could report the pause; the video
    // stopped anyway, and the PAUSED lands a beat after foregrounding.
    fake.freezeSilently();
    const stoppedAt = fake.position();
    await elapse(90_000);
    expect(fake.position()).toBe(stoppedAt);
    await setHidden(false);
    await elapse(100);
    await act(async () => { await fake.pauseVideo(); });
    await elapse(3000);
    expect(fake.state).toBe(PLAYING);
    expect(fake.position()).toBeGreaterThanOrEqual(120 + 4 + 90);
    expect(fake.position()).toBeLessThan(120 + 4 + 90 + 12);
  });

  it("recorded (non-live) videos are untouched: no seek, no hold", async () => {
    fake = new FakePlayer(600);
    mount({ videoId: "abc123", isLiveStream: false, allowPlayPause: false, enableConcentrationScore: false });
    await elapse(4000);
    expect(fake.calls.some((c) => c.startsWith("seek@"))).toBe(false);
    expect(document.body.textContent).not.toContain("youtubePlayer.live.");
  });
});
