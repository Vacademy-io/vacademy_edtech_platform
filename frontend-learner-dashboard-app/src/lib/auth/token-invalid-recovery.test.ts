// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import axios, { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from "axios";

const store = vi.hoisted(() => new Map<string, string>());
const removeTokensAndLogout = vi.hoisted(() => vi.fn(async () => store.clear()));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
    },
    remove: async ({ key }: { key: string }) => {
      store.delete(key);
    },
  },
}));
vi.mock("@/lib/auth/sessionUtility", () => ({
  getTokenFromStorage: async (key: string) => store.get(key) ?? null,
  isTokenExpired: () => false,
  removeTokensAndLogout,
}));
vi.mock("@/constants/urls", () => ({
  REFRESH_TOKEN_URL: "https://backend.example.com/auth-service/learner/v1/refresh-token",
  VALIDATE_SESSION: "https://backend.example.com/auth-service/v1/validate-session",
}));
vi.mock("@/lib/http/clientCache", () => ({
  maybeServeFromCache: (r: unknown) => r,
  maybeStoreInCache: (r: unknown) => r,
}));
vi.mock("@/lib/formatters", () => ({ getActiveLocale: () => "en" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/ai-usage-limit", () => ({ getAiUsageLimitFromError: () => null }));
vi.mock("@/lib/ai-usage-limit-notify", () => ({
  notifyAiUsageWarning: vi.fn(),
  scheduleAiUsageLimitToast: vi.fn(),
}));
vi.mock("@sentry/react", () => ({ withScope: vi.fn(), captureMessage: vi.fn(), captureException: vi.fn() }));

const API = "https://backend.example.com/admin-core-service/v1/learner/something";
const refusal = (config: InternalAxiosRequestConfig, status: number, data: unknown) =>
  new AxiosError(`Request failed with status code ${status}`, String(status), config, {}, {
    status,
    statusText: "",
    headers: AxiosHeaders.from({}),
    config,
    data,
  });

/** The backend accepts only the access tokens in `accepted`; refresh answers per `refresh`. */
const setUp = async (accepted: Set<string>, refresh: "ok" | "rejected" | "network") => {
  const { default: instance } = await import("@/lib/auth/axiosInstance");
  const seen: string[] = [];
  let refreshCalls = 0;
  axios.defaults.adapter = async (config) => {
    refreshCalls += 1;
    if (refresh === "network") throw new AxiosError("Network Error", "ERR_NETWORK", config);
    if (refresh === "rejected") throw refusal(config, 403, {});
    return {
      data: { accessToken: "new-token", refreshToken: "refresh-1" },
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  };
  instance.defaults.adapter = async (config) => {
    const auth = String((config.headers as Record<string, unknown>).Authorization ?? "");
    seen.push(auth);
    if (accepted.has(auth.replace("Bearer ", ""))) {
      return { data: { ok: true }, status: 200, statusText: "OK", headers: {}, config };
    }
    throw refusal(config, 403, { error: "TOKEN_INVALID", message: "not valid" });
  };
  return { instance, seen, refreshCalls: () => refreshCalls };
};

describe("403 TOKEN_INVALID recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    store.clear();
    store.set("accessToken", "old-token");
    store.set("refreshToken", "refresh-1");
    store.set("InstituteId", "inst-1");
  });

  it("refreshes once and retries the request with the new token", async () => {
    const { instance, seen, refreshCalls } = await setUp(new Set(["new-token"]), "ok");

    const res = await Promise.all([instance.get(API), instance.get(API)]);

    expect(res.map((r) => r.data)).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshCalls()).toBe(1);
    expect(seen.filter((s) => s === "Bearer new-token")).toHaveLength(2);
    expect(removeTokensAndLogout).not.toHaveBeenCalled();
  });

  it("signs out when the refresh token is rejected, without retrying", async () => {
    const { instance, seen } = await setUp(new Set(), "rejected");

    const err = await instance.get(API).catch((e) => e);

    expect(err.response?.status).toBe(403);
    expect(seen).toHaveLength(1);
    expect(removeTokensAndLogout).toHaveBeenCalledTimes(1);
  });

  it("keeps the session when the refresh fails for a network reason", async () => {
    const { instance } = await setUp(new Set(), "network");

    await instance.get(API).catch((e) => e);

    expect(removeTokensAndLogout).not.toHaveBeenCalled();
  });

  it("does not loop: a retried request refused again ends the session once", async () => {
    const { instance, seen, refreshCalls } = await setUp(new Set(), "ok");

    const err = await instance.get(API).catch((e) => e);

    expect(err.response?.data?.error).toBe("TOKEN_INVALID");
    expect(seen).toHaveLength(2);
    expect(refreshCalls()).toBe(1);
    expect(removeTokensAndLogout).toHaveBeenCalledTimes(1);
  });
});
