import type { TFunction } from "i18next";
import { isAxiosError } from "axios";
import authenticatedAxiosInstance from "@/lib/auth/axiosInstance";
import { BASE_URL } from "@/constants/urls";
import { getInstituteId } from "@/constants/helper";
import { usePlayGamificationStore } from "@/stores/play-gamification-store";

/**
 * Daily engagement: the teacher-scheduled tasks a learner sees on their home page.
 * Backend: admin_core_service /engagement/learner/v1/**.
 *
 * Design doc: docs/engagement/DAILY_ENGAGEMENT_PLATFORM.md
 *
 * Contract rule: every field the server added after the first release is optional
 * here, and the normaliser below derives a fallback for it, so this client works
 * against both the old and the new server.
 */

const LEARNER_API = `${BASE_URL}/admin-core-service/engagement/learner/v1`;

export type EngagementItemType =
  | "READING_HTML"
  | "VISUAL_NOTE"
  | "QUESTION_OF_DAY"
  | "QUIZ"
  | "GAME"
  | "POLL"
  /** An existing slide from the course library. */
  | "COURSE_SLIDE"
  /** A deck of plain-text cards (payload schema "flashcards/v1"). */
  | "FLASHCARDS";

export type EngagementState = "UPCOMING" | "OPEN" | "CATCH_UP" | "CLOSED";

/** One option's share of the votes. Percentages arrive only once n >= 5. */
export interface EngagementPollResult {
  optionId: string;
  count?: number | null;
  percent?: number | null;
}

/** What the learner did on a completed flashcards task (server-built). */
export interface EngagementFlashcardsResult {
  /** The deck version the learner studied. */
  version: number;
  known: number;
  total: number;
  learningCardIds: string[];
}

export interface EngagementItem {
  id: string;
  slotId: string;
  planId: string;
  packageSessionId: string;
  packageSessionName?: string | null;
  itemType: EngagementItemType;
  title: string;
  version: number;
  sortOrder: number;
  isRequired: boolean;

  /** Absent on UPCOMING items — the server withholds locked content entirely. */
  contentHtml?: string | null;
  slideId?: string | null;
  questionId?: string | null;
  assessmentId?: string | null;
  /** Answer keys are stripped from this until the reveal time passes. */
  payloadJson?: string | null;

  completionPoints: number;
  correctPoints: number;
  maxScore?: number | null;

  state: EngagementState;
  runDate?: string | null;
  opensAt?: string | null;
  closesAt?: string | null;
  revealAt?: string | null;
  isRevealed?: boolean | null;
  /** Points kept on a late completion; 100 while the task is open. */
  pointsPercent?: number | null;
  /** The outcome is withheld until revealAt. */
  hideResultUntilReveal?: boolean | null;

  attemptStatus?: string | null;
  isCorrect?: boolean | null;
  /** True when isCorrect is withheld until revealAt (hide-result questions). */
  resultPending?: boolean | null;
  pointsAwarded?: number | null;

  completedCount?: number | null;

  /** Present only on revealed entries. */
  correctOptionId?: string | null;
  explanation?: string | null;
  selectedOptionId?: string | null;

  // History entries only.
  isLate?: boolean | null;
  completedAt?: string | null;
  historyStatus?: EngagementHistoryStatus | null;

