/**
 * Play-mode celebration moments (slide completion, streak milestones).
 *
 * One shared entry point so every surface celebrates the same way. Confetti
 * colors come from the canonical play palette. Respects prefers-reduced-motion
 * (no-op). Fire-and-forget; safe to call outside play mode (callers gate on
 * usePlayTheme, but a stray call only shows brand-colored confetti).
 */
import confetti from "canvas-confetti";

const PLAY_COLORS = ["#58CC02", "#1CB0F6", "#ffc800", "#CE82FF", "#FF9600"]; // design-lint-ignore: confetti color data (canonical play palette)

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The Corporate skin is a work-tool register (Linear / Stripe / Vercel); a
 * confetti burst on every completed task is the loudest consumer-app cue there
 * is. Checked here rather than at call sites because the engagement card and
 * dialog call these without a skin gate.
 */
function quiet(): boolean {
  return (
    reducedMotion() ||
    (typeof document !== "undefined" &&
      document.documentElement.classList.contains("ui-corporate"))
  );
}

/**
 * Quick burst for a single completion (slide done, badge unlocked). `colors`
 * overrides the play palette (e.g. the institute's brand shades).
 */
export function celebrateCompletion(colors?: string[]): void {
  if (quiet()) return;
  confetti({
    particleCount: 80,
    spread: 70,
    startVelocity: 35,
    origin: { y: 0.7 },
    colors: colors?.length ? colors : PLAY_COLORS,
    disableForReducedMotion: true,
  });
}

/** Bigger two-sided volley for milestones (chapter complete, streak 7/30…). */
export function celebrateMilestone(): void {
  if (quiet()) return;
  const opts = {
    particleCount: 60,
    spread: 55,
    startVelocity: 45,
    colors: PLAY_COLORS,
    disableForReducedMotion: true,
  };
  confetti({ ...opts, angle: 60, origin: { x: 0, y: 0.7 } });
  confetti({ ...opts, angle: 120, origin: { x: 1, y: 0.7 } });
}

/** Streak milestones worth a volley. */
export function isStreakMilestone(days: number): boolean {
  return days === 3 || days === 7 || days === 14 || days === 30 || (days > 0 && days % 50 === 0);
}

/**
 * Once-per-slide guard so a completion only celebrates the first time
 * (sessionStorage; per-tab is fine for a celebratory moment).
 */
export function shouldCelebrateSlide(slideId: string): boolean {
  if (!slideId) return false;
  const KEY = "vacademy.celebratedSlides.v1";
  try {
    const seen: string[] = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
    if (seen.includes(slideId)) return false;
    sessionStorage.setItem(KEY, JSON.stringify([...seen.slice(-99), slideId]));
    return true;
  } catch {
    return true;
  }
}

// ── Engagement tasks: skin- and outcome-gated ─────────────────────────

/** Which skin the call site is rendering (from usePlayTheme / useCleanerPlayTheme). */
export type CelebrationSkin = "play" | "cleanerPlay" | "other";
export type CelebrationKind = "correct" | "complete" | "milestone";

/** A small burst for Cleaner Play, which celebrates correct answers only. */
function celebrateSmall(): void {
  confetti({
    particleCount: 40,
    spread: 50,
    startVelocity: 28,
    origin: { y: 0.7 },
    colors: PLAY_COLORS,
    disableForReducedMotion: true,
  });
}

/**
 * The single celebration entry point for engagement tasks. A no-op outside the
 * play skins, and under reduced motion.
 * - play: a burst on `correct` / `complete`, the volley on `milestone`.
 * - cleanerPlay: a small burst on `correct` only.
 *
 * Decide `kind` with {@link celebrationKindFor}, which never celebrates a wrong
 * answer, a hidden result or a repeat submit.
 */
export function celebrate(kind: CelebrationKind, opts: { skin: CelebrationSkin }): void {
  if (opts.skin === "other" || quiet()) return;
  if (opts.skin === "cleanerPlay") {
    if (kind === "correct") celebrateSmall();
    return;
  }
  if (kind === "milestone") celebrateMilestone();
  else celebrateCompletion();
}

/**
 * Which celebration a submit result earns, or null for none (D23):
 * - `correct` when the answer was graded correct;
 * - `complete` for an ungraded completion that paid new points;
 * - null for a wrong answer, a result held until the reveal, a repeat submit, or 0 points.
 */
export function celebrationKindFor(r: {
  isCorrect?: boolean | null;
  resultPending?: boolean | null;
  alreadyCompleted?: boolean | null;
  pointsAwarded?: number | null;
}): Exclude<CelebrationKind, "milestone"> | null {
  if (r.alreadyCompleted === true || r.resultPending === true) return null;
  if (r.isCorrect === true) return "correct";
  if (r.isCorrect === false) return null;
  return (r.pointsAwarded ?? 0) > 0 ? "complete" : null;
}

/**
 * Once-per-day guard for a milestone (e.g. "all of today's tasks done"). Keyed by
 * scope and the device's calendar day; storage failures allow the celebration.
 */
export function claimDailyCelebration(scope: string, now: Date = new Date()): boolean {
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const key = `vacademy.dailyCelebration.v1:${scope}`;
  try {
    if (localStorage.getItem(key) === day) return false;
    localStorage.setItem(key, day);
    return true;
  } catch {
    return true;
  }
}
