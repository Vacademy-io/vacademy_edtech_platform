import type { TFunction } from "i18next";
import { getActiveLocale } from "@/lib/formatters";
import {
  estimateFlashcardMinutes,
  estimateReadMinutes,
  flashcardCount,
  type EngagementPreviewItem,
} from "./engagement-preview";
import { URGENT_MS } from "./engagement-visuals";

/**
 * Every learner-facing sentence about points, reveals and deadlines, built in
 * one place so the Today module, the runner and the `/engagement` page never
 * disagree (D11, D21, D22, D39, D47, D53).
 *
 * Every `t` passed in must be bound to the `dashboardEngagement` namespace
 * (`useTranslation("dashboardEngagement")`); keys below are relative to it.
 *
 * Server fields added by the Wave 2 contract (`earnablePoints`,
 * `effectivePoints`, `catchUpClosesAt`, …) are optional here: each helper falls
 * back to what today's server sends.
 */

/** The item fields these helpers read. Every EngagementItem satisfies this. */
export interface EngagementCopyItem extends EngagementPreviewItem {
  id?: string;
  state?: string | null;
  completionPoints?: number | null;
  correctPoints?: number | null;
  /** Points kept on a late completion; 100 while the task is open. */
  pointsPercent?: number | null;
  opensAt?: string | null;
  closesAt?: string | null;
  revealAt?: string | null;
  isRevealed?: boolean | null;
  hideResultUntilReveal?: boolean | null;
  attemptStatus?: string | null;
  isCorrect?: boolean | null;
  resultPending?: boolean | null;
  pointsAwarded?: number | null;
  isLate?: boolean | null;
  historyStatus?: string | null;

  // Wave 2 contract (optional; absent on today's server).
  /**
   * What finishing now can still earn (completion + any bonus that applies).
   * Read only for tasks paying 100 %; the struck-through "full" value is always
   * derived from `completionPoints` / `correctPoints`, so it is right whether
   * the server applies the catch-up percent to this field or not.
   */
  earnablePoints?: number | null;
  /** Bonus held back until the reveal settles. */
  pendingBonus?: number | null;
  /** GAME: whether a reported score can earn the bonus. */
  scoreBonusEnabled?: boolean | null;
  /**
   * Catch-up items: what finishing now earns after the catch-up percent
   * (completion + any applicable bonus, floored as the server pays it). Wins
   * over the client's own maths.
   */
  effectivePoints?: number | null;
  /** Catch-up items: when the catch-up window closes. */
  catchUpClosesAt?: string | null;
  /** COURSE_SLIDE: the slide is complete, so the points can be claimed. */
  claimable?: boolean | null;
}

/** What a submit (or a completed item) says about the outcome. */
export interface EngagementResultLike {
  isCorrect?: boolean | null;
  resultPending?: boolean | null;
  pointsAwarded?: number | null;
  isRevealed?: boolean | null;
  correctOptionId?: string | null;
  /** Wave 2: the answer was already out, so only completion points were paid. */
  answerAlreadyOut?: boolean | null;
  /** Wave 2: an idempotent re-submit of a finished task. */
  alreadyCompleted?: boolean | null;
}

export type EngagementAnswerFormat = "MCQ" | "TEXT" | "UPLOAD";
export type EngagementOutcome = "correct" | "wrong" | "pending" | "done";

/** Poll percentages are shown only from this many responses up (privacy + noise). */
export const POLL_MIN_RESPONSES = 5;

const SUBMITTABLE = new Set(["OPEN", "CATCH_UP"]);

// --- Small readers -------------------------------------------------------------

