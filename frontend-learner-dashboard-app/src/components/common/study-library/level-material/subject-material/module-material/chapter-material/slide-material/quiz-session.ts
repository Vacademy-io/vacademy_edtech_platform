import { v4 as uuidv4, validate as isUuid } from "uuid";

/**
 * A quiz attempt in progress on this device, from the moment the learner
 * presses Start until it is submitted. An attempt is counted when it is
 * submitted (one activity-log row per submission). The start time and the
 * answers so far are kept here, so reopening a quiz resumes this record.
 */
export type QuizAnswers = Record<string, string | number | string[]>;

export interface QuizSession {
  userId: string | null;
  /** The activity-log id. The server updates the row for an id it already has, so sending this attempt again stays one attempt. */
  attemptId: string;
  startedAt: number;
  /** Time spent over earlier visits. A quiz with no clock reports this rather than the days between visits. */
  spentMs: number;
  answers: QuizAnswers;
  current: number;
}

type QuizSessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const quizSessionKey = (slideId: string) => `quiz_session_${slideId}`;

export const readQuizSession = (
  slideId: string,
  storage: QuizSessionStorage = localStorage
): QuizSession | null => {
  try {
    const raw = storage.getItem(quizSessionKey(slideId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.startedAt !== "number" || !Number.isFinite(parsed.startedAt)) return null;
    return {
      userId: typeof parsed.userId === "string" ? parsed.userId : null,
      attemptId: isUuid(parsed.attemptId) ? parsed.attemptId : uuidv4(),
      startedAt: parsed.startedAt,
      spentMs: Number.isFinite(parsed.spentMs) && parsed.spentMs > 0 ? parsed.spentMs : 0,
      answers: parsed.answers && typeof parsed.answers === "object" ? parsed.answers : {},
      current: Number.isInteger(parsed.current) && parsed.current >= 0 ? parsed.current : 0,
    };
  } catch {
    return null;
  }
};

/** The attempt this learner already has running here, if any. */
export const readOwnQuizSession = (
  slideId: string,
  userId: string | null | undefined,
  storage: QuizSessionStorage = localStorage
): QuizSession | null => {
  const session = readQuizSession(slideId, storage);
  return session && (!session.userId || session.userId === userId) ? session : null;
};

export const writeQuizSession = (
  slideId: string,
  session: QuizSession,
  storage: QuizSessionStorage = localStorage
): void => {
  try {
    storage.setItem(quizSessionKey(slideId), JSON.stringify(session));
  } catch {
    // Storage full or blocked: the attempt carries on for this page view.
  }
};

export const clearQuizSession = (
  slideId: string,
  storage: QuizSessionStorage = localStorage
): void => {
  try {
    storage.removeItem(quizSessionKey(slideId));
  } catch {
    // Nothing to clean up if storage is blocked.
  }
};

/** Whole seconds left on the clock, between 0 and the limit. */
export const quizSecondsLeft = (startedAt: number, limitSeconds: number, now: number): number => {
  const left = Math.ceil((startedAt + limitSeconds * 1000 - now) / 1000);
  return Math.min(Math.max(left, 0), limitSeconds);
};

/** When an attempt ended for reporting: a timed attempt cannot outlast its clock, however late it is sent. */
export const quizAttemptEnd = (startedAt: number, limitSeconds: number, now: number): number =>
  limitSeconds > 0 ? Math.min(now, startedAt + limitSeconds * 1000) : now;

/** A clock or a cap on attempts is worth a decision before the quiz opens. */
export const quizNeedsStart = (
  timeLimitMinutes: number | null | undefined,
  reAttemptCount: number | null | undefined
): boolean => (timeLimitMinutes != null && timeLimitMinutes > 0) || reAttemptCount != null;

/** The slide description as plain prose, or null if it holds anything else. */
export const quizDescriptionText = (raw: string | null | undefined): string | null => {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || /^[[{]/.test(trimmed) || trimmed.toLowerCase() === "null") return null;
  const text = trimmed
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
};
