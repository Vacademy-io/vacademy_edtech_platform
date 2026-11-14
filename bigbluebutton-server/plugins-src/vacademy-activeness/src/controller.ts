/**
 * Everything outside React: camera, face tracker, sampling loop, score and
 * reporting. The floating panel renders getState() and calls the actions.
 *
 * Protecting the class comes first. The loop samples about once a second, backs
 * off when the computer is slow, and switches itself off rather than starve
 * BBB's own audio/video on a budget laptop.
 */
import { ActivenessMeter, type LiveScore, type Score } from "./meter";
import { CameraError, type CameraProblem, listCameras, openCamera, stopStream } from "./camera";
import { createAttentionTracker, type AttentionTracker } from "./tracker";
import { persistKey, sendReport, sendStatus, type ActivenessStatus, type ReportPayload } from "./report";

export type Phase = "starting" | "on" | "off" | "problem";

export interface ViewState {
  phase: Phase;
  problem: CameraProblem | null;
  live: LiveScore;
  session: Score;
  /** No face for a while, or the class tab was in the background. */
  away: boolean;
  /** The frame is nearly black: lens covered, shutter closed or a very dark room. */
  dark: boolean;
  collapsed: boolean;
  /** First-time model download is taking a while. */
  slowLoad: boolean;
  /** The browser's camera prompt has been open a while — tell the learner to answer it. */
  askingPermission: boolean;
  /** Still learning this learner's normal head position. */
  calibrating: boolean;
  cameras: { id: string; label: string }[];
  cameraId: string | null;
}

const BASE_INTERVAL_MS = 1000;
const MAX_INTERVAL_MS = 3000;
/**
 * Readings this slow on average (or two in a row over SLOW_READING_MS) mean the
 * computer is struggling: turn off rather than freeze the class a little every
 * second. A normal laptop takes 15–60 ms.
 */
const TOO_SLOW_MS = 250;
const SLOW_READING_MS = 1500;
const SLOW_LOAD_MS = 15_000;
const LOAD_TIMEOUT_MS = 120_000;
const ASKING_PERMISSION_AFTER_MS = 4000;
/** No face this long (or the tab hidden this long) = stepped away. */
const AWAY_AFTER_MS = 8000;
const BACK_AFTER_SAMPLES = 2;
/** Away at least this long = re-learn the resting pose on return. */
const RECALIBRATE_AFTER_MS = 30_000;
const DARK_BELOW = 14;
const DARK_AFTER_MS = 8000;
/** This many readings in a row without a frame = the camera stopped. */
const FRAMELESS_LIMIT = 15;
const REPORT_EVERY_MS = 60_000;
/** A hidden-tab beacon only if nothing was sent this recently (alt-tabbing to notes). */
const HIDE_BEACON_GAP_MS = 15_000;
/**
 * Most background time one tick may add. Timers do not run while the computer
 * sleeps, so a lid closed overnight shows up as one huge gap — it must not count.
 */
const HIDDEN_TICK_CAP_MS = 65_000;
/** Nothing is reported before this much tracked time. */
const MIN_REPORT_MS = 10_000;
/** Collapse to the small pill after this long on, so the panel never sits over BBB's chat. */
const AUTO_COLLAPSE_MS = 20_000;
/**
 * Before our own camera prompt, let BBB's microphone prompt / audio dialog go
 * first (two browser prompts at once confuse learners and can block the mic).
 */
const MIC_SETTLE_MAX_MS = 20_000;
const MIC_SETTLE_FALLBACK_MS = 8000;
const CAMERA_KEY = "vacademy.activeness.camera";
const RESUME_MAX_AGE_MS = 12 * 3600_000;

const STATUS_FOR_PROBLEM: Record<CameraProblem, ActivenessStatus> = {
  denied: "camera_blocked",
  "os-blocked": "camera_blocked",
  "in-use": "camera_busy",
  "not-found": "no_camera",
  ended: "camera_stopped",
  slow: "too_slow",
  load: "load_failed",
  unknown: "camera_stopped",
};

const EMPTY_LIVE: LiveScore = { score: null, onScreen: null, attention: null, reason: null, reasonIsCurrent: false };

/**
 * Timer, event and async entry points run through this. An exception that escapes
 * a plugin reaches the BBB client's global error handler, which can put a reload
 * screen in front of the class — a broken score must only ever switch itself off.
 */
const guard =
  <A extends unknown[]>(name: string, fn: (...args: A) => void, onError?: () => void) =>
  (...args: A) => {
    try {
      fn(...args);
    } catch (error) {
      console.warn(`[activeness] ${name} failed`, error);
      try {
        onError?.();
      } catch {
        // Nothing more to do.
      }
    }
  };