function num(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toMs(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** How a question of the day is answered; null for every other type. */
export function answerFormat(item: EngagementCopyItem): EngagementAnswerFormat | null {
  if (item.itemType !== "QUESTION_OF_DAY") return null;
  if (!item.payloadJson) return "MCQ";
  try {
    const format = (JSON.parse(item.payloadJson) as { format?: string } | null)?.format;
    return format === "TEXT" || format === "UPLOAD" ? format : "MCQ";
  } catch {
    return "MCQ";
  }
}

export function isCompleted(item: EngagementCopyItem): boolean {
  return item.attemptStatus === "COMPLETED";
}

/** OPEN or CATCH_UP: the learner can still submit. */
export function isSubmittable(item: EngagementCopyItem): boolean {
  return SUBMITTABLE.has(item.state ?? "OPEN");
}

/** Percent of the points this task pays now (catch-up and late rules), 0–100. */
export function pointsPercentOf(item: EngagementCopyItem): number {
  const pct = item.pointsPercent;
  if (typeof pct !== "number" || !Number.isFinite(pct)) return 100;
  return Math.min(100, Math.max(0, pct));
}

/** Points after a percent, floored exactly as the server pays them ("5 at 50 %" is 2). */
function scaled(points: number, percent: number): number {
  return Math.floor((points * percent) / 100);
}

/**
 * Whether a correct answer earns a bonus on top of completion. A multiple-choice
 * question of the day does; a game does only when the server says its score
 * counts. Polls, written answers, uploads, readings, lessons and flashcards pay
 * completion only.
 */
export function hasCorrectBonus(item: EngagementCopyItem): boolean {
  if (num(item.correctPoints) <= 0) return false;
  if (item.itemType === "GAME") return item.scoreBonusEnabled === true;
  return answerFormat(item) === "MCQ";
}

/** Full points on offer before any catch-up percent (completion + applicable bonus). */
export function maxPoints(item: EngagementCopyItem): number {
  return num(item.completionPoints) + (hasCorrectBonus(item) ? num(item.correctPoints) : 0);
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** The answer is already public while the task can still be done: bonus is off (D47). */
export function isAnswerAlreadyOut(item: EngagementCopyItem): boolean {
  return (
    hasCorrectBonus(item) &&
    item.itemType === "QUESTION_OF_DAY" &&
    item.isRevealed === true &&
    isSubmittable(item) &&
    !isCompleted(item)
  );
}

export interface PointsBreakdown {
  /** Completion points, after the percent. */
  now: number;
  /** Bonus if correct, after the percent; 0 when none applies. */
  bonus: number;
  /** What the learner can earn now: now + bonus. */
  total: number;
  /** The same before the catch-up percent, for a struck-through "5". */
  full: number;
  percent: number;
  /** The answer is already out, so the bonus is gone. */
  answerOut: boolean;
  /** A game whose score decides part of the points: "up to +N". */
  upTo: boolean;
}

export function pointsBreakdown(item: EngagementCopyItem): PointsBreakdown {
  const percent = pointsPercentOf(item);
  const answerOut = isAnswerAlreadyOut(item);
  const bonusApplies = hasCorrectBonus(item) && !answerOut;
  const now = scaled(num(item.completionPoints), percent);
  const bonus = bonusApplies ? scaled(num(item.correctPoints), percent) : 0;
  const full = answerOut ? num(item.completionPoints) : maxPoints(item);
  let total = now + bonus;
  if (finite(item.earnablePoints)) {
    // The server's own total: completion plus any bonus still payable, after the
    // catch-up percent. effectivePoints is the completion part only, so preferring it
    // dropped the answer bonus from every open question ("+10" for a 10 + 20 task).
    total = Math.max(0, item.earnablePoints);
  } else if (finite(item.effectivePoints) && !bonusApplies) {
    // Older servers: the completion part is the whole of it when no bonus applies.
    total = Math.max(0, item.effectivePoints);
  }
  return {
    now,
    bonus,
    total,
    full,
    percent,
    answerOut,
    upTo: item.itemType === "GAME" && bonusApplies,
  };
}

/** Points the learner can earn now (catch-up percent applied). */
export function effectivePoints(item: EngagementCopyItem): number {
  return pointsBreakdown(item).total;
}

// --- Time -------------------------------------------------------------------------

function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/**
 * A clock time in the active UI locale: "8:00 PM" today, "Sat 8:00 PM" within
 * a week, "26 Sep, 8:00 PM" beyond. Empty string for a missing/invalid time.
 */
export function formatClock(iso?: string | null, now: number = Date.now()): string {
  const ms = toMs(iso);
  if (ms == null) return "";
  const locale = getActiveLocale();
  try {
    if (sameLocalDay(ms, now)) {
      return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(ms);
    }
    const withinWeek = Math.abs(ms - now) < 6 * 24 * 60 * 60 * 1000;
    return new Intl.DateTimeFormat(
      locale,
      withinWeek
        ? { weekday: "short", hour: "numeric", minute: "2-digit" }
        : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }
    ).format(ms);
  } catch {
    return "";
  }
}

/** Compact duration: "2d", "6h", "45m" (never negative; "0m" when due). */
export function durationShort(ms: number, t: TFunction): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes >= 24 * 60) return t("duration.days", { count: Math.floor(minutes / (24 * 60)) });
  if (minutes >= 60) return t("duration.hours", { count: Math.floor(minutes / 60) });
  return t("duration.minutes", { count: minutes });
}