  // ── Added by the learner contract (WP-2A). All optional. ──────────────
  /** What finishing now can still earn, after the late or catch-up percent. */
  earnablePoints?: number | null;
  /** Points held back until the reveal settles a hidden-result answer. */
  pendingBonus?: number | null;
  /** False when the score bonus can never be paid (e.g. unverified games). */
  scoreBonusEnabled?: boolean | null;
  /** COURSE_SLIDE whose slide is already complete: the row can offer "Claim". */
  claimable?: boolean | null;
  /** Plain-text glimpse of the content (160 chars); the feed omits the HTML. */
  excerpt?: string | null;
  /** Plain-text question prompt for rows that answer in place. */
  promptText?: string | null;
  pollResults?: EngagementPollResult[] | null;
  responseCount?: number | null;
  /** Catch-up rows: when the catch-up window closes. */
  catchUpClosesAt?: string | null;
  /** Catch-up rows: completion points after the catch-up percent. */
  effectivePoints?: number | null;
  /** Reading gate (D27): minimum dwell, measured by the server from the first open. */
  minReadMs?: number | null;
  minScrollPercent?: number | null;
  /** First open of this task (the STARTED row), when the server shares it. */
  startedAt?: string | null;
  /** FLASHCARDS only, when a COMPLETED attempt exists. */
  flashcardsResult?: EngagementFlashcardsResult | null;
  /** Answered after the reveal: completion points only (set from a submit result). */
  answerAlreadyOut?: boolean | null;
}

export type EngagementHistoryStatus = "DONE" | "MISSED" | "CATCH_UP";

/** Past occurrences, newest first. Today's open tasks are not here. */
export interface EngagementHistory {
  from: string;
  to: string;
  items: EngagementItem[];
  done: number;
  /** Closed and no longer doable. */
  missed: number;
  /** Missed but still inside the catch-up window. */
  catchUp: number;
  pointsEarned: number;
}

/**
 * The learner's "today" across every batch.
 *
 * Returned normalised by {@link fetchEngagementFeedOrThrow}: `items` holds today's
 * scheduled tasks only and `catchUp` holds yesterday's still-doable ones, whatever
 * the server version. The legacy {@link fetchEngagementFeed} keeps the old meaning
 * of `items` (catch-up rows mixed in) for the card that still reads it.
 */
export interface EngagementFeed {
  /** Openable right now, already capped and ordered by the server. */
  items: EngagementItem[];
  /** Missed tasks still inside their catch-up window (reduced points). */
  catchUp: EngagementItem[];
  /** Tasks finished today, with their outcome. */
  doneToday: EngagementItem[];
  /** Locked future items — metadata only. */
  upcoming: EngagementItem[];
  /** Recently revealed questions and polls the learner answered — answer, explanation, result. */
  revealed: EngagementItem[];
  /** Today's scheduled total. Constant through the day; catch-ups never enter it. */
  scheduledToday: number;
  completedToday: number;
  /** True when the cap hid additional items; they are NOT counted as missed. */
  capApplied: boolean;
  /** How many of today's tasks the cap is still holding back, when the server says. */
  hiddenByCap?: number | null;
  /** When the earliest catch-up window closes, when the server says. */
  catchUpClosesAt?: string | null;
  /** @deprecated use `scheduledToday`. Kept for the current card. */
  totalToday: number;
  /** @deprecated the server streak lives in the points summary. Kept for the current card. */
  streakDays: number;
}

/**
 * Where a COURSE_SLIDE task points. Carried in payloadJson because the learner app
 * needs the whole path — course, session, subject, module, chapter — to open a slide,
 * not just its id.
 */
export interface EngagementSlideTarget {
  slideId: string;
  slideTitle?: string;
  slideType?: string;
  courseId?: string;
  sessionId?: string;
  levelId?: string;
  subjectId?: string;
  moduleId?: string;
  chapterId?: string;
}

/** MCQ unless the item says otherwise — older items carry no format. */
export function questionFormatOf(item: EngagementItem): QuestionFormat {
  return (parseQuestionPayload(item)?.format ?? "MCQ") as QuestionFormat;
}

/** Parse a COURSE_SLIDE item's target; null when the payload is absent or broken. */
export function parseSlideTarget(item: EngagementItem): EngagementSlideTarget | null {
  if (!item.payloadJson) return null;
  try {
    const parsed = JSON.parse(item.payloadJson) as EngagementSlideTarget;
    return parsed?.slideId ? parsed : null;
  } catch {
    return null;
  }
}

/** How a question of the day is answered. */
export type QuestionFormat = "MCQ" | "TEXT" | "UPLOAD";

