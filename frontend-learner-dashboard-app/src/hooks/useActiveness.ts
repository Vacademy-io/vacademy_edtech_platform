import { useCallback, useEffect, useRef, useState } from "react";
import { CAMERA_CONSTRAINTS, stopStream } from "@/lib/proctoring/capture";
import { createAttentionTracker, type AttentionTracker } from "@/lib/tutor/attention-tracker";
import { ActivenessMeter, type ActivenessParts } from "@/lib/tutor/activeness";

/**
 * The tutor's opt-in activeness score. Camera frames are read on the device
 * (MediaPipe) and never leave it; the socket only hears "stepped away" /
 * "back" and, once a minute, the session average.
 *
 * `status`:
 *  - "ask":         camera available, the learner has not chosen yet
 *  - "starting":    permission / model loading
 *  - "on":          tracking; a score is shown
 *  - "off":         the learner said no or turned it off (no score anywhere)
 *  - "unavailable": no camera, not a laptop/desktop, or the model could not load
 */
export type ActivenessStatus = "ask" | "starting" | "on" | "off" | "unavailable";

const SAMPLE_MS = 700;
/** No face this long (tab visible) = stepped away; the teacher pauses. */
const AWAY_AFTER_MS = 8000;
/** Face seen on this many consecutive samples = back. */
const BACK_AFTER_SAMPLES = 2;
const REPORT_EVERY_MS = 60_000;
const CHOICE_KEY = "tutor.activeness.choice";
/** Background-tab time fed in as no-face samples is capped so one long break does not erase a session. */
const MAX_HIDDEN_SAMPLES = 400;

const readChoice = (): "on" | "off" | null => {
  try {
    const v = window.localStorage.getItem(CHOICE_KEY);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null;
  }
};
const writeChoice = (v: "on" | "off") => {
  try {
    window.localStorage.setItem(CHOICE_KEY, v);
  } catch {
    // Private mode: the choice lasts for this lesson only.
  }
};

/** Laptop / desktop with a pointer and a camera API (phones come later). */
const isDesktop = () =>
  typeof navigator !== "undefined" &&
  !!navigator.mediaDevices?.getUserMedia &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: fine) and (min-width: 1024px)").matches;

const hasCamera = async () => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some((d) => d.kind === "videoinput");
  } catch {
    return false;
  }
};

export interface ActivenessReport {
  avg: number;
  parts: { attention: number | null; listening: number | null; answering: number | null };
  seconds: number;
  away_count: number;
  away_seconds: number;
  final?: boolean;
}

type Props = {
  /** The lesson is running (socket up, teacher begun). Tracking and reports only then. */
  active: boolean;
  /** The teacher is speaking right now (listening part). */
  speaking: boolean;
  /** A question is waiting for the learner's answer. */
  questionOpen: boolean;
  onPresence: (present: boolean) => void;
  onReport: (report: ActivenessReport) => void;
};