/**
 * The deadline every open task shares, or null (D53). The header shows it once;
 * rows then show their own deadline only when it differs or is under 2 h.
 */
export function sharedDeadline(items: EngagementCopyItem[]): string | null {
  const open = items.filter((i) => (i.state ?? "OPEN") === "OPEN" && !isCompleted(i));
  if (open.length === 0) return null;
  const first = toMs(open[0]!.closesAt);
  if (first == null) return null;
  for (const item of open) {
    if (toMs(item.closesAt) !== first) return null;
  }
  return open[0]!.closesAt ?? null;
}

/** Whether a row should print its own deadline, given the shared one. */
export function showsOwnDeadline(
  item: EngagementCopyItem,
  shared: string | null,
  now: number = Date.now()
): boolean {
  // A catch-up row's own `closesAt` is yesterday's; only its catch-up window
  // counts, and with no `catchUpClosesAt` the countdown is hidden.
  const end = toMs(item.state === "CATCH_UP" ? item.catchUpClosesAt : item.closesAt);
  if (end == null) return false;
  if (end - now > 0 && end - now <= URGENT_MS) return true;
  return shared == null || toMs(shared) !== end;
}

// --- Labels --------------------------------------------------------------------------

/**
 * Key under `dashboardEngagement` naming the task (D39). A question of the day
 * is named by its format: "Quick question", "Write it", "Show your work".
 */
export function typeLabelKey(item: EngagementCopyItem): string {
  const format = answerFormat(item);
  if (format) return `types.formats.${format}`;
  switch (item.itemType) {
    case "READING_HTML":
    case "VISUAL_NOTE":
    case "QUIZ":
    case "GAME":
    case "POLL":
    case "COURSE_SLIDE":
    case "FLASHCARDS":
      return `types.${item.itemType}`;
    default:
      return "types.fallback";
  }
}

export function typeLabel(item: EngagementCopyItem, t: TFunction): string {
  return t(typeLabelKey(item));
}

/** "3 min" for a reading, "12 cards · ~3 min" for a deck; null otherwise. */
export function durationLabel(item: EngagementCopyItem, t: TFunction): string | null {
  if (item.itemType === "FLASHCARDS") {
    const count = flashcardCount(item);
    if (count <= 0) return null;
    return t("preview.flashcards", { count, minutes: estimateFlashcardMinutes(count) });
  }
  const minutes = estimateReadMinutes(item);
  return minutes == null ? null : t("meta.minutes", { count: minutes });
}

/**
 * Caption meta for a compact row: "Read · 3 min · +10". Points are left out
 * when gamification is off.
 */