/** Options as authored by the teacher. `correctOptionId` only arrives after reveal. */
export interface EngagementQuestionPayload {
  /** Absent on older items, which were all multiple choice. */
  format?: QuestionFormat;
  options?: { id: string; text: string }[];
  correctOptionId?: string;
  explanation?: string;
  prompt?: string;
}

// ── Flashcards ───────────────────────────────────────────────────────

export interface EngagementFlashcard {
  id: string;
  front: string;
  back: string;
  hint?: string;
}

export interface EngagementFlashcardsPayload {
  schema: "flashcards/v1";
  cards: EngagementFlashcard[];
  /** Default true, as on the server. */
  shuffle: boolean;
}

export type FlashcardResult = "KNOWN" | "LEARNING";

export interface FlashcardOutcome {
  cardId: string;
  /** The learner's first rating of the card. */
  result: FlashcardResult;
}

/**
 * Parse a FLASHCARDS item's deck. Tolerant: cards without an id, a front or a back
 * are skipped, and null means there is nothing to study. Text is returned as text;
 * render it in text nodes, never as HTML.
 */
export function parseFlashcards(item: EngagementItem): EngagementFlashcardsPayload | null {
  if (!item.payloadJson) return null;
  try {
    const raw = JSON.parse(item.payloadJson) as {
      cards?: unknown;
      settings?: { shuffle?: unknown } | null;
    };
    if (!raw || !Array.isArray(raw.cards)) return null;
    const cards: EngagementFlashcard[] = [];
    for (const c of raw.cards as Array<Record<string, unknown> | null>) {
      if (!c) continue;
      const { id, front, back, hint } = c;
      if (typeof id !== "string" || !id) continue;
      if (typeof front !== "string" || !front.trim()) continue;
      if (typeof back !== "string" || !back.trim()) continue;
      cards.push({
        id,
        front,
        back,
        ...(typeof hint === "string" && hint.trim() ? { hint } : {}),
      });
    }
    if (cards.length === 0) return null;
    return {
      schema: "flashcards/v1",
      cards,
      shuffle: raw.settings?.shuffle !== false,
    };
  } catch {
    return null;
  }
}

// ── Submit ───────────────────────────────────────────────────────────

export interface EngagementSubmitRequest {
  selectedOptionId?: string;
  /** Written-answer format. */
  textAnswer?: string;
  /** Upload format: ids returned by the file upload. */
  fileIds?: string[];
  score?: number;
  responseJson?: string;
  timeSpentMs?: number;
  scrollPercent?: number;
  /** FLASHCARDS: one first rating per card in the current deck. */
  cardOutcomes?: FlashcardOutcome[];
  /** FLASHCARDS: the deck version studied; a stale version is rejected. */
  itemVersion?: number;
}

export interface EngagementSubmitResponse {
  attemptId: string;
  status: string;
  isCorrect?: boolean | null;
  pointsAwarded: number;
  isLate: boolean;
  isVerified: boolean;
  isRevealed: boolean;
  correctOptionId?: string | null;
  explanation?: string | null;
  /** The learner's new running total (null when the ledger could not be read). */
  newTotalPoints?: number | null;
  /** Answer accepted, but correctness is being held back until the reveal. */
  resultPending?: boolean | null;
  /** The task was already done; nothing new was awarded. */
  alreadyCompleted?: boolean | null;
  /** Answered after the reveal: completion points only. */
  answerAlreadyOut?: boolean | null;
  pollResults?: EngagementPollResult[] | null;
  responseCount?: number | null;
  flashcardsResult?: EngagementFlashcardsResult | null;
}

/** How one submit turned out, for the result view and the celebration gate. */
export type EngagementOutcome = "correct" | "wrong" | "pending" | "done";

export function engagementOutcome(r: EngagementSubmitResponse): EngagementOutcome {
  if (r.resultPending === true) return "pending";
  if (r.isCorrect === true) return "correct";
  if (r.isCorrect === false) return "wrong";
  return "done";
}

