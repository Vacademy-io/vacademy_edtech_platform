/**
 * What the Fun skin's quiz result shows, worked out from the numbers the result
 * screen already has (QuizReview's score card, pass mark and attempt count).
 * Nothing here scores anything: the score itself comes from the existing
 * scoring code, unchanged.
 */

export interface ResultScore {
  earned: number;
  totalMarks: number;
  correct: number;
  partial?: number;
  wrong: number;
  skipped: number;
}

/** passed / notPassed only when the quiz has a pass mark; otherwise a neutral headline. */
export type Verdict = "passed" | "notPassed" | "none";

/** The percent on the ring: round(earned / totalMarks * 100), 0 to 100. */
export function scorePercent(score: Pick<ResultScore, "earned" | "totalMarks"> | null | undefined): number {
  if (!score || !(score.totalMarks > 0) || !Number.isFinite(score.earned)) return 0;
  return Math.max(0, Math.min(100, Math.round((score.earned / score.totalMarks) * 100)));
}

export function verdictOf(passed: boolean | null | undefined, passPercentage: number | null | undefined): Verdict {
  if (passPercentage == null || passed == null) return "none";
  return passed ? "passed" : "notPassed";
}

export type TileKind = "correct" | "wrong" | "partial" | "skipped";

/** Correct and wrong always; partial and skipped only when there are any. */
export function resultTiles(score: ResultScore): { kind: TileKind; count: number }[] {
  const tiles: { kind: TileKind; count: number }[] = [
    { kind: "correct", count: score.correct },
    { kind: "wrong", count: score.wrong },
  ];
  if ((score.partial ?? 0) > 0) tiles.push({ kind: "partial", count: score.partial ?? 0 });
  if (score.skipped > 0) tiles.push({ kind: "skipped", count: score.skipped });
  return tiles;
}

/** Attempts left after this one, or null when attempts are unlimited. */
export function triesLeft(attemptNumber: number | null | undefined, maxAttempts: number | null | undefined): number | null {
  if (maxAttempts == null) return null;
  return Math.max(0, maxAttempts - Math.max(0, attemptNumber ?? 0));
}

export type ResultAction = "retry" | "next" | "back";

/**
 * The two buttons under the result. A not-passed result that can be tried again
 * makes Try again the filled button; otherwise the filled button moves the
 * learner on (the viewer's Next while it is open, else back to the course
 * page) and Try again, when there is one, is the outline button.
 */
export function resultActions({
  verdict,
  canRetry,
  hasNext,
}: {
  verdict: Verdict;
  canRetry: boolean;
  hasNext: boolean;
}): { primary: ResultAction; secondary: ResultAction | null } {
  const onward: ResultAction = hasNext ? "next" : "back";
  if (verdict === "notPassed" && canRetry) return { primary: "retry", secondary: onward };
  return { primary: onward, secondary: canRetry ? "retry" : null };
}

/** Up to two decimals, no trailing zeros: 3, 2.5, 0.33. Never negative. */
export function marksText(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(Math.max(0, value) * 100) / 100);
}

/* ── Ring geometry (viewBox 148 x 148, as on the boards) ────────────── */

export const RING_BOX = 148;
export const RING_CENTRE = 74;
export const RING_RADIUS = 62;
export const RING_STROKE = 14;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** stroke-dasharray for the coloured arc: its length, then the whole circle. */
export function ringDash(percent: number): string {
  const p = Math.max(0, Math.min(100, percent));
  return `${round1((RING_CIRCUMFERENCE * p) / 100)} ${round1(RING_CIRCUMFERENCE)}`;
}

/**
 * The pass-mark tick: a short line across the ring at the pass mark, measured
 * clockwise from the top, reaching 2 units past each edge of the stroke.
 */
export function passTick(passPercentage: number): { x1: number; y1: number; x2: number; y2: number } {
  const p = Math.max(0, Math.min(100, passPercentage));
  const angle = ((p / 100) * 360 - 90) * (Math.PI / 180);
  const inner = RING_RADIUS - RING_STROKE / 2 - 2;
  const outer = RING_RADIUS + RING_STROKE / 2 + 2;
  return {
    x1: round1(RING_CENTRE + inner * Math.cos(angle)),
    y1: round1(RING_CENTRE + inner * Math.sin(angle)),
    x2: round1(RING_CENTRE + outer * Math.cos(angle)),
    y2: round1(RING_CENTRE + outer * Math.sin(angle)),
  };
}

/** A name the platform fills in for an unnamed level (shown as "DEFAULT"): never shown. */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim().toLowerCase();
  return n === "" || n === "default";
}

/** "Physics · Lenses and mirrors", leaving out names that are missing or placeholders. */
export function joinPlace(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p) => !isPlaceholderName(p))
    .map((p) => (p as string).trim())
    .join(" · ");
}