export function metaLine(
  item: EngagementCopyItem,
  t: TFunction,
  options: { showPoints?: boolean } = {}
): string {
  const parts = [typeLabel(item, t)];
  const duration = durationLabel(item, t);
  if (duration) parts.push(duration);
  if (options.showPoints !== false) {
    const total = effectivePoints(item);
    if (total > 0) parts.push(t("points.plain", { count: total }));
  }
  return parts.join(" · ");
}

// --- Points copy -------------------------------------------------------------------------

/**
 * The reward line for a task not yet done (D22, D47):
 * - "+10 now · +20 if correct · answer 8:00 PM"
 * - "+10 now · +20 if correct"
 * - "up to +30" (a game whose score counts)
 * - "+2 · half points" (catch-up; the struck "5" is drawn by PointsChip)
 * - "+10 · answer already out, completion points only"
 * - "+10"
 * Empty when the task pays nothing.
 */
export function pointsLine(item: EngagementCopyItem, t: TFunction, now: number = Date.now()): string {
  const p = pointsBreakdown(item);
  if (p.answerOut) return t("points.answerOut", { count: p.now });
  if (p.total <= 0) return "";
  if (p.percent < 100) {
    return p.percent === 50
      ? t("points.catchUpHalf", { count: p.total })
      : t("points.catchUp", { count: p.total, percent: p.percent });
  }
  if (p.upTo) return t("points.upTo", { count: p.total });
  if (p.bonus > 0) {
    const revealMs = toMs(item.revealAt);
    if (item.hideResultUntilReveal && revealMs != null && revealMs > now) {
      return t("points.withBonusAt", {
        now: p.now,
        bonus: p.bonus,
        time: formatClock(item.revealAt, now),
      });
    }
    return t("points.withBonus", { now: p.now, bonus: p.bonus });
  }
  return t("points.plain", { count: p.total });
}

/**
 * What a finished task earned (D22):
 * - "+10 · +20 on its way": revealed correct, bonus not credited yet
 * - "+10 · bonus pending": result still hidden
 * - "+10"
 */
export function earnedLine(item: EngagementCopyItem, t: TFunction): string {
  const earned = num(item.pointsAwarded);
  const pending = num(item.pendingBonus);
  if (pending > 0 && item.isCorrect === true && item.resultPending !== true) {
    return t("earned.onItsWay", { count: earned, bonus: pending });
  }
  if (item.resultPending === true && hasCorrectBonus(item)) {
    return t("earned.bonusPending", { count: earned });
  }
  return t("earned.plain", { count: earned });
}

// --- Reveal copy ----------------------------------------------------------------------------

/**
 * One line about when the learner finds out (D11). `result` is the submit
 * response (or null before answering); a completed item counts as answered.
 * - graded multiple choice: "Answer at 8:00 PM"
 * - hidden result, before: "You'll find out at 8:00 PM · +20 if right"
 * - hidden result, after: "Locked in · result at 8:00 PM"
 * - poll: "Results at 8:00 PM"
 * - written / uploaded answer, after: "Sent to your teacher"
 * Null when there is nothing to say (no reveal ahead, or another type).
 */
export function revealCopy(
  item: EngagementCopyItem,
  result: EngagementResultLike | null,
  t: TFunction,
  now: number = Date.now()
): string | null {
  const answered = result != null || isCompleted(item);
  const format = answerFormat(item);
  if (format === "TEXT" || format === "UPLOAD") {
    return answered ? t("reveal.sentToTeacher") : null;
  }

  const revealMs = toMs(item.revealAt);
  const revealAhead = revealMs != null && revealMs > now && item.isRevealed !== true;
  const time = revealAhead ? formatClock(item.revealAt, now) : "";

  if (item.itemType === "POLL") {
    return revealAhead ? t("reveal.resultsAt", { time }) : null;
  }
  if (format !== "MCQ") return null;

  const hidden = item.hideResultUntilReveal === true || result?.resultPending === true;
  if (hidden) {
    if (answered) {
      if (revealAhead) return t("reveal.lockedIn", { time });
      // Revealed already: the result is out, there is nothing left to wait for.
      return item.isRevealed === true ? null : t("reveal.lockedInNoTime");
    }
    if (!revealAhead) return null;
    const bonus = pointsBreakdown(item).bonus;
    return bonus > 0
      ? t("reveal.findOutBonus", { time, count: bonus })
      : t("reveal.findOut", { time });
  }
  return revealAhead ? t("reveal.answerAt", { time }) : null;
}

