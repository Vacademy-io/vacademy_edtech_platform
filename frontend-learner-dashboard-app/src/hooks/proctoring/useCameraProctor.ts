import { useCallback, useEffect, useRef, useState } from "react";
import { createFaceCounter, type FaceCounter } from "@/lib/proctoring/face-detector";
import { CAMERA_CONSTRAINTS, captureJpeg, stopStream } from "@/lib/proctoring/capture";
import {
  ProctorEventQueue,
  takeCheckIn,
  uploadSnapshot,
} from "@/services/proctoring";
import type {
  CameraStatus,
  ProctorEvent,
  ProctorEventSeverity,
  ProctorEventType,
  ProctoringConfig,
} from "@/types/proctoring";

/** How often a frame is inspected. 2 fps is plenty for "is someone there". */
const DETECT_INTERVAL_MS = 1500;
/** No face for this long before it is a flag. Covers glancing down at the keyboard. */
const NO_FACE_FLAG_AFTER_MS = 6000;
/** A second face has to persist before it is a flag — people walk past. */
const MULTI_FACE_FLAG_AFTER_MS = 2500;
/** After a flag, the same condition is not re-flagged until it clears and lasts this long again. */
const REFLAG_COOLDOWN_MS = 30_000;

type Props = {
  enabled: boolean;
  config: ProctoringConfig;
  assessmentId: string;
  attemptId: string | null | undefined;
  userId: string | null | undefined;
  /** The attempt has hit the violation ceiling. Owner decides what "submit" means. */
  onCeilingReached: () => void;
};

/**
 * The BASIC tier at runtime: hold the camera, count faces on-device, upload a
 * small frame on a timer and on every flag, and keep the server's event log
 * current. Mounted for the life of the live page; unmount releases everything.
 *
 * Nothing here can stop an exam. Every failure path (no camera, no detector,
 * no network) degrades to "record less", never to "block the learner" — the
 * one exception is the ceiling, which is the admin's explicit choice.
 */