// ── Fetching ─────────────────────────────────────────────────────────

type RawFeed = Partial<Record<keyof EngagementFeed, unknown>> | null | undefined;

function list(value: unknown): EngagementItem[] {
  return Array.isArray(value) ? (value as EngagementItem[]) : [];
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function optNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isCompletedStatus(status: string | null | undefined): boolean {
  return (status ?? "").toUpperCase() === "COMPLETED";
}

/**
 * Only questions (the answer key) and polls (the vote split) carry a reveal, as on
 * the server (getFeed's hasReveal); a reading, game or lesson here is a server slip.
 */
function onlyRevealable(items: EngagementItem[]): EngagementItem[] {
  return items.filter((i) => i.itemType === "QUESTION_OF_DAY" || i.itemType === "POLL");
}

/**
 * Normalise the feed body. With `legacyItems` the catch-up rows stay inside `items`,
 * as the pre-contract card expects; otherwise they move to `catchUp`.
 */
export function normalizeEngagementFeed(
  data: RawFeed,
  opts: { legacyItems?: boolean } = {}
): EngagementFeed {
  const rawItems = list(data?.items);
  const serverCatchUp = Array.isArray(data?.catchUp) ? list(data?.catchUp) : null;
  const catchUp = serverCatchUp ?? rawItems.filter((i) => i.state === "CATCH_UP");
  const catchUpIds = new Set(catchUp.map((i) => i.id));
  const todayItems = rawItems.filter((i) => i.state !== "CATCH_UP" && !catchUpIds.has(i.id));
  const completedToday = num(data?.completedToday);
  const scheduledToday =
    data?.scheduledToday !== undefined && data?.scheduledToday !== null
      ? num(data.scheduledToday)
      : completedToday + todayItems.length;
  const catchUpClosesAt =
    typeof data?.catchUpClosesAt === "string"
      ? data.catchUpClosesAt
      : catchUp
          .map((i) => i.catchUpClosesAt ?? i.closesAt ?? null)
          .filter((v): v is string => Boolean(v))
          .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  return {
    items: opts.legacyItems ? rawItems : todayItems,
    catchUp,
    doneToday: list(data?.doneToday),
    upcoming: list(data?.upcoming),
    revealed: onlyRevealable(list(data?.revealed)),
    scheduledToday,
    completedToday,
    capApplied: Boolean(data?.capApplied),
    hiddenByCap: optNum(data?.hiddenByCap),
    catchUpClosesAt,
    totalToday: num(data?.totalToday, scheduledToday),
    streakDays: num(data?.streakDays),
  };
}

/** True when the server has nothing at all for this learner: no plan is running. */
export function isEmptyEngagementFeed(feed: EngagementFeed): boolean {
  return (
    feed.items.length === 0 &&
    feed.catchUp.length === 0 &&
    feed.doneToday.length === 0 &&
    feed.upcoming.length === 0 &&
    feed.revealed.length === 0 &&
    feed.completedToday === 0 &&
    feed.scheduledToday === 0
  );
}

/**
 * Today's tasks across every batch. Returns an empty feed on any failure.
 * @deprecated Legacy: swallows errors. New code uses {@link fetchEngagementFeedOrThrow}
 * through `useEngagementFeed()`.
 */
export async function fetchEngagementFeed(): Promise<EngagementFeed> {
  try {
    const instituteId = await getInstituteId();
    if (!instituteId) return normalizeEngagementFeed(null, { legacyItems: true });
    const { data } = await authenticatedAxiosInstance.get(`${LEARNER_API}/feed`, {
      params: { instituteId },
    });
    return normalizeEngagementFeed(data, { legacyItems: true });
  } catch (error) {
    console.error("[engagement] feed fetch failed:", error);
    return normalizeEngagementFeed(null, { legacyItems: true });
  }
}

/** Calendar day (yyyy-mm-dd) of an ISO instant in the device's zone. */
function localDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Older servers send no `doneToday`. Rebuild it from a one-day history, best effort:
 * an empty list on failure, so the feed itself never fails because of it.
 */
async function doneTodayFromHistory(): Promise<EngagementItem[]> {
  try {
    const history = await fetchEngagementHistory(1);
    const today = localDay(new Date().toISOString());
    return history.items.filter(
      (i) =>
        isCompletedStatus(i.attemptStatus) &&
        i.historyStatus !== "MISSED" &&
        localDay(i.completedAt) === today
    );
  } catch {
    return [];
  }
}

/**
 * Today's tasks, normalised (see {@link EngagementFeed}). Throws on any request
 * failure so the caller can show an error; resolves `null` only when no plan is
 * running (or no institute is selected).
 */
export async function fetchEngagementFeedOrThrow(
  instituteId?: string | null
): Promise<EngagementFeed | null> {
  const id = instituteId ?? (await getInstituteId());
  if (!id) return null;
  const { data } = await authenticatedAxiosInstance.get(`${LEARNER_API}/feed`, {
    params: { instituteId: id },
  });
  const feed = normalizeEngagementFeed(data);
  const hasDoneToday = Array.isArray((data as RawFeed)?.doneToday);
  if (!hasDoneToday && feed.completedToday > 0) {
    feed.doneToday = await doneTodayFromHistory();
  }
  return isEmptyEngagementFeed(feed) ? null : feed;
}

/** Past tasks over the last `days` days. Throws; the page shows its own error state. */
export async function fetchEngagementHistory(days = 30): Promise<EngagementHistory> {
  const instituteId = await getInstituteId();
  const { data } = await authenticatedAxiosInstance.get(`${LEARNER_API}/history`, {
    params: { instituteId, days },
  });
  return {
    from: String(data?.from ?? ""),
    to: String(data?.to ?? ""),
    items: Array.isArray(data?.items) ? data.items : [],
    done: Number(data?.done ?? 0),
    missed: Number(data?.missed ?? 0),
    catchUp: Number(data?.catchUp ?? 0),
    pointsEarned: Number(data?.pointsEarned ?? 0),
  };
}

/**
 * Full payload for one task. Throws so the UI can show the server's reason.
 * Opening a task this way also records its start on the server (the dwell gates
 * are measured from it), so call it when the task is opened, not to prefetch.
 */
export async function fetchEngagementItem(itemId: string): Promise<EngagementItem> {
  const instituteId = await getInstituteId();
  const { data } = await authenticatedAxiosInstance.get(`${LEARNER_API}/item/${itemId}`, {
    params: { instituteId },
  });
  return data as EngagementItem;
}

/**
 * Window event fired after every successful submit, with the response as `detail`.
 * Surfaces that show points (the header pill) listen to refresh themselves, whichever
 * UI submitted the task.
 */
export const ENGAGEMENT_RESULT_EVENT = "vacademy:engagement-result";

/**
 * Complete a task. The server grades it, clamps any score and awards the points.
 * On success the gamification store moves by the result (D2) and
 * {@link ENGAGEMENT_RESULT_EVENT} fires.
 */
export async function submitEngagementItem(
  itemId: string,
  request: EngagementSubmitRequest
): Promise<EngagementSubmitResponse> {
  const instituteId = await getInstituteId();
  const { data } = await authenticatedAxiosInstance.post(
    `${LEARNER_API}/item/${itemId}/submit`,
    request,
    { params: { instituteId } }
  );
  const response = data as EngagementSubmitResponse;
  try {
    usePlayGamificationStore.getState().applyEngagementResult(response, instituteId);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(ENGAGEMENT_RESULT_EVENT, { detail: response }));
    }
  } catch {
    // Points display is best effort; never fail a submit that the server accepted.
  }
  return response;
}