const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Private mode: lasts for this class only.
    }
  },
};

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

type PermissionName = "camera" | "microphone";
const permissionState = async (name: PermissionName): Promise<PermissionState | null> => {
  try {
    // "camera"/"microphone" are not in every browser's PermissionName list (Firefox).
    const status = await navigator.permissions.query({ name: name as unknown as globalThis.PermissionName });
    return status.state;
  } catch {
    return null;
  }
};

/** Resolves once the microphone permission is no longer being asked (or after maxMs). */
const waitForMicSettled = async (maxMs: number) => {
  let status: PermissionStatus | null = null;
  try {
    status = await navigator.permissions.query({ name: "microphone" as unknown as globalThis.PermissionName });
  } catch {
    status = null;
  }
  if (!status) return sleep(MIC_SETTLE_FALLBACK_MS);
  if (status.state !== "prompt") return sleep(1500);
  const settled = status;
  await new Promise<void>((resolve) => {
    const done = () => {
      window.clearTimeout(timer);
      settled.removeEventListener("change", done);
      resolve();
    };
    const timer = window.setTimeout(done, maxMs);
    settled.addEventListener("change", done);
  });
  return sleep(1500);
};

/** The learner is watching the class in BBB's picture-in-picture window, not "away". */
const watchingInPip = (): boolean => {
  try {
    const dpip = (window as unknown as { documentPictureInPicture?: { window?: Window | null } }).documentPictureInPicture;
    return !!dpip?.window || !!document.pictureInPictureElement;
  } catch {
    return false;
  }
};

export class ActivenessController {
  private state: ViewState;
  private listeners = new Set<() => void>();
  private readonly meter: ActivenessMeter;
  private readonly video: HTMLVideoElement;
  private readonly parking: HTMLDivElement;
  private stream: MediaStream | null = null;
  private tracker: AttentionTracker | null = null;
  private timer: number | null = null;
  private generation = 0;
  private interval = BASE_INTERVAL_MS;
  private costEma = 0;
  private readings = 0;
  private slowStreak = 0;
  private lastTickAt = 0;
  private lastFaceAt = 0;
  private awaySince: number | null = null;
  private faceRun = 0;
  private darkSince: number | null = null;
  private frameless = 0;
  private hiddenAt: number | null = null;
  private lastReportAt = 0;
  private onSince: number | null = null;
  /** The learner opened or closed the panel themselves: never auto-collapse over that. */
  private userChoseLayout = false;
  private disposed = false;

  constructor(
    private readonly token: string,
    private readonly reportUrl: string
  ) {
    this.meter = new ActivenessMeter(this.loadResume());
    this.video = Object.assign(document.createElement("video"), { muted: true, playsInline: true, autoplay: true });
    this.video.setAttribute("muted", "");
    this.video.setAttribute("playsinline", "");
    Object.assign(this.video.style, {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      transform: "scaleX(-1)",
      display: "block",
    });
    // When the panel is not mounted the video waits here, still in the document so
    // the browser keeps decoding frames for the tracker.
    this.parking = document.createElement("div");
    Object.assign(this.parking.style, {
      position: "fixed",
      right: "0",
      bottom: "0",
      width: "2px",
      height: "2px",
      opacity: "0.01",
      overflow: "hidden",
      pointerEvents: "none",
    });
    this.parking.setAttribute("aria-hidden", "true");
    this.parking.appendChild(this.video);
    document.body.appendChild(this.parking);

    // On by default: the institute turned the score on for this class, so the
    // camera starts without asking. "Turn off" holds for this class only (the
    // key is per schedule + learner), so the next class starts on again.
    const turnedOff = storage.get(this.offKey) === "1";
    this.state = {
      phase: turnedOff ? "off" : "starting",
      problem: null,
      live: EMPTY_LIVE,
      session: this.meter.session(),
      away: false,
      dark: false,
      collapsed: turnedOff,
      slowLoad: false,
      askingPermission: false,
      calibrating: true,
      cameras: [],
      cameraId: storage.get(CAMERA_KEY),
    };

    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("pagehide", this.onPageHide);
    navigator.mediaDevices?.addEventListener?.("devicechange", this.onDeviceChange);

    if (turnedOff) this.status("turned_off");
    else this.autoStart();
  }

  private get offKey() {
    return `${persistKey(this.token) ?? "vacademy.activeness"}.off`;
  }

  // ── store ────────────────────────────────────────────────────────────────

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getState = () => this.state;