// --- Catch-up ---------------------------------------------------------------------------------

/**
 * "From yesterday · half points · closes in 6h" (D21). The countdown is left
 * out when the server sends no `catchUpClosesAt`.
 */
export function catchUpLine(item: EngagementCopyItem, t: TFunction, now: number = Date.now()): string {
  const percent = pointsPercentOf(item);
  const closes = toMs(item.catchUpClosesAt);
  const left = closes != null && closes > now ? durationShort(closes - now, t) : null;
  if (percent >= 100) {
    return left ? t("catchUp.plainCloses", { left }) : t("catchUp.plain");
  }
  if (percent === 50) {
    return left ? t("catchUp.halfCloses", { left }) : t("catchUp.half");
  }
  return left
    ? t("catchUp.percentCloses", { percent, left })
    : t("catchUp.percent", { percent });
}

// --- Outcomes, states, polls --------------------------------------------------------------------

/** The outcome to draw for a submit response or a finished item. */
export function outcomeOf(result: EngagementResultLike): EngagementOutcome {
  if (result.resultPending === true) return "pending";
  if (result.isCorrect === true) return "correct";
  if (result.isCorrect === false) return "wrong";
  return "done";
}

export type EngagementStateKind =
  | "done"
  | "late"
  | "missed"
  | "catchUp"
  | "closed"
  | "pending"
  | "upcoming";

/** The state badge a row shows, or null for a plain open task. */
export function stateKindOf(item: EngagementCopyItem): EngagementStateKind | null {
  if (isCompleted(item) || item.historyStatus === "DONE") {
    if (item.resultPending === true) return "pending";
    return item.isLate ? "late" : "done";
  }
  if (item.historyStatus === "MISSED") return "missed";
  if (item.state === "CATCH_UP" || item.historyStatus === "CATCH_UP") return "catchUp";
  if (item.state === "CLOSED") return "closed";
  if (item.state === "UPCOMING") return "upcoming";
  return null;
}

/** One poll result row, as the server sends it (`percent` only when n ≥ 5). */
export interface EngagementPollResult {
  optionId: string;
  count?: number | null;
  percent?: number | null;
}

export interface EngagementPollShare {
  optionId: string;
  count: number | null;
  /** 0–100, or null while there are too few responses to show it. */
  percent: number | null;
}

/**
 * Per-option poll shares in option order. Percentages appear only from
 * `POLL_MIN_RESPONSES` responses up, matching the server rule.
 */
export function pollShares(
  optionIds: string[],
  results: EngagementPollResult[] | null | undefined,
  responseCount?: number | null
): EngagementPollShare[] {
  const byId = new Map((results ?? []).map((r) => [r.optionId, r]));
  const summed = (results ?? []).reduce((acc, r) => acc + num(r.count), 0);
  const total = typeof responseCount === "number" && responseCount > 0 ? responseCount : summed;
  const showPercent = total >= POLL_MIN_RESPONSES;
  return optionIds.map((optionId) => {
    const row = byId.get(optionId);
    const count = row && typeof row.count === "number" ? row.count : null;
    let percent: number | null = null;
    if (showPercent) {
      if (row && typeof row.percent === "number" && Number.isFinite(row.percent)) {
        percent = Math.round(row.percent);
      } else if (count != null && total > 0) {
        percent = Math.round((count / total) * 100);
      }
    }
    return { optionId, count, percent };
  });
}