export function useCameraProctor({
  enabled,
  config,
  assessmentId,
  attemptId,
  userId,
  onCeilingReached,
}: Props) {
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [faces, setFaces] = useState<number | null>(null);
  const [flagCount, setFlagCount] = useState(0);
  const [detectorName, setDetectorName] = useState<string>("none");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const queueRef = useRef<ProctorEventQueue | null>(null);
  const counterRef = useRef<FaceCounter | null>(null);
  const localFlagsRef = useRef(0);
  const ceilingFiredRef = useRef(false);
  const onCeilingRef = useRef(onCeilingReached);
  onCeilingRef.current = onCeilingReached;
  // `emit` is created once; it must read the config that is current at the
  // time of the event, not the "off" placeholder the first render saw.
  const configRef = useRef(config);
  configRef.current = config;

  const active = enabled && !!attemptId && !!userId;

  const emit = useCallback(
    (
      type: ProctorEventType,
      severity: ProctorEventSeverity,
      meta?: ProctorEvent["meta"],
      evidenceFileId?: string | null
    ) => {
      const queue = queueRef.current;
      if (!queue) return;
      queue.push({
        event_type: type,
        severity,
        occurred_at: new Date().toISOString(),
        evidence_file_id: evidenceFileId ?? null,
        meta,
      });
      if (severity === "FLAG") {
        localFlagsRef.current += 1;
        setFlagCount((n) => Math.max(n, localFlagsRef.current));
        maybeCeiling(Math.max(localFlagsRef.current, queue.serverFlagCount));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const maybeCeiling = (count: number) => {
    const max = configRef.current.max_violations ?? 0;
    if (max <= 0 || ceilingFiredRef.current || count < max) return;
    ceilingFiredRef.current = true;
    queueRef.current?.push({
      event_type: "AUTO_SUBMITTED",
      severity: "INFO",
      occurred_at: new Date().toISOString(),
      meta: { flags: count, max },
    });
    onCeilingRef.current();
  };

  /** Snapshot the current frame and upload it. Returns the file id, or undefined. */
  const snapshot = useCallback(async (): Promise<string | undefined> => {
    const video = videoRef.current;
    if (!video || !attemptId || !userId) return undefined;
    const blob = await captureJpeg(video);
    if (!blob) return undefined;
    try {
      return await uploadSnapshot(blob, attemptId, userId);
    } catch (error) {
      console.warn("[proctoring] snapshot upload failed", error);
      return undefined;
    }
  }, [attemptId, userId]);

  // Event queue: one per attempt.
  useEffect(() => {
    if (!active) return;
    const queue = new ProctorEventQueue(attemptId, (serverCount) => {
      setFlagCount((n) => Math.max(n, serverCount));
      maybeCeiling(Math.max(serverCount, localFlagsRef.current));
    });
    queue.start();
    queueRef.current = queue;

    // The selfie taken on the instructions page, now that an attempt exists.
    const checkIn = takeCheckIn(assessmentId);
    if (checkIn) {
      // An unverified check-in is a WARN, not a FLAG: the detector, not the
      // learner, is the likelier culprit, so it is shown to the reviewer but
      // never counts toward the auto-submit ceiling.
      const severity = checkIn.unverified ? "WARN" : "INFO";
      const meta: ProctorEvent["meta"] = {
        detector: checkIn.detector,
        ...(checkIn.faces !== null ? { faces: checkIn.faces } : {}),
        ...(checkIn.unverified ? { unverified: true } : {}),
      };
      uploadSnapshot(checkIn.blob, attemptId, userId)
        .then((fileId) =>
          queue.push({
            event_type: "CHECK_IN",
            severity,
            occurred_at: new Date().toISOString(),
            evidence_file_id: fileId ?? null,
            meta,
          })
        )
        .catch(() => {
          queue.push({
            event_type: "CHECK_IN",
            severity,
            occurred_at: new Date().toISOString(),
            meta: { ...meta, upload: "failed" },
          });
        });
    }

    return () => {
      void queue.drain();
      queueRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, attemptId, userId, assessmentId]);

  // Camera + detector lifecycle.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const start = async () => {
      setStatus("starting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.muted = true;
          video.playsInline = true;
          await video.play().catch(() => {
            // Autoplay policies do not apply to muted camera streams, but be safe.
          });
        }
        setStatus("on");
        const track = stream.getVideoTracks()[0];
        if (track) {
          track.onended = () => {
            setStatus("lost");
            emit("CAMERA_LOST", "FLAG");
          };
        }
      } catch (error) {
        if (cancelled) return;
        setStatus("denied");
        emit("CAMERA_DENIED", "FLAG", {
          reason: error instanceof Error ? error.name : "unknown",
        });
        return;
      }

      const counter = await createFaceCounter(!!config.face_check);
      if (cancelled) {
        counter.close();
        return;
      }
      counterRef.current = counter;
      setDetectorName(counter.name);
    };

    void start();

    return () => {
      cancelled = true;
      counterRef.current?.close();
      counterRef.current = null;
      stopStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setStatus("idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, config.face_check]);

  // Detection loop with hysteresis.
  useEffect(() => {
    if (!active || status !== "on" || !config.face_check) return;
    let noFaceSince: number | null = null;
    let multiSince: number | null = null;
    let noFaceFlaggedAt = 0;
    let multiFlaggedAt = 0;
    let busy = false;

    const tick = async () => {
      const counter = counterRef.current;
      const video = videoRef.current;
      if (busy || !counter || !video || counter.name === "none") return;
      busy = true;
      try {
        const n = await counter.count(video);
        if (n === null) return;
        setFaces(n);
        const now = Date.now();

        if (n === 0) {
          noFaceSince ??= now;
          multiSince = null;
          if (
            now - noFaceSince >= NO_FACE_FLAG_AFTER_MS &&
            now - noFaceFlaggedAt >= REFLAG_COOLDOWN_MS
          ) {
            noFaceFlaggedAt = now;
            const fileId = await snapshot();
            emit(
              "NO_FACE",
              "FLAG",
              {
                seconds: Math.round((now - noFaceSince) / 1000),
                detector: counter.name,
                frame: `${video.videoWidth}x${video.videoHeight}`,
              },
              fileId
            );
          }
        } else if (n > 1) {
          multiSince ??= now;
          noFaceSince = null;
          if (
            now - multiSince >= MULTI_FACE_FLAG_AFTER_MS &&
            now - multiFlaggedAt >= REFLAG_COOLDOWN_MS
          ) {
            multiFlaggedAt = now;
            const fileId = await snapshot();
            emit(
              "MULTIPLE_FACES",
              "FLAG",
              { faces: n, detector: counter.name, frame: `${video.videoWidth}x${video.videoHeight}` },
              fileId
            );
          }
        } else {
          noFaceSince = null;
          multiSince = null;
        }
      } finally {
        busy = false;
      }
    };

    const interval = setInterval(() => {
      void tick();
    }, DETECT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [active, status, config.face_check, emit, snapshot]);

  // Routine snapshots.
  useEffect(() => {
    const seconds = config.snapshot_interval_sec ?? 0;
    if (!active || status !== "on" || seconds <= 0) return;
    let count = 0;
    const interval = setInterval(async () => {
      if (document.hidden) return; // The tab-switch event already covers this.
      const fileId = await snapshot();
      if (fileId) emit("SNAPSHOT", "INFO", { count: ++count }, fileId);
    }, seconds * 1000);
    return () => clearInterval(interval);
  }, [active, status, config.snapshot_interval_sec, emit, snapshot]);

  // Window-level signals. WARN, not FLAG: the navbar's own 3-strike tab rule
  // still applies, and double-counting one action toward two ceilings would be
  // unfair. They are logged so the reviewer sees them in the same timeline.
  useEffect(() => {
    if (!active) return;
    const onVisibility = () => {
      if (document.hidden) emit("TAB_SWITCH", "WARN");
    };
    const onFullscreen = () => {
      if (!document.fullscreenElement) emit("FULLSCREEN_EXIT", "WARN");
    };
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [active, emit]);

  const flush = useCallback(() => queueRef.current?.drain() ?? Promise.resolve(), []);

  return { status, faces, flagCount, detectorName, videoRef, flush } as const;
}
