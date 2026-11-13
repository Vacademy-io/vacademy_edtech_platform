/**
 * Pure clock rules for the live test. The hooks in this folder own the
 * intervals and the store writes; every decision they make is a function here,
 * so it can be tested without timers or React.
 */
import { distribution_duration_types } from "@/types/assessment";
import { isUntimedPlayMode } from "@/lib/untimed-play-mode";

/** Every exam clock ticks once a second. */
export const CLOCK_TICK_MS = 1000;

/** Tab switches that end the attempt (non-MANUAL tests). */
export const TAB_SWITCH_AUTO_SUBMIT_LIMIT = 3;

/**
 * PRACTICE and SURVEY by exact match. The header clock and the per-question
 * clock have always compared the raw value; `isUntimedPlayMode` (which ignores
 * case) is used by the section clock, time-up and autosave. Kept apart so the
 * move to the engine changes no behaviour.
 */
export const isPracticeOrSurvey = (playMode: string | null | undefined) =>
  playMode === "PRACTICE" || playMode === "SURVEY";

export type CountdownTick =
  | { type: "tick"; timeLeft: number }
  | { type: "advance" }
  | { type: "none" };

/** Section clock: count down, or move on once the section is at 0. */
export function sectionTickAction(
  timer: { timeLeft: number } | undefined,
  canSwitchSection: boolean,
): CountdownTick {
  if (timer && timer.timeLeft > 0) {
    return { type: "tick", timeLeft: timer.timeLeft - CLOCK_TICK_MS };
  }
  // With free switching the learner picks the next section themselves.
  if (!canSwitchSection) return { type: "advance" };
  return { type: "none" };
}

/** Per-question clock: count down, or go to the next question at 0. */
export function questionTickAction(timeLeft: number | undefined): CountdownTick {
  const left = timeLeft || 0;
  if (left > 0) return { type: "tick", timeLeft: left - CLOCK_TICK_MS };
  return { type: "advance" };
}

export function isSectionClockActive(
  distribution: distribution_duration_types | undefined,
  playMode: string | null | undefined,
): boolean {
  if (distribution !== distribution_duration_types.SECTION) return false;
  // Practice tests and surveys have no clock, section-wise or otherwise.
  return !isUntimedPlayMode(playMode);
}

export function isQuestionClockActive(
  distribution: distribution_duration_types | undefined,
  playMode: string | null | undefined,
  hasQuestion: boolean,
): boolean {
  return (
    !isPracticeOrSurvey(playMode) &&
    hasQuestion &&
    distribution === distribution_duration_types.QUESTION
  );
}

/**
 * Whole-test seconds left from the server start time (the reconcile run when
 * the tab becomes visible again). Null when there is nothing to reconcile.
 */
export function remainingFromServerStart(
  totalDurationSeconds: number,
  startMs: number,
  nowMs: number,
): number | null {
  if (!totalDurationSeconds) return null;
  if (Number.isNaN(startMs)) return null;
  const elapsedSeconds = Math.floor((nowMs - startMs) / 1000);
  return Math.max(0, totalDurationSeconds - elapsedSeconds);
}

export interface TimeUpInput {
  hasAssessment: boolean;
  evaluationType: string;
  playMode: string;
  isSubmitted: boolean;
  entireTestTimer: number;
  alreadyAutoSubmitted: boolean;
}

/** True when the whole-test clock has run out and the attempt must be submitted. */
export function shouldAutoSubmitOnTimeUp(input: TimeUpInput): boolean {
  // Never auto-submit a test that has not loaded.
  if (!input.hasAssessment) return false;
  if (input.evaluationType === "MANUAL") return false;
  // The play mode arrives from storage a beat after the assessment; until it
  // is known, a timer at 0 cannot be told apart from "no clock at all".
  if (!input.playMode) return false;
  // A practice test or survey has no clock; its timer sits at 0 from the
  // start (no duration), which is not "time's up".
  if (isUntimedPlayMode(input.playMode)) return false;
  if (input.isSubmitted) return false;
  if (input.entireTestTimer > 0) return false;
  return !input.alreadyAutoSubmitted;
}

export interface ViolationInput {
  hasAssessment: boolean;
  evaluationType: string;
  tabSwitchCount: number;
  proctorAutoSubmitRequested: boolean;
}

/** True when tab switches or the proctoring ceiling end the attempt. */
export function shouldAutoSubmitOnViolation(input: ViolationInput): boolean {
  if (!input.hasAssessment) return false;
  if (input.evaluationType === "MANUAL") return false;
  return (
    input.tabSwitchCount >= TAB_SWITCH_AUTO_SUBMIT_LIMIT ||
    input.proctorAutoSubmitRequested
  );
}

/** Whether the periodic remote autosave should run now. */
export function shouldAutosave(input: {
  isSubmitted: boolean;
  entireTestTimer: number;
  playMode: string;
}): boolean {
  // Save while the attempt is open and the clock (if it has one) is still
  // running. Practice tests and surveys have no clock, so their timer is 0
  // from the start - skipping them here left those answers unsaved.
  return (
    !input.isSubmitted &&
    (input.entireTestTimer > 0 || isUntimedPlayMode(input.playMode))
  );
}

/** Header clock visibility. */
export function shouldShowEntireTimer(
  playMode: string,
  entireTestTimer: number,
): boolean {
  return !isPracticeOrSurvey(playMode) && entireTestTimer > 0;
}

export type TimerTone = "danger" | "warning" | "neutral";

/** Header clock tone: danger at 5 % left or less, warning at 15 % or less. */
export function entireTimerTone(
  entireTestTimer: number,
  durationMinutes: number | undefined,
): TimerTone {
  const totalSeconds = (durationMinutes || 0) * 60;
  const remainingFraction = totalSeconds ? entireTestTimer / totalSeconds : 1;
  if (remainingFraction <= 0.05) return "danger";
  if (remainingFraction <= 0.15) return "warning";
  return "neutral";
}

const pad2 = (num: number) => num.toString().padStart(2, "0");

/** Whole-test clock text, HH:MM:SS from seconds. */
export function formatHms(timeInSeconds: number): string {
  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  const seconds = timeInSeconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
}

/** Section clock text, MM:SS from milliseconds. */
export function formatSectionClock(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${pad2(minutes)}:${pad2(seconds)}`;
}
