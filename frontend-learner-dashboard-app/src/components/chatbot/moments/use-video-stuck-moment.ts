import { useCallback, useEffect, useRef, useState } from "react";

/** Two backward seeks landing within this many seconds of each other = the same spot. */
const SAME_SPOT_SECONDS = 20;
/** ...and within this long of each other. */
const REPEAT_WITHIN_MS = 4 * 60_000;
/** A drop smaller than this between time updates is jitter, not a seek. */
const MIN_BACK_SECONDS = 3;

/** Videos that already offered help this app session (once per video per session). */
const offeredThisSession = new Set<string>();

interface SeekMark {
  at: number;
  wall: number;
}

/**
 * Notices a learner rewinding to the same part of a video: two backward seeks
 * to roughly the same ~20 s window within a few minutes. Feed it the player's
 * time updates through `track` (stable, safe to bake into JSX built once);
 * players that report no time make it a no-op. `stuckAt` is the spot in
 * seconds, set at most once per video per session.
 */
export function useVideoStuckMoment(videoKey: string | null | undefined, enabled: boolean) {
  const [stuckAt, setStuckAt] = useState<number | null>(null);
  const keyRef = useRef<string | null>(videoKey ?? null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const lastTimeRef = useRef<number | null>(null);
  const seeksRef = useRef<SeekMark[]>([]);

  useEffect(() => {
    keyRef.current = videoKey ?? null;
    lastTimeRef.current = null;
    seeksRef.current = [];
    setStuckAt(null);
  }, [videoKey]);

  const track = useCallback((time?: number) => {
    if (typeof time !== "number" || !Number.isFinite(time)) return;
    const prev = lastTimeRef.current;
    lastTimeRef.current = time;
    const key = keyRef.current;
    if (prev === null || !key || !enabledRef.current || offeredThisSession.has(key)) return;
    if (prev - time < MIN_BACK_SECONDS) return;

    const now = Date.now();
    const recent = seeksRef.current.filter((s) => now - s.wall <= REPEAT_WITHIN_MS);
    const earlier = recent.find((s) => Math.abs(s.at - time) <= SAME_SPOT_SECONDS);
    if (earlier) {
      offeredThisSession.add(key);
      seeksRef.current = [];
      setStuckAt(Math.min(earlier.at, time));
      return;
    }
    seeksRef.current = [...recent, { at: time, wall: now }];
  }, []);

  const dismiss = useCallback(() => setStuckAt(null), []);

  return { stuckAt, track, dismiss };
}