  private set(patch: Partial<ViewState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => guard("render", fn)());
  }

  // ── actions ──────────────────────────────────────────────────────────────

  /**
   * Default-on start. With the camera already allowed for this site it starts at
   * once; otherwise it waits for BBB's microphone prompt to be answered first.
   */
  private autoStart() {
    const gen = this.generation;
    (async () => {
      if ((await permissionState("camera")) !== "granted") await waitForMicSettled(MIC_SETTLE_MAX_MS);
      if (this.disposed || gen !== this.generation || this.state.phase !== "starting") return;
      this.start();
    })().catch((error) => {
      console.warn("[activeness] auto start failed", error);
      guard("fail", () => this.fail("unknown"))();
    });
  }

  /** The learner turned the score on (or pressed Try again). */
  start = () => {
    this.startInner().catch((error) => {
      console.warn("[activeness] start failed", error);
      guard("fail", () => this.fail("unknown"))();
    });
  };

  private startInner = async () => {
    if (this.disposed) return;
    const gen = ++this.generation;
    storage.set(this.offKey, "0");
    this.releaseCamera();
    this.set({ phase: "starting", problem: null, slowLoad: false, askingPermission: false, collapsed: false });
    const asking = window.setTimeout(() => {
      if (gen !== this.generation) return;
      this.set({ askingPermission: true });
      this.status("awaiting_permission");
    }, ASKING_PERMISSION_AFTER_MS);
    try {
      let stream: MediaStream;
      try {
        stream = await openCamera(this.state.cameraId ?? undefined);
      } finally {
        window.clearTimeout(asking);
      }
      if (gen !== this.generation) return stopStream(stream);
      this.stream = stream;
      this.video.srcObject = stream;
      void this.video.play().catch(() => undefined);
      stream.getVideoTracks().forEach((t) => t.addEventListener("ended", this.onTrackEnded));
      this.set({ askingPermission: false });
      void this.refreshCameras().catch(() => undefined);

      if (!this.tracker) {
        const tracker = await this.loadTracker(gen);
        if (!tracker) return;
        this.tracker = tracker;
      }
      // A new camera (or a retry) is a new angle: learn the normal position again.
      this.tracker.recalibrate();

      this.costEma = 0;
      this.readings = 0;
      this.slowStreak = 0;
      this.interval = BASE_INTERVAL_MS;
      this.frameless = 0;
      this.lastTickAt = Date.now();
      this.lastFaceAt = Date.now();
      this.onSince = Date.now();
      this.set({ phase: "on", slowLoad: false, away: false, dark: false, calibrating: true });
      this.schedule();
    } catch (error) {
      if (gen !== this.generation) return;
      this.fail(error instanceof CameraError ? error.problem : "unknown");
    }
  };

  /** Loads the face model; never leaves an instance behind if the start was overtaken. */
  private async loadTracker(gen: number): Promise<AttentionTracker | null> {
    const slow = window.setTimeout(() => gen === this.generation && this.set({ slowLoad: true }), SLOW_LOAD_MS);
    let timeout = 0;
    const loading = createAttentionTracker();
    try {
      const tracker = await Promise.race([
        loading,
        new Promise<never>((_, reject) => {
          timeout = window.setTimeout(() => reject(new Error("timeout")), LOAD_TIMEOUT_MS);
        }),
      ]);
      if (this.disposed || gen !== this.generation) {
        tracker.close();
        return null;
      }
      return tracker;
    } catch (error) {
      // A load that finishes after the timeout must still be closed.
      loading.then((late) => late.close()).catch(() => undefined);
      console.warn("[activeness] face model unavailable", error);
      if (gen === this.generation) this.fail("load");
      return null;
    } finally {
      window.clearTimeout(slow);
      window.clearTimeout(timeout);
    }
  }

  /** The learner turned it off: report what we have, free the camera and the model. */
  stop = guard("stop", () => {
    storage.set(this.offKey, "1");
    this.generation += 1;
    this.report(false);
    this.status("turned_off");
    this.releaseCamera();
    this.closeTracker();
    this.userChoseLayout = true;
    this.set({ phase: "off", problem: null, away: false, dark: false, collapsed: true, live: EMPTY_LIVE });
  });

  setCollapsed = guard("collapse", (collapsed: boolean) => {
    this.userChoseLayout = true;
    this.set({ collapsed });
  });

  /**
   * "I'm facing the screen": re-learn this learner's normal head position now.
   * For a camera at an odd angle (side monitor, laptop off to one side) where
   * looking at the class read as looking away.
   */
  recalibrate = guard("recalibrate", () => {
    if (this.state.phase !== "on" || !this.tracker) return;
    this.tracker.recalibrate();
    this.meter.resetLive();
    this.set({ live: this.meter.live(Date.now()), calibrating: true });
  });

  switchCamera = guard("switch-camera", (id: string) => {
    storage.set(CAMERA_KEY, id);
    this.set({ cameraId: id });
    if (this.state.phase === "on" || this.state.phase === "problem") this.start();
  });

  /** The panel mounts the live preview here; null when it unmounts. */
  attachPreview = guard("preview", (container: HTMLElement | null) => {
    const target = container ?? this.parking;
    if (this.video.parentElement !== target) target.appendChild(this.video);
    if (this.stream) void this.video.play().catch(() => undefined);
  });

  /** The class ended, the plugin is being unloaded, or its panel crashed. */
  dispose = guard("dispose", () => {
    if (this.disposed) return;
    this.report(true);
    this.disposed = true;
    this.generation += 1;
    this.releaseCamera();
    this.closeTracker();
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pagehide", this.onPageHide);
    navigator.mediaDevices?.removeEventListener?.("devicechange", this.onDeviceChange);
    this.parking.remove();
    this.listeners.clear();
  });

  // ── loop ─────────────────────────────────────────────────────────────────

  private schedule() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(this.tick, this.interval);
  }

  private tick = guard("tick", () => this.tickInner(), () => this.fail("unknown"));

  private tickInner() {
    this.timer = null;
    if (this.state.phase !== "on" || !this.tracker) return;
    const now = Date.now();
    const gap = Math.max(0, now - this.lastTickAt);
    this.lastTickAt = now;
    if (document.visibilityState === "hidden") {
      this.tickHidden(now, gap);
      return this.schedule();
    }
    const dt = Math.min(5000, gap);

    const t0 = performance.now();
    const reading = this.tracker.read(this.video);
    const cost = performance.now() - t0;

    if (this.tracker.broken) {
      // The model threw (e.g. a WASM abort): load a fresh one on Try again.
      this.closeTracker();
      return this.fail("load");
    }
    if (!reading) {
      this.frameless += 1;
      if (this.frameless >= FRAMELESS_LIMIT) return this.fail("ended");
      return this.schedule();
    }
    this.frameless = 0;

    // Back off on slow machines; give up before the class itself suffers.
    this.readings += 1;
    this.costEma = this.readings === 1 ? cost : this.costEma * 0.8 + cost * 0.2;
    this.slowStreak = cost > SLOW_READING_MS ? this.slowStreak + 1 : 0;
    if (this.slowStreak >= 2 || (this.readings >= 10 && this.costEma > TOO_SLOW_MS)) {
      this.closeTracker();
      return this.fail("slow");
    }
    this.interval = Math.min(MAX_INTERVAL_MS, Math.max(BASE_INTERVAL_MS, Math.round(this.costEma * 8)));

    const { brightness } = reading;
    if (brightness < DARK_BELOW) this.darkSince ??= now;
    else this.darkSince = null;
    const dark = this.darkSince !== null && now - this.darkSince >= DARK_AFTER_MS;
    const sample = { ...reading.sample, dark: !reading.sample.face && dark };
    this.meter.addSample(now, sample, dt);

    let away = this.state.away;
    if (sample.face) {
      this.lastFaceAt = now;
      this.faceRun += 1;
      if (away && this.faceRun >= BACK_AFTER_SAMPLES) {
        away = false;
        if (this.awaySince !== null && now - this.awaySince >= RECALIBRATE_AFTER_MS) this.tracker.recalibrate();
        this.awaySince = null;
      }
    } else {
      this.faceRun = 0;
      if (!away && now - this.lastFaceAt > AWAY_AFTER_MS) {
        away = true;
        this.awaySince = now;
        this.meter.markAway();
      }
    }

    const patch: Partial<ViewState> = {
      live: this.meter.live(now),
      session: this.meter.session(),
      away,
      dark,
      calibrating: this.tracker.calibrating,
    };
    // Get out of the way of BBB's chat once the learner has seen it working.
    if (!this.userChoseLayout && !this.state.collapsed && this.onSince !== null && now - this.onSince >= AUTO_COLLAPSE_MS) {
      patch.collapsed = true;
    }
    this.set(patch);
    if (now - this.lastReportAt >= REPORT_EVERY_MS) this.report(false);
    this.schedule();
  }

  /**
   * Background-tab time, counted tick by tick (so a sleeping laptop adds nothing,
   * and time in another tab counts even if the learner never comes back). Watching
   * the class in the picture-in-picture window is neither away nor counted.
   */
  private tickHidden(now: number, gap: number) {
    if (watchingInPip()) return;
    this.meter.addHidden(now, Math.min(gap, HIDDEN_TICK_CAP_MS));
    if (this.hiddenAt !== null && !this.state.away && now - this.hiddenAt >= AWAY_AFTER_MS) {
      this.meter.markAway();
      this.awaySince = this.hiddenAt;
      this.set({ away: true });
    }
    if (now - this.lastReportAt >= REPORT_EVERY_MS) this.report(false, true);
  }

  private fail(problem: CameraProblem) {
    this.generation += 1;
    this.report(false);
    this.status(STATUS_FOR_PROBLEM[problem]);
    this.releaseCamera();
    this.set({
      phase: "problem",
      problem,
      slowLoad: false,
      askingPermission: false,
      away: false,
      dark: false,
      collapsed: false,
    });
  }

  private releaseCamera() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.stream?.getVideoTracks().forEach((t) => t.removeEventListener("ended", this.onTrackEnded));
    stopStream(this.stream);
    this.stream = null;
    this.video.srcObject = null;
  }

  private closeTracker() {
    this.tracker?.close();
    this.tracker = null;
  }

  private async refreshCameras() {
    const cams = await listCameras();
    const activeId = this.stream?.getVideoTracks()[0]?.getSettings().deviceId ?? this.state.cameraId;
    this.set({
      cameras: cams.map((c, i) => ({ id: c.deviceId, label: c.label || `Camera ${i + 1}` })),
      cameraId: activeId ?? null,
    });
  }

  // ── events ───────────────────────────────────────────────────────────────

  private onTrackEnded = guard("track-ended", () => {
    if (this.state.phase === "on") this.fail("ended");
  });

  private onDeviceChange = guard("devicechange", () => {
    if (this.stream) void this.refreshCameras().catch(() => undefined);
  });

  private onVisibility = guard("visibility", () => {
    if (this.state.phase !== "on") return;
    const now = Date.now();
    if (document.visibilityState === "hidden") {
      this.hiddenAt = now;
      // Possibly the last moment the browser lets us send anything — but not for
      // every quick switch to notes and back.
      if (now - this.lastReportAt >= HIDE_BEACON_GAP_MS) this.report(false, true);
      return;
    }
    // The background stretch since the last hidden tick (ticks counted the rest).
    if (this.hiddenAt !== null && !watchingInPip()) {
      this.meter.addHidden(now, Math.min(Math.max(0, now - this.lastTickAt), HIDDEN_TICK_CAP_MS));
    }
    this.hiddenAt = null;
    // Presence comes back with the next face on camera, not with the tab.
    this.lastTickAt = now;
    this.lastFaceAt = now;
    this.faceRun = 0;
    this.set({ session: this.meter.session(), live: this.meter.live(now) });
  });

  private onPageHide = guard("pagehide", () => this.report(true, true));

  // ── reporting ────────────────────────────────────────────────────────────

  private report(final: boolean, beacon = final) {
    if (this.disposed) return;
    const t = this.meter.totals;
    const s = this.meter.session();
    this.lastReportAt = Date.now();
    this.saveResume();
    if (s.score === null || t.trackedMs < MIN_REPORT_MS) return;
    const payload: ReportPayload = {
      token: this.token,
      avg: s.score,
      on_screen: s.onScreen,
      attention: s.attention,
      seconds: Math.round(t.trackedMs / 1000),
      away_count: t.awayCount,
      away_seconds: Math.round(t.awayMs / 1000),
      final,
    };
    sendReport(this.reportUrl, payload, beacon);
  }

  /** Tell the admin why there is no (current) score. Score reports set "measuring" server-side. */
  private status(status: ActivenessStatus) {
    if (this.disposed) return;
    sendStatus(this.reportUrl, this.token, status);
  }

  private loadResume(): unknown {
    const key = persistKey(this.token);
    if (!key) return undefined;
    try {
      const saved = JSON.parse(storage.get(key) ?? "null") as { at?: number; totals?: unknown } | null;
      if (!saved || typeof saved.at !== "number" || Date.now() - saved.at > RESUME_MAX_AGE_MS) return undefined;
      return saved.totals;
    } catch {
      return undefined;
    }
  }

  private saveResume() {
    const key = persistKey(this.token);
    if (key) storage.set(key, JSON.stringify({ at: Date.now(), totals: this.meter.totals }));
  }
}
