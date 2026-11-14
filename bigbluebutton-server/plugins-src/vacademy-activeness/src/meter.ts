/**
 * The live-class activeness score: pure bookkeeping, no camera or DOM here, so
 * it can be unit-tested and the same numbers feed the learner's panel and the
 * session summary sent to the backend.
 *
 * Two parts, each 0–100:
 *  - onScreen:  share of tracked time with the learner in front of the camera
 *  - attention: share of tracked time facing the screen with eyes open
 *
 * Time the BBB tab spends in the background counts as neither (the learner is
 * not on the class). Time with the camera paused is not tracked at all, so it
 * neither raises nor lowers the score — the admin sees tracked seconds next to
 * the class length.
 *
 * "Right now" = the last LIVE_WINDOW_MS, short enough that it recovers within
 * seconds of the learner looking back. "This class" = everything tracked.
 * Every second that was not attentive carries a Reason, so the panel can tell
 * the learner exactly why the score dropped.
 */

export const LIVE_WINDOW_MS = 15_000;
export const WEIGHTS = { onScreen: 0.5, attention: 0.5 } as const;

/** Which way the head was turned when it did not face the screen. */
export type Turn = "side" | "down" | "up";

/** Why a stretch of time did not count as attentive. */
export type Reason = "away" | "dark" | "side" | "down" | "up" | "eyes" | "hidden";

export interface Sample {
  face: boolean;
  facing: boolean;
  eyesOpen: boolean;
  turn?: Turn | null;
  /** No face AND a near-black frame: the lens is covered or the room is dark. */
  dark?: boolean;
}

/** Session totals, all in milliseconds of tracked time. Persisted so a rejoin resumes. */
export interface Totals {
  trackedMs: number;
  faceMs: number;
  attentiveMs: number;
  awayCount: number;
  awayMs: number;
}

export interface Score {
  score: number | null;
  onScreen: number | null;
  attention: number | null;
}

export interface LiveScore extends Score {
  /** What is holding the score down right now (latest reading first, else the biggest loss in the window). */
  reason: Reason | null;
  /** The latest reading itself was not attentive. */
  reasonIsCurrent: boolean;
}

interface Tick {
  at: number;
  ms: number;
  face: boolean;
  attentive: boolean;
  reason: Reason | null;
}

export const emptyTotals = (): Totals => ({ trackedMs: 0, faceMs: 0, attentiveMs: 0, awayCount: 0, awayMs: 0 });

const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((100 * n) / d) : null);

export const combine = (onScreen: number | null, attention: number | null): number | null => {
  if (onScreen === null || attention === null) return null;
  return Math.round(onScreen * WEIGHTS.onScreen + attention * WEIGHTS.attention);
};

export const reasonOf = (s: Sample): Reason | null => {
  if (!s.face) return s.dark ? "dark" : "away";
  if (!s.facing) return s.turn ?? "side";
  if (!s.eyesOpen) return "eyes";
  return null;
};

const isTotals = (v: unknown): v is Totals => {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return ["trackedMs", "faceMs", "attentiveMs", "awayCount", "awayMs"].every(
    (k) => typeof t[k] === "number" && Number.isFinite(t[k] as number) && (t[k] as number) >= 0
  );
};

export class ActivenessMeter {
  readonly totals: Totals;
  private ticks: Tick[] = [];

  constructor(resume?: unknown) {
    this.totals = isTotals(resume) ? { ...resume } : emptyTotals();
  }

  /** One camera reading covering `ms` of class time. */
  addSample(at: number, s: Sample, ms: number) {
    const reason = reasonOf(s);
    this.push({ at, ms, face: s.face, attentive: reason === null, reason });
    if (s.face) this.totals.faceMs += ms;
    else this.totals.awayMs += ms;
    if (reason === null) this.totals.attentiveMs += ms;
  }

  /** Background-tab time: tracked, but neither on screen nor attentive. */
  addHidden(at: number, ms: number) {
    if (ms <= 0) return;
    this.push({ at, ms, face: false, attentive: false, reason: "hidden" });
    this.totals.awayMs += ms;
  }

  /** The learner just stepped away (no face for a while, or left the tab). */
  markAway() {
    this.totals.awayCount += 1;
  }

  /** Start the "right now" window afresh (after a recalibration, so old readings stop counting). */
  resetLive() {
    this.ticks = [];
  }

  private push(t: Tick) {
    this.totals.trackedMs += t.ms;
    this.ticks.push(t);
    this.trim(t.at);
  }

  private trim(at: number) {
    const cut = at - LIVE_WINDOW_MS;
    while (this.ticks.length && this.ticks[0]!.at < cut) this.ticks.shift();
  }

  live(at: number): LiveScore {
    this.trim(at);
    let ms = 0;
    let face = 0;
    let attentive = 0;
    const lost = new Map<Reason, number>();
    for (const t of this.ticks) {
      ms += t.ms;
      if (t.face) face += t.ms;
      if (t.attentive) attentive += t.ms;
      if (t.reason) lost.set(t.reason, (lost.get(t.reason) ?? 0) + t.ms);
    }
    const onScreen = pct(face, ms);
    const attention = pct(attentive, ms);
    const latest = this.ticks[this.ticks.length - 1]?.reason ?? null;
    let biggest: Reason | null = null;
    lost.forEach((v, k) => {
      if (biggest === null || v > (lost.get(biggest) ?? 0)) biggest = k;
    });
    return {
      score: combine(onScreen, attention),
      onScreen,
      attention,
      reason: latest ?? biggest,
      reasonIsCurrent: latest !== null,
    };
  }

  session(): Score {
    const { trackedMs, faceMs, attentiveMs } = this.totals;
    const onScreen = pct(faceMs, trackedMs);
    const attention = pct(attentiveMs, trackedMs);
    return { score: combine(onScreen, attention), onScreen, attention };
  }
}