export function useActiveness({ active, speaking, questionOpen, onPresence, onReport }: Props) {
  const [status, setStatus] = useState<ActivenessStatus>("unavailable");
  const [score, setScore] = useState<number | null>(null);
  const [parts, setParts] = useState<ActivenessParts>({ onScreen: null, listening: null, answering: null });
  const [away, setAway] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<AttentionTracker | null>(null);
  const meterRef = useRef(new ActivenessMeter());
  const speakingRef = useRef(speaking);
  speakingRef.current = speaking;
  const cbRef = useRef({ onPresence, onReport });
  cbRef.current = { onPresence, onReport };
  const awayRef = useRef(false);
  const lastFaceAtRef = useRef(0);
  const faceRunRef = useRef(0);
  const hiddenAtRef = useRef<number | null>(null);

  // Offer the camera only where it can work; a remembered "no" stays no.
  useEffect(() => {
    let cancelled = false;
    if (!isDesktop()) return;
    void hasCamera().then((ok) => {
      if (cancelled || !ok) return;
      const choice = readChoice();
      setStatus(choice === "off" ? "off" : choice === "on" ? "starting" : "ask");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const release = useCallback(() => {
    stopStream(streamRef.current);
    streamRef.current = null;
    trackerRef.current?.close();
    trackerRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const setPresence = useCallback((present: boolean) => {
    if (awayRef.current === !present) return;
    awayRef.current = !present;
    setAway(!present);
    if (!present) meterRef.current.awayCount += 1;
    cbRef.current.onPresence(present);
  }, []);

  const report = useCallback((final = false) => {
    const m = meterRef.current;
    const s = m.session(Date.now());
    if (s.score === null) return;
    cbRef.current.onReport({
      avg: s.score,
      parts: { attention: s.parts.onScreen, listening: s.parts.listening, answering: s.parts.answering },
      seconds: Math.round(m.trackedMs / 1000),
      away_count: m.awayCount,
      away_seconds: Math.round(m.awayMs / 1000),
      ...(final ? { final: true } : {}),
    });
  }, []);

  // Start the camera + model when the learner says yes (or said yes before).
  useEffect(() => {
    if (status !== "starting") return;
    let cancelled = false;
    (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
      } catch {
        // Denied in the browser prompt: treat as "no", do not ask again.
        if (!cancelled) {
          writeChoice("off");
          setStatus("off");
        }
        return;
      }
      if (cancelled) {
        stopStream(stream);
        return;
      }
      streamRef.current = stream;
      const el = videoRef.current;
      if (el) {
        el.srcObject = stream;
        void el.play().catch(() => undefined);
      }
      const tracker = await createAttentionTracker();
      if (cancelled) {
        tracker?.close();
        return;
      }
      if (!tracker) {
        release();
        setStatus("unavailable");
        return;
      }
      trackerRef.current = tracker;
      lastFaceAtRef.current = Date.now();
      setStatus("on");
    })();
    return () => {
      cancelled = true;
    };
  }, [status, release]);

  // The preview <video> mounts after status flips to "on"; attach the stream then.
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      void el.play().catch(() => undefined);
    }
  }, []);

  // Sampling loop.
  useEffect(() => {
    if (status !== "on" || !active) return;
    let last = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      const dt = Math.min(5000, now - last);
      last = now;
      if (document.visibilityState === "hidden") return;
      const video = videoRef.current;
      const tracker = trackerRef.current;
      if (!video || !tracker) return;
      const s = tracker.sample(video);
      if (!s) return;
      const meter = meterRef.current;
      meter.addSample(now, s, speakingRef.current, dt);
      if (s.face) {
        lastFaceAtRef.current = now;
        faceRunRef.current += 1;
        if (awayRef.current && faceRunRef.current >= BACK_AFTER_SAMPLES) setPresence(true);
      } else {
        faceRunRef.current = 0;
        if (!awayRef.current && now - lastFaceAtRef.current > AWAY_AFTER_MS) setPresence(false);
      }
      const live = meter.live(now);
      setScore(live.score);
      setParts(live.parts);
    }, SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [status, active, setPresence]);

  // A background tab is away: pause at once, and count the time as off-screen on return.
  useEffect(() => {
    if (status !== "on" || !active) return;
    const onVisibility = () => {
      const now = Date.now();
      if (document.visibilityState === "hidden") {
        hiddenAtRef.current = now;
        setPresence(false);
        return;
      }
      const since = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (since !== null) {
        const n = Math.min(MAX_HIDDEN_SAMPLES, Math.floor((now - since) / SAMPLE_MS));
        const meter = meterRef.current;
        for (let i = 0; i < n; i += 1) {
          meter.addSample(since + i * SAMPLE_MS, { face: false, facing: false, eyesOpen: false }, false, SAMPLE_MS);
        }
      }
      // Presence returns with the next face on camera, not with the tab.
      lastFaceAtRef.current = now;
      faceRunRef.current = 0;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [status, active, setPresence]);

  // Question timing for the answering part.
  useEffect(() => {
    if (status !== "on" || !active) return;
    if (questionOpen) meterRef.current.questionOpened(Date.now());
    else meterRef.current.questionClosed(Date.now(), "answered");
  }, [questionOpen, status, active]);

  // Session average to the server once a minute, and once more on the way out.
  useEffect(() => {
    if (status !== "on" || !active) return;
    const id = window.setInterval(() => report(), REPORT_EVERY_MS);
    return () => {
      window.clearInterval(id);
      report(true);
    };
  }, [status, active, report]);

  useEffect(() => release, [release]);

  const enable = useCallback(() => {
    writeChoice("on");
    setStatus("starting");
  }, []);

  const disable = useCallback(() => {
    writeChoice("off");
    if (awayRef.current) setPresence(true);
    release();
    setScore(null);
    setStatus("off");
  }, [release, setPresence]);

  return {
    status,
    score,
    parts,
    away,
    attachVideo,
    enable,
    disable,
    /** The learner skipped the open question (scores lower than a slow answer). */
    markSkipped: () => meterRef.current.questionClosed(Date.now(), "skipped"),
    /** The teacher nudged on the open question. */
    markNudged: () => meterRef.current.nudged(),
    /** Report now (before the socket ends the session). */
    flush: () => report(true),
  };
}
