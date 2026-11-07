import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Premium teacher avatar rendered on the device by Spatius AvatarKit
 * (docs.spatius.ai). The lesson hands each spoken segment's audio to the
 * avatar instead of the speaker; AvatarKit plays it in sync with the face.
 *
 * Loading is the whole experience here, so it is staged for the eye:
 *  - the SDK (3 MB + a 1 MB wasm core) is prefetched at the tap that opens
 *    the lesson, and with the app id its init too — on a first visit that
 *    init downloads a ~29 MB template (cached by the SDK afterwards);
 *  - SDK init runs while the session token is still in flight;
 *  - `progress` is the real asset download, `painted` the first frame —
 *    the card shows the teacher's photo until then and cross-fades.
 *
 * The face is drawn on the main thread 25 times a second (a ~70k-point
 * splat, CPU-sorted per frame), so it is sized to the device:
 *  - a browser drawing in software gets no face, a weaker device a lighter
 *    quality tier and the compressed model (`avatarTier`);
 *  - a face that still cannot keep its frame rate steps down a tier, and
 *    past the last one the lesson goes on with the speaker (`failed`, soft);
 *  - a load that stops moving falls back the same way instead of a bar
 *    frozen at one percentage.
 */
export interface AvatarBoot {
  provider: "spatius";
  app_id: string;
  avatar_id: string;
  /** The session token, or the request for it — init overlaps the wait. */
  session_token: string | Promise<string>;
}

/** What the device can carry: the face at full quality, a lighter face, or none. */
export type AvatarTier = "full" | "lite" | "none";
type Quality = "ultra" | "high" | "standard";
/** One rung of the quality ladder; `supersample` > 1 draws the face larger and lets the browser scale it down. */
interface Step {
  quality: Quality;
  supersample: number;
}
/** A device report for the lesson's summary (server: `avatar_diag`). */
export type AvatarDiag = Record<string, string | number>;

type AvatarKit = typeof import("@spatius/avatarkit");
type FrameRateInfo = import("@spatius/avatarkit").FrameRateInfo;
const TARGET_RATE = 16000;

/** No real progress for this long while loading: carry on with voice only. */
const LOAD_STALL_MS = 60000;
/** Grace after the first paint (the SDK benchmarks the device then) and after each step down. */
const WARMUP_MS = 5000;
const SETTLE_MS = 3000;
/** The face renders at 25 fps; below this for SLOW_FOR_MS it steps down a tier. */
const SLOW_FPS = 15;
const SLOW_FOR_MS = 4000;
/** No frame at all for this long while visible: the face is stuck. */
const FROZEN_MS = 3000;

const SLOW_DEVICE = "This device is too slow for the animated teacher, so the lesson continues with voice.";
const NO_GPU = "This browser has graphics acceleration turned off, so the lesson continues with voice.";
const SLOW_LOAD = "The animated teacher is taking too long to load, so the lesson continues with voice.";

let kitPromise: Promise<AvatarKit> | null = null;
/** Start downloading the SDK now (idempotent). Safe to call from any tap. */
export function preloadAvatarKit(): Promise<AvatarKit> {
  if (!kitPromise) {
    kitPromise = import("@spatius/avatarkit").catch((e) => {
      kitPromise = null; // a failed fetch is retried next time
      throw e;
    });
  }
  return kitPromise;
}

let gpuName = "";
let tierPromise: Promise<AvatarTier> | null = null;
/** Measure the device once per page. */
export function avatarTier(): Promise<AvatarTier> {
  if (!tierPromise) tierPromise = measureTier().catch(() => "lite" as const);
  return tierPromise;
}

async function measureTier(): Promise<AvatarTier> {
  // A browser drawing on the CPU (GPU blocklisted, hardware acceleration off,
  // remote desktop) refuses a context it would have to emulate.
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2", { failIfMajorPerformanceCaveat: true })
    ?? probe.getContext("webgl", { failIfMajorPerformanceCaveat: true });
  if (!gl) return "none";
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  gpuName = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? "");
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpuName)) return "none";
  // Without WebGPU the SDK renders through WebGL, which re-uploads the whole face every frame.
  let webgpu = false;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ info?: { isFallbackAdapter?: boolean } } | null> } }).gpu;
  if (gpu) {
    try {
      const adapter = await gpu.requestAdapter();
      webgpu = !!adapter && !adapter.info?.isFallbackAdapter;
    } catch {
      /* no WebGPU */
    }
  }
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return webgpu && cores > 4 && memory > 4 ? "full" : "lite";
}