/** Parse an item's payload, tolerating the server having withheld or redacted it. */
export function parseQuestionPayload(
  item: EngagementItem
): EngagementQuestionPayload | null {
  if (!item.payloadJson) return null;
  try {
    return JSON.parse(item.payloadJson) as EngagementQuestionPayload;
  } catch {
    return null;
  }
}

// ── Errors ───────────────────────────────────────────────────────────

/** Why the server refused a submit (the `reasonCode` of a 4xx body). */
export const ENGAGEMENT_REASON_CODES = [
  "LESSON_NOT_FINISHED",
  "TASK_CLOSED",
  "NOT_OPEN",
  "READ_GATE",
  "ANSWER_REQUIRED",
  "GAME_NOT_FINISHED",
  "UNSUPPORTED_TYPE",
  "FLASHCARDS_STALE",
  "FLASHCARDS_INCOMPLETE",
  "FLASHCARDS_TOO_FAST",
] as const;

export type EngagementReasonCode = (typeof ENGAGEMENT_REASON_CODES)[number];

/**
 * What the UI should do after a refusal:
 * - `close`: the task can no longer be done; close it and refetch the feed.
 * - `reload`: the task changed under the learner; refetch the item and resume.
 * - `stay`: keep the task open and show the message (a gate or a missing answer).
 */
