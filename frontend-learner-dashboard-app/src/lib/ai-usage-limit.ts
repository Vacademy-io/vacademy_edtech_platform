/**
 * AI usage limits (ai_service 429 `AI_USAGE_LIMIT`) — the pure half.
 *
 * An institute (or the platform) can cap how much AI a learner, a role or the
 * whole institute uses per day / week / month. When a cap is hit, ai_service
 * answers HTTP 429 with:
 *
 *   {"error":"AI_USAGE_LIMIT","use_case":"tutor_chat","use_case_label":"AI tutor chat",
 *    "scope":"USER","period":"DAY","limit":20,"used":20.4,"unit":"credits",
 *    "resets_at":"2026-10-16T00:00:00+05:30","set_by":"INSTITUTE","message":"…"}
 *
 * plus a `Retry-After` header. The tutor socket sends the same payload as a
 * `{"type":"usage_limit", …}` control frame. `used` / `limit` are present only
 * when the institute lets learners see the numbers — the server drops them
 * otherwise, so "numbers in the body" is the whole permission check here.
 *
 * This file has no side-effect imports (no i18n, no toast, no stores) so it is
 * unit-testable in node; the toast + i18n half is ai-usage-limit-notify.ts.
 * Nothing here changes how any other error (including other 429s) behaves.
 */

export const AI_USAGE_LIMIT_ERROR = "AI_USAGE_LIMIT";

export type AiUsageLimitPeriod = "DAY" | "WEEK" | "MONTH" | "PLAN_PERIOD";

export interface AiUsageLimitBody {
  error: typeof AI_USAGE_LIMIT_ERROR;
  use_case?: string | null;
  use_case_label?: string | null;
  scope?: string | null;
  period?: AiUsageLimitPeriod | string | null;
  limit?: number | null;
  used?: number | null;
  unit?: "credits" | "requests" | "usd" | string | null;
  /** ISO instant with the policy timezone's offset. */
  resets_at?: string | null;
  set_by?: string | null;
  /** Server-written English sentence; the UI composes its own localized one. */
  message?: string | null;
  /** From the Retry-After header when the error came over HTTP. */
  retry_after_seconds?: number | null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isLimitShape = (v: unknown): v is AiUsageLimitBody =>
  isObject(v) && v.error === AI_USAGE_LIMIT_ERROR;

/**
 * The limit body inside a response payload / SSE data / socket frame, or null.
 * Accepts the bare body, a JSON string of it, or FastAPI's `{detail: body}`
 * wrapping (in case a route raises it as an HTTPException).
 */
export function parseAiUsageLimitBody(data: unknown): AiUsageLimitBody | null {
  let value = data;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed.startsWith("{")) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (isLimitShape(value)) return value;
  if (isObject(value) && isLimitShape(value.detail)) return value.detail;
  // Chat-agent SSE error frames nest their payload under `data`.
  if (isObject(value) && isLimitShape(value.data)) return value.data;
  return null;
}

const readRetryAfter = (headers: unknown): number | null => {
  if (!isObject(headers)) return null;
  const getter = (headers as { get?: (k: string) => unknown }).get;
  const raw =
    typeof getter === "function"
      ? getter.call(headers, "retry-after")
      : (headers["retry-after"] ?? headers["Retry-After"]);
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * The limit body carried by an axios-style error (`error.response.{status,data,headers}`),
 * or null for every other error — including 429s that are not usage limits
 * (rate limiters, the KB companion's own throttle, …), which callers keep
 * handling exactly as before.
 */
export function getAiUsageLimitFromError(error: unknown): AiUsageLimitBody | null {
  if (!isObject(error)) return null;
  const response = error.response;
  if (!isObject(response)) return null;
  const status = response.status;
  if (typeof status === "number" && status !== 429) return null;
  const body = parseAiUsageLimitBody(response.data);
  if (!body) return null;
  if (body.retry_after_seconds == null) {
    const retryAfter = readRetryAfter(response.headers);
    if (retryAfter !== null) return { ...body, retry_after_seconds: retryAfter };
  }
  return body;
}

/** The instant the limit lifts: `resets_at`, else now + Retry-After, else null. */
export function aiUsageLimitResetsAt(body: AiUsageLimitBody, now: number = Date.now()): Date | null {
  if (body.resets_at) {
    const d = new Date(body.resets_at);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (typeof body.retry_after_seconds === "number" && body.retry_after_seconds > 0) {
    return new Date(now + body.retry_after_seconds * 1000);
  }
  return null;
}

/** True when the server included the numbers (i.e. the institute allows showing them). */
export function aiUsageLimitHasNumbers(body: AiUsageLimitBody): boolean {
  return (
    typeof body.used === "number" &&
    Number.isFinite(body.used) &&
    typeof body.limit === "number" &&
    Number.isFinite(body.limit)
  );
}

export interface AiUsageLimitMessageDeps {
  /** i18next-style translate, keys relative to the `aiUsageLimit` block of `common`. */
  t: (key: string, options?: Record<string, unknown>) => string;
  /** Formats the reset instant for display ("5:30 pm" / "16 Oct, 12:00 am"). */
  formatWhen: (when: Date) => string;
  /** Formats a used/limit amount; `unit` is the body's unit. */
  formatAmount: (value: number, unit: string) => string;
  now?: number;
}

const PERIOD_KEYS: Record<string, string> = {
  DAY: "reachedDay",
  WEEK: "reachedWeek",
  MONTH: "reachedMonth",
  PLAN_PERIOD: "reachedPlanPeriod",
};

/**
 * One learner-friendly sentence (or two): what ran out, optionally how much was
 * used, and when it comes back — "You've used today's AI tutor chat allowance.
 * You can use it again after 12:00 am, or ask your teacher."
 */
export function buildAiUsageLimitMessage(body: AiUsageLimitBody, deps: AiUsageLimitMessageDeps): string {
  const feature = (body.use_case_label || "").trim() || deps.t("featureFallback");
  const periodKey = PERIOD_KEYS[String(body.period || "").toUpperCase()] || "reached";
  const parts: string[] = [deps.t(periodKey, { feature })];

  if (aiUsageLimitHasNumbers(body)) {
    const unit = String(body.unit || "credits").toLowerCase();
    const numbersKey = unit === "requests" ? "numbersRequests" : unit === "usd" ? "numbersUsd" : "numbersCredits";
    parts.push(
      deps.t(numbersKey, {
        used: deps.formatAmount(body.used as number, unit),
        limit: deps.formatAmount(body.limit as number, unit),
      }),
    );
  }

  const resetsAt = aiUsageLimitResetsAt(body, deps.now);
  parts.push(resetsAt ? deps.t("resetsAt", { when: deps.formatWhen(resetsAt) }) : deps.t("tryLater"));
  return parts.join(" ");
}

/**
 * Soft-warning header `X-AI-Usage-Warning: "<use_case>;pct=<int>"` → its parts,
 * or null when absent / malformed.
 */
export function parseAiUsageWarningHeader(value: unknown): { useCase: string; pct: number | null } | null {
  if (typeof value !== "string") return null;
  const [rawUseCase, ...rest] = value.split(";");
  const useCase = (rawUseCase || "").trim();
  if (!useCase) return null;
  let pct: number | null = null;
  for (const part of rest) {
    const [k, v] = part.split("=");
    if ((k || "").trim().toLowerCase() === "pct") {
      const n = Number((v || "").trim());
      if (Number.isFinite(n)) pct = Math.round(n);
    }
  }
  return { useCase, pct };
}
