/**
 * AI usage limits — the UI half: localized message, the global toast, and the
 * "an inline spot already showed it" hand-off.
 *
 * The axios interceptor schedules a toast for every 429 `AI_USAGE_LIMIT`. A
 * screen that renders the message inline (chat bubble, tutor banner, KB
 * companion notice) calls `claimAiUsageLimit(error)` in its catch block; a
 * claimed error gets no toast, so the learner never sees the same sentence
 * twice. Unclaimed ones (any other AI feature) still get the toast.
 */
import { toast } from "sonner";
import i18n from "@/i18n";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/formatters";
import {
  buildAiUsageLimitMessage,
  getAiUsageLimitFromError,
  parseAiUsageWarningHeader,
  type AiUsageLimitBody,
} from "@/lib/ai-usage-limit";

export type { AiUsageLimitBody } from "@/lib/ai-usage-limit";

// Long enough for the caller's catch (a few awaits deep) to claim the error.
const TOAST_DEFER_MS = 60;
const claimed = new WeakSet<object>();

const translate = (key: string, options?: Record<string, unknown>): string =>
  String(i18n.t(`common:aiUsageLimit.${key}`, options as Record<string, string>));

/** A whole sentence with an English fallback when the catalog lacks it. */
const translateOr = (key: string, fallback: string): string =>
  i18n.exists(`common:aiUsageLimit.${key}`) ? translate(key) : fallback;

const sameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Today → time only ("12:00 am"); later → date and time. */
const formatWhen = (when: Date): string =>
  sameLocalDay(when, new Date())
    ? formatDateTime(when, { day: undefined, month: undefined, year: undefined })
    : formatDateTime(when, { year: undefined });

const formatAmount = (value: number, unit: string): string =>
  unit === "usd"
    ? formatCurrency(value, "USD")
    : formatNumber(value, { maximumFractionDigits: unit === "requests" ? 0 : 1 });

/** The localized sentence for a limit body (falls back to the server's English one). */
const FALLBACK_MESSAGE = "You've reached your AI usage limit. Try again later, or ask your teacher.";

export function aiUsageLimitMessage(body: AiUsageLimitBody): string {
  try {
    // Catalog not loaded (or an old bundle without the keys): the server's sentence.
    if (!i18n.exists("common:aiUsageLimit.reached")) return body.message || FALLBACK_MESSAGE;
    return buildAiUsageLimitMessage(body, { t: translate, formatWhen, formatAmount });
  } catch {
    return body.message || FALLBACK_MESSAGE;
  }
}

const toastId = (body: AiUsageLimitBody) => `ai-usage-limit:${body.use_case || "ai"}`;

/** Shows the limit toast now (one per feature at a time — repeats replace it). */
export function notifyAiUsageLimit(body: AiUsageLimitBody): void {
  try {
    toast.warning(translateOr("title", "AI usage limit reached"), { id: toastId(body), description: aiUsageLimitMessage(body) });
  } catch {
    /* a toast failure must never break the request chain */
  }
}

/**
 * Interceptor side: toast this limit error unless a screen claims it first.
 * Never throws; the error itself is re-thrown by the interceptor unchanged.
 */
export function scheduleAiUsageLimitToast(error: unknown, body: AiUsageLimitBody): void {
  if (typeof error !== "object" || error === null) {
    notifyAiUsageLimit(body);
    return;
  }
  setTimeout(() => {
    if (!claimed.has(error)) notifyAiUsageLimit(body);
  }, TOAST_DEFER_MS);
}

/**
 * Screen side: if `error` is a usage-limit error, mark it as shown inline (no
 * toast) and return its body; otherwise null and nothing changes.
 */
export function claimAiUsageLimit(error: unknown): AiUsageLimitBody | null {
  const body = getAiUsageLimitFromError(error);
  if (body && typeof error === "object" && error !== null) claimed.add(error);
  return body;
}

// ── soft warning (X-AI-Usage-Warning on a successful response) ──
const WARNING_STORAGE_KEY = "ai-usage-warning-shown";
const WARNING_QUIET_MS = 6 * 60 * 60 * 1000;
const warnedAt = new Map<string, number>();

const lastWarned = (useCase: string): number => {
  const inMemory = warnedAt.get(useCase);
  if (inMemory) return inMemory;
  try {
    const raw = localStorage.getItem(WARNING_STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    return typeof map[useCase] === "number" ? map[useCase] : 0;
  } catch {
    return 0;
  }
};

const rememberWarned = (useCase: string, at: number): void => {
  warnedAt.set(useCase, at);
  try {
    const raw = localStorage.getItem(WARNING_STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    map[useCase] = at;
    localStorage.setItem(WARNING_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage blocked: the in-memory map still de-duplicates this tab */
  }
};

/**
 * A gentle, non-blocking heads-up when a successful AI response says the
 * learner is close to a limit. At most once per feature every 6 hours; no
 * numbers (the percentage stays server-side for learners).
 */
export function notifyAiUsageWarning(headerValue: unknown): void {
  try {
    const parsed = parseAiUsageWarningHeader(headerValue);
    if (!parsed) return;
    const now = Date.now();
    if (now - lastWarned(parsed.useCase) < WARNING_QUIET_MS) return;
    rememberWarned(parsed.useCase, now);
    toast.info(translateOr("warning", "You're close to your AI usage allowance."), { id: `ai-usage-warning:${parsed.useCase}` });
  } catch {
    /* never let a warning affect the response */
  }
}