/** Best first. A face card on a 1x–1.5x screen gets a quarter to half of a Retina screen's pixels. */
function ladder(tier: AvatarTier): Step[] {
  const dpr = window.devicePixelRatio || 1;
  const steps: Step[] = [];
  if (tier === "full") {
    if (dpr < 2) steps.push({ quality: "ultra", supersample: 2 / dpr });
    steps.push({ quality: "ultra", supersample: 1 });
  }
  steps.push({ quality: "high", supersample: 1 }, { quality: "standard", supersample: 1 });
  return steps;
}

let initFor: { appId: string; done: Promise<void> } | null = null;
let initStartedAt = 0;
function initSdk(kit: AvatarKit, appId: string, quality: Quality): Promise<void> {
  if (initFor?.appId === appId) return initFor.done;
  initStartedAt = performance.now();
  const done = kit.AvatarSDK.initialize(appId, {
    drivingServiceMode: kit.DrivingServiceMode.direct,
    // Ultra is the SDK's default and what Spatius Studio renders with; lower
    // tiers scale the splat pass down and single-photo avatars visibly soften.
    renderQuality: kit.RenderQuality[quality],
    audioFormat: { channelCount: 1, sampleRate: TARGET_RATE },
  });
  initFor = { appId, done };
  done.catch(() => {
    if (initFor?.done === done) initFor = null;
  });
  return done;
}

/**
 * Start the SDK and its first-visit template download now (idempotent) — at
 * the tap that opens a voice lesson, so the lesson page finds it done.
 */
export function warmAvatarSdk(appId: string): void {
  void avatarTier()
    .then(async (tier) => {
      if (tier === "none") return;
      const kit = await preloadAvatarKit();
      await initSdk(kit, appId, ladder(tier)[0]!.quality);
    })
    .catch(() => undefined);
}