export type EngagementReasonAction = "close" | "reload" | "stay";

const REASON_ACTIONS: Record<EngagementReasonCode, EngagementReasonAction> = {
  LESSON_NOT_FINISHED: "stay",
  TASK_CLOSED: "close",
  NOT_OPEN: "close",
  READ_GATE: "stay",
  ANSWER_REQUIRED: "stay",
  GAME_NOT_FINISHED: "stay",
  UNSUPPORTED_TYPE: "close",
  FLASHCARDS_STALE: "reload",
  FLASHCARDS_INCOMPLETE: "stay",
  FLASHCARDS_TOO_FAST: "stay",
};

export function engagementReasonAction(
  code: EngagementReasonCode | undefined
): EngagementReasonAction {
  return code ? REASON_ACTIONS[code] : "stay";
}

function isReasonCode(value: unknown): value is EngagementReasonCode {
  return (
    typeof value === "string" &&
    (ENGAGEMENT_REASON_CODES as readonly string[]).includes(value)
  );
}

/** The `reasonCode` of an engagement 4xx, when the server sent a known one. */
export function engagementReasonCode(error: unknown): EngagementReasonCode | undefined {
  if (!isAxiosError<{ reasonCode?: unknown }>(error)) return undefined;
  const code = error.response?.data?.reasonCode;
  return isReasonCode(code) ? code : undefined;
}

function isOffline(error: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return isAxiosError(error) && !error.response && error.code === "ERR_NETWORK";
}

const ERRORS_NS = "dashboardEngagement";

/**
 * A learner-facing message for any engagement failure.
 * Order: a known `reasonCode` (translated, server text as the fallback), then being
 * offline, then the server's own `ex`/`message`, then a generic line.
 */
export function engagementErrorMessage(
  error: unknown,
  t: TFunction
): { message: string; reasonCode?: EngagementReasonCode } {
  const generic = t("errors.generic", {
    ns: ERRORS_NS,
    defaultValue: "Something went wrong. Please try again.",
  });
  const body = isAxiosError<{ ex?: string; message?: string }>(error)
    ? error.response?.data
    : undefined;
  const serverText =
    (typeof body?.ex === "string" && body.ex) ||
    (typeof body?.message === "string" && body.message) ||
    "";
  const reasonCode = engagementReasonCode(error);
  if (reasonCode) {
    return {
      message: t(`errors.${reasonCode}`, {
        ns: ERRORS_NS,
        defaultValue: serverText || generic,
      }),
      reasonCode,
    };
  }
  if (isOffline(error)) {
    return {
      message: t("errors.offline", {
        ns: ERRORS_NS,
        defaultValue: "You're offline. Your answer is kept; try again when you're back online.",
      }),
    };
  }
  return { message: serverText || generic };
}
