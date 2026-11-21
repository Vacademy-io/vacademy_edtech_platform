import { describe, expect, it } from "vitest";
import {
  aiUsageLimitHasNumbers,
  aiUsageLimitResetsAt,
  buildAiUsageLimitMessage,
  getAiUsageLimitFromError,
  parseAiUsageLimitBody,
  parseAiUsageWarningHeader,
  type AiUsageLimitBody,
} from "./ai-usage-limit";

const BODY: AiUsageLimitBody = {
  error: "AI_USAGE_LIMIT",
  use_case: "tutor_chat",
  use_case_label: "AI tutor chat",
  scope: "USER",
  period: "DAY",
  limit: 20,
  used: 20.4,
  unit: "credits",
  resets_at: "2026-10-16T00:00:00+05:30",
  set_by: "INSTITUTE",
  message: "You've reached today's limit for AI tutor chat. It resets at midnight.",
};

// Echoes key + interpolation values so assertions read the composition.
const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}(${Object.entries(options).map(([k, v]) => `${k}=${String(v)}`).join(",")})` : key;
const deps = {
  t,
  formatWhen: (d: Date) => d.toISOString(),
  formatAmount: (n: number, unit: string) => `${n}${unit === "usd" ? "$" : ""}`,
};

describe("parseAiUsageLimitBody", () => {
  it("accepts the bare body, a JSON string, and detail/data wrapping", () => {
    expect(parseAiUsageLimitBody(BODY)).toEqual(BODY);
    expect(parseAiUsageLimitBody(JSON.stringify(BODY))).toEqual(BODY);
    expect(parseAiUsageLimitBody({ detail: BODY })).toEqual(BODY);
    expect(parseAiUsageLimitBody({ type: "ERROR", code: 429, data: BODY })).toEqual(BODY);
    expect(parseAiUsageLimitBody({ type: "usage_limit", ...BODY })?.use_case).toBe("tutor_chat");
  });

  it("ignores everything else", () => {
    expect(parseAiUsageLimitBody(null)).toBeNull();
    expect(parseAiUsageLimitBody("Too Many Requests")).toBeNull();
    expect(parseAiUsageLimitBody("{not json")).toBeNull();
    expect(parseAiUsageLimitBody({ detail: "Rate limit exceeded" })).toBeNull();
    expect(parseAiUsageLimitBody({ detail: { code: "RATE_LIMITED", message: "slow down" } })).toBeNull();
    expect(parseAiUsageLimitBody({ type: "ERROR", code: 402, message: "credits" })).toBeNull();
    expect(parseAiUsageLimitBody([BODY])).toBeNull();
  });
});

describe("getAiUsageLimitFromError", () => {
  it("reads a 429 limit and its Retry-After header", () => {
    const err = { response: { status: 429, data: { ...BODY, resets_at: null }, headers: { "retry-after": "120" } } };
    const body = getAiUsageLimitFromError(err);
    expect(body?.use_case).toBe("tutor_chat");
    expect(body?.retry_after_seconds).toBe(120);
  });

  it("supports AxiosHeaders-style get()", () => {
    const headers = { get: (k: string) => (k === "retry-after" ? "30" : undefined) };
    expect(getAiUsageLimitFromError({ response: { status: 429, data: BODY, headers } })?.retry_after_seconds).toBe(30);
  });

  it("leaves other 429s, other statuses and non-axios errors alone", () => {
    expect(getAiUsageLimitFromError({ response: { status: 429, data: { detail: "Rate limit" } } })).toBeNull();
    expect(getAiUsageLimitFromError({ response: { status: 402, data: BODY } })).toBeNull();
    expect(getAiUsageLimitFromError({ response: { status: 500, data: BODY } })).toBeNull();
    expect(getAiUsageLimitFromError(new Error("network"))).toBeNull();
    expect(getAiUsageLimitFromError(undefined)).toBeNull();
  });
});

describe("buildAiUsageLimitMessage", () => {
  it("names the feature and period, shows numbers when present, and the reset", () => {
    expect(buildAiUsageLimitMessage(BODY, deps)).toBe(
      "reachedDay(feature=AI tutor chat) numbersCredits(used=20.4,limit=20) resetsAt(when=2026-10-15T18:30:00.000Z)",
    );
  });

  it("omits numbers when the server left them out (institute hides them)", () => {
    const { used: _used, limit: _limit, ...hidden } = BODY;
    void _used;
    void _limit;
    expect(aiUsageLimitHasNumbers(hidden)).toBe(false);
    expect(buildAiUsageLimitMessage(hidden, deps)).toBe(
      "reachedDay(feature=AI tutor chat) resetsAt(when=2026-10-15T18:30:00.000Z)",
    );
    expect(buildAiUsageLimitMessage({ ...BODY, used: null, limit: null }, deps)).not.toContain("numbers");
  });

  it("falls back for unknown period / missing label / no reset", () => {
    const body: AiUsageLimitBody = { error: "AI_USAGE_LIMIT", period: "FORTNIGHT" };
    expect(buildAiUsageLimitMessage(body, deps)).toBe("reached(feature=featureFallback) tryLater");
    expect(buildAiUsageLimitMessage({ ...body, period: "week" }, deps)).toContain("reachedWeek");
    expect(buildAiUsageLimitMessage({ ...body, period: "PLAN_PERIOD" }, deps)).toContain("reachedPlanPeriod");
  });

  it("uses the unit-specific numbers sentence", () => {
    expect(buildAiUsageLimitMessage({ ...BODY, unit: "requests", used: 5, limit: 5 }, deps)).toContain(
      "numbersRequests(used=5,limit=5)",
    );
    expect(buildAiUsageLimitMessage({ ...BODY, unit: "usd", used: 1.5, limit: 1 }, deps)).toContain(
      "numbersUsd(used=1.5$,limit=1$)",
    );
  });
});

describe("aiUsageLimitResetsAt", () => {
  it("prefers resets_at, then Retry-After, else null", () => {
    expect(aiUsageLimitResetsAt(BODY)?.toISOString()).toBe("2026-10-15T18:30:00.000Z");
    const now = Date.UTC(2026, 9, 15, 10, 0, 0);
    expect(
      aiUsageLimitResetsAt({ error: "AI_USAGE_LIMIT", resets_at: "garbage", retry_after_seconds: 60 }, now)?.getTime(),
    ).toBe(now + 60_000);
    expect(aiUsageLimitResetsAt({ error: "AI_USAGE_LIMIT" })).toBeNull();
  });
});

describe("parseAiUsageWarningHeader", () => {
  it("parses use case and pct", () => {
    expect(parseAiUsageWarningHeader("tutor_chat;pct=85")).toEqual({ useCase: "tutor_chat", pct: 85 });
    expect(parseAiUsageWarningHeader(" learner_assistant ; pct = 90.4 ")).toEqual({ useCase: "learner_assistant", pct: 90 });
    expect(parseAiUsageWarningHeader("tutor_chat")).toEqual({ useCase: "tutor_chat", pct: null });
  });

  it("rejects empty / non-string", () => {
    expect(parseAiUsageWarningHeader("")).toBeNull();
    expect(parseAiUsageWarningHeader(";pct=5")).toBeNull();
    expect(parseAiUsageWarningHeader(undefined)).toBeNull();
    expect(parseAiUsageWarningHeader(["tutor_chat;pct=85"])).toBeNull();
  });
});