/** Decode any browser-playable audio (mp3 / wav) to mono 16 kHz PCM16 for the motion server. */
export async function toPcm16(ctx: AudioContext, data: ArrayBuffer): Promise<ArrayBuffer> {
  const decoded = await ctx.decodeAudioData(data.slice(0));
  const frames = Math.ceil(decoded.duration * TARGET_RATE);
  const offline = new OfflineAudioContext(1, frames, TARGET_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const mono = (await offline.startRendering()).getChannelData(0);
  const out = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

/** Errors after which the avatar cannot continue this lesson; everything else is transient. */
const FATAL_CODES = new Set([
  "appIDUnrecognized", "avatarIDUnrecognized", "insufficientBalance", "sessionTokenInvalid", "sessionTokenExpired",
  "failedToDownloadAvatarAssets", "failedToFetchAvatarMetadata", "unsupportedAvatarAsset", "invalidAvatarMetadata",
  "concurrentLimitExceeded",
]);

/** `onDiag` receives device reports (on screen, stepped down, fell back) for the lesson's summary. */
export function useSpatiusAvatar(onDiag?: (d: AvatarDiag) => void) {
  /** The view exists (assets downloaded). Not yet visible: see `painted`. */
  const [ready, setReady] = useState(false);
  /** The SDK drew its first frame: the face is on screen. */
  const [painted, setPainted] = useState(false);
  /** Asset download, 0..1, while loading; null when unknown. */
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  /** `failed` is this device (too slow, no GPU, slow load), not an error: the lesson simply goes on with voice. */
  const [softFailed, setSoftFailed] = useState(false);
  /** Last non-fatal vendor error (websocket drop, playback hiccup); the avatar stays and reconnects. */
  const [warning, setWarning] = useState<string | null>(null);
  /** Audio unlocked and the motion session started: the avatar can actually speak. */
  const [activated, setActivated] = useState(false);
  /** Draw the face at this multiple of its card and let the browser scale it down (sharper on 1x screens). */
  const [supersample, setSupersample] = useState(1);
  const connectedRef = useRef(false);
  const bootRef = useRef<AvatarBoot | null>(null);
  const kitRef = useRef<AvatarKit | null>(null);
  const viewRef = useRef<InstanceType<AvatarKit["AvatarView"]> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const idleWaitersRef = useRef<Array<() => void>>([]);
  const playingRef = useRef(false);
  /** Bumped by dispose: a mount still awaiting a download stops when it resumes. */
  const genRef = useRef(0);
  const stallTimerRef = useRef<number | null>(null);
  const creepTimerRef = useRef<number | null>(null);
  const healthTimerRef = useRef<number | null>(null);
  const tierRef = useRef<AvatarTier>("full");
  const stepsRef = useRef<Step[]>([]);
  /** Rung of the ladder; kept across retries so a slow device does not start over at the top. */
  const stepRef = useRef(0);
  const shownRef = useRef(true);
  const healthRef = useRef({ fps: 25, lastFrameAt: 0, slowSince: 0, settleUntil: 0 });
  const onDiagRef = useRef(onDiag);
  onDiagRef.current = onDiag;

  const report = useCallback((event: string, extra: AvatarDiag = {}) => {
    const step = stepsRef.current[stepRef.current];
    const d: AvatarDiag = {
      event, tier: tierRef.current, gpu: gpuName.slice(0, 120), dpr: window.devicePixelRatio || 1,
      ...(step ? { quality: step.quality, supersample: Math.round(step.supersample * 100) / 100 } : {}),
      ...extra,
    };
    console.info("[tutor avatar]", d);
    onDiagRef.current?.(d);
  }, []);

  const stopTimers = () => {
    for (const r of [stallTimerRef, healthTimerRef]) {
      if (r.current !== null) window.clearTimeout(r.current);
      r.current = null;
    }
    if (creepTimerRef.current !== null) window.clearInterval(creepTimerRef.current);
    creepTimerRef.current = null;
  };

  const dispose = useCallback(() => {
    genRef.current++;
    stopTimers();
    try {
      viewRef.current?.dispose();
    } catch {
      /* already gone */
    }
    viewRef.current = null;
    connectedRef.current = false;
    // A segment waiting on the face's playback must not hang the lesson.
    const waiters = idleWaitersRef.current;
    idleWaitersRef.current = [];
    waiters.forEach((w) => w());
    playingRef.current = false;
    setReady(false);
    setPainted(false);
    setProgress(null);
    setActivated(false);
  }, []);

  /** This device cannot carry the face: free it and let the lesson go on with the speaker. */
  const fallBack = useCallback((message: string, reason: string) => {
    report("fallback", { reason });
    dispose();
    setFailed(message);
    setSoftFailed(true);
  }, [dispose, report]);

  const applyStep = (step: Step) => {
    const kit = kitRef.current;
    try {
      kit?.AvatarSDK.setRenderQuality(kit.RenderQuality[step.quality]);
    } catch {
      /* not initialized yet: init takes the tier's quality */
    }
    setSupersample(step.supersample);
  };

  /** Once a second while the face is on: step down when it cannot keep up, fall back past the last rung. */
  const checkHealth = useCallback(() => {
    healthTimerRef.current = window.setTimeout(checkHealth, 1000);
    const h = healthRef.current;
    const now = performance.now();
    if (document.hidden || !shownRef.current || now < h.settleUntil) {
      // Paused or just changed: judge only frames drawn from here on.
      h.slowSince = 0;
      h.lastFrameAt = Math.max(h.lastFrameAt, now);
      if (document.hidden || !shownRef.current) h.settleUntil = now + SETTLE_MS;
      return;
    }
    const frozen = now - h.lastFrameAt > FROZEN_MS;
    if (!frozen && h.fps >= SLOW_FPS) {
      h.slowSince = 0;
      return;
    }
    if (!h.slowSince) h.slowSince = now;
    if (now - h.slowSince < SLOW_FOR_MS) return;
    const next = stepRef.current + 1;
    if (!frozen && next < stepsRef.current.length) {
      report("step_down", { fps: Math.round(h.fps * 10) / 10 });
      stepRef.current = next;
      applyStep(stepsRef.current[next]!);
      h.slowSince = 0;
      h.settleUntil = now + SETTLE_MS;
      return;
    }
    // Nothing lighter left, or the face stopped drawing: between lines, so no sentence is cut.
    if (!playingRef.current) fallBack(SLOW_DEVICE, frozen ? "frozen" : "slow");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallBack, report]);

  /** Mount the avatar into `container` with the session from the server. Call once per lesson. */
  const mount = useCallback(async (boot: AvatarBoot, container: HTMLDivElement) => {
    const gen = ++genRef.current;
    const stale = () => gen !== genRef.current;
    const t0 = performance.now();
    containerRef.current = container;
    bootRef.current = boot;
    // Each real step re-arms the watchdog; a download that stops moving ends in voice only.
    const arm = () => {
      if (stallTimerRef.current !== null) window.clearTimeout(stallTimerRef.current);
      stallTimerRef.current = window.setTimeout(() => {
        if (!stale()) fallBack(SLOW_LOAD, "load_stalled");
      }, LOAD_STALL_MS);
    };
    try {
      // Staged progress: AvatarKit's load callback reports no fraction, so the
      // bar advances on the steps that really completed.
      setProgress(0.05);
      arm();
      const tier = await avatarTier();
      if (stale()) return;
      tierRef.current = tier;
      if (tier === "none") {
        fallBack(NO_GPU, "software_rendering");
        return;
      }
      stepsRef.current = ladder(tier);
      stepRef.current = Math.min(stepRef.current, stepsRef.current.length - 1);
      const step = stepsRef.current[stepRef.current]!;
      setSupersample(step.supersample);
      setProgress(0.1);
      const kit = kitRef.current ?? (await preloadAvatarKit());
      if (stale()) return;
      setProgress(0.25);
      kitRef.current = kit;
      // Init needs only the app id, so it overlaps the token round-trip. It
      // reports nothing while it fetches its template (first visit only), so
      // the bar creeps toward the next step rather than sitting still.
      creepTimerRef.current = window.setInterval(() => setProgress((p) => (p === null ? p : p + (0.39 - p) * 0.04)), 500);
      await initSdk(kit, boot.app_id, step.quality);
      const token = await boot.session_token;
      if (creepTimerRef.current !== null) window.clearInterval(creepTimerRef.current);
      creepTimerRef.current = null;
      if (stale()) return;
      const initMs = performance.now() - Math.max(t0, initStartedAt);
      kit.AvatarSDK.setSessionToken(token);
      applyStep(step);
      setProgress(0.4);
      arm();
      const loadStart = performance.now();
      const avatar = await kit.AvatarManager.shared.load(boot.avatar_id, (info) => {
        if (typeof info.progress === "number") {
          arm();
          setProgress(0.4 + 0.45 * Math.max(0, Math.min(1, info.progress)));
        }
      }, tier === "lite"); // the compressed model: ~30% of the download
      if (stale()) return;
      const loadMs = performance.now() - loadStart;
      arm();
      setProgress(0.9);
      const view = new kit.AvatarView(avatar, container);
      view.onFirstRendering = () => {
        if (stale()) return;
        if (stallTimerRef.current !== null) window.clearTimeout(stallTimerRef.current);
        stallTimerRef.current = null;
        setProgress(1);
        setPainted(true);
        const now = performance.now();
        healthRef.current = { fps: 25, lastFrameAt: now, slowSince: 0, settleUntil: now + WARMUP_MS };
        if (healthTimerRef.current === null) healthTimerRef.current = window.setTimeout(checkHealth, 1000);
        const backend = (view as unknown as { renderSystem?: { backend?: string } }).renderSystem?.backend ?? "";
        report("on_screen", { backend, init_ms: Math.round(initMs), load_ms: Math.round(loadMs), paint_ms: Math.round(now - t0) });
      };
      const c = view.controller;
      c.frameRateMonitorEnabled = true;
      c.onFrameRateInfo = (info: FrameRateInfo) => {
        healthRef.current.fps = info.fps;
        healthRef.current.lastFrameAt = performance.now();
      };
      c.onConversationState = (state) => {
        if (state === "playing") playingRef.current = true;
        if (state === "idle" && playingRef.current) {
          playingRef.current = false;
          const waiters = idleWaitersRef.current;
          idleWaitersRef.current = [];
          waiters.forEach((w) => w());
        }
      };
      c.onError = (err) => {
        const code = String((err as { code?: string })?.code ?? "");
        const message = err instanceof Error ? err.message : "avatar error";
        console.warn("[tutor avatar]", code || "error", message);
        if (FATAL_CODES.has(code)) {
          setFailed(code ? `${message} (${code})` : message);
          return;
        }
        // Connection-level errors end the motion session; the next segment reconnects.
        if (code.startsWith("websocket") || code === "sessionTimeout" || code === "networkLayerNotAvailable" || code === "serverError") {
          connectedRef.current = false;
        }
        setWarning(code || message);
      };
      viewRef.current = view;
      if (!shownRef.current) view.pauseRendering();
      connectedRef.current = false;
      setReady(true);
      setFailed(null);
      setSoftFailed(false);
      setWarning(null);
    } catch (e: unknown) {
      if (stale()) return;
      stopTimers();
      setFailed(e instanceof Error ? e.message : "The teacher avatar could not start");
      setReady(false);
      setProgress(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fallBack, report, checkHealth]);

  /** The learner hid or showed the face: a hidden face stops drawing (its audio is routed to the speaker by the page). */
  const setShown = useCallback((shown: boolean) => {
    shownRef.current = shown;
    const view = viewRef.current;
    if (!view) return;
    try {
      if (shown) view.resumeRendering();
      else view.pauseRendering();
    } catch {
      /* disposed */
    }
  }, []);

  /**
   * Unlock audio and connect to the motion server. Works outside a tap when
   * the document already has user activation (the tap that opened the
   * lesson); returns false when the browser insists on a gesture first.
   */
  const activate = useCallback(async (): Promise<boolean> => {
    const view = viewRef.current;
    if (!view) return false;
    try {
      const c = view.controller;
      await (view.initializeAudioContext?.() ?? c.initializeAudioContext?.());
      await (view.start?.() ?? c.start?.());
      connectedRef.current = true;
      setActivated(true);
      setWarning(null);
      return true;
    } catch (e: unknown) {
      const code = String((e as { code?: string })?.code ?? "");
      console.warn("[tutor avatar] connect failed", code, e);
      if (FATAL_CODES.has(code)) setFailed(e instanceof Error ? e.message : "The teacher avatar could not connect");
      else if (code !== "audioContextNotInitialized") setWarning(code || (e instanceof Error ? e.message : "connect failed"));
      return false;
    }
  }, []);

  /** Reconnect the motion session (after a drop or an idle timeout). */
  const reconnect = useCallback(async () => {
    const view = viewRef.current;
    if (!view || connectedRef.current) return;
    try {
      await (view.start?.() ?? view.controller.start?.());
      connectedRef.current = true;
      setWarning(null);
    } catch (e: unknown) {
      console.warn("[tutor avatar] reconnect failed", e);
    }
  }, []);

  /** Speak one segment through the avatar; resolves when its playback ends. */
  const speak = useCallback(async (audio: ArrayBuffer) => {
    const view = viewRef.current;
    if (!view) return;
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    if (!connectedRef.current) await reconnect();
    const pcm = await toPcm16(ctxRef.current, audio);
    const done = new Promise<void>((resolve) => {
      idleWaitersRef.current.push(resolve);
      // Never hang the lesson on a missing state event.
      window.setTimeout(resolve, Math.max(2000, (pcm.byteLength / (TARGET_RATE * 2)) * 1000 + 1500));
    });
    view.controller.send(pcm, true);
    await done;
  }, [reconnect]);

  const interrupt = useCallback(() => {
    try {
      viewRef.current?.controller.interrupt();
    } catch {
      /* not connected */
    }
    const waiters = idleWaitersRef.current;
    idleWaitersRef.current = [];
    waiters.forEach((w) => w());
    playingRef.current = false;
  }, []);

  /** Start over with a fresh session (after a fatal error or a fallback). */
  const retry = useCallback(async (boot: AvatarBoot) => {
    const container = containerRef.current;
    if (!container) return;
    dispose();
    setFailed(null);
    setSoftFailed(false);
    await mount(boot, container);
    await activate();
  }, [dispose, mount, activate]);

  useEffect(() => () => dispose(), [dispose]);

  return {
    ready, painted, progress, failed, softFailed, warning, activated, supersample,
    mount, activate, speak, interrupt, dispose, retry, setShown,
  };
}
