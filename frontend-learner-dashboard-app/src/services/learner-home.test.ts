// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// Node's own experimental localStorage shadows jsdom's; use a plain map.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

import {
  LEARNER_HOME_SNAPSHOT_PREFIX,
  homeActionErrorCode,
  homeActionOutcome,
  normaliseHome,
  postHomeEvents,
  readHomeIdsSync,
  readHomeSnapshot,
  snapshotKey,
  writeHomeSnapshot,
} from "./learner-home";

const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "");
const jwt = (user: string) => `${b64({ alg: "HS256" })}.${b64({ user })}.sig`;

beforeEach(() => store.clear());

describe("normaliseHome", () => {
  it("accepts LEGACY and a BUILDER with blocks; anything else is null (treated as LEGACY)", () => {
    expect(normaliseHome({ mode: "LEGACY" })).toEqual({ mode: "LEGACY" });
    const builder = { mode: "BUILDER", layout_version: 2, blocks: [] };
    expect(normaliseHome(builder)).toBe(builder);
    expect(normaliseHome({ mode: "BUILDER" })).toBeNull();
    expect(normaliseHome({})).toBeNull();
    expect(normaliseHome("<html>")).toBeNull();
    expect(normaliseHome(null)).toBeNull();
  });
});

describe("snapshot", () => {
  it("is keyed by institute AND user, under the prefix logout clears", () => {
    expect(snapshotKey("i1", "u1")).toBe(`${LEARNER_HOME_SNAPSHOT_PREFIX}i1:u1`);
    writeHomeSnapshot("i1", "u1", { mode: "LEGACY" });
    expect(readHomeSnapshot("i1", "u1")?.home).toEqual({ mode: "LEGACY" });
    expect(readHomeSnapshot("i1", "u2")).toBeNull();
    expect(readHomeSnapshot(null, "u1")).toBeNull();
  });

  it("ignores a corrupt snapshot", () => {
    store.set(snapshotKey("i1", "u1"), "{not json");
    expect(readHomeSnapshot("i1", "u1")).toBeNull();
    store.set(snapshotKey("i1", "u1"), JSON.stringify({ savedAt: 1, home: { mode: "WHAT" } }));
    expect(readHomeSnapshot("i1", "u1")).toBeNull();
  });

  it("reads the ids synchronously from the auth code's copies", () => {
    store.set("InstituteId", "inst-9");
    store.set("accessToken", jwt("user-9"));
    expect(readHomeIdsSync()).toEqual({ instituteId: "inst-9", userId: "user-9" });
  });
});

describe("postHomeEvents", () => {
  it("uses fetch keepalive with the bearer token and institute headers (not sendBeacon)", async () => {
    store.set("InstituteId", "inst-9");
    store.set("accessToken", "tok");
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await postHomeEvents([
      { block_key: "b", type: "VIEW", device: "PHONE", platform: "WEB", layout_version: 1, ts: "2026-11-16T00:00:00Z" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/admin-core-service\/learner\/home\/v1\/events\?instituteId=inst-9$/);
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok", clientId: "inst-9" });
    expect(JSON.parse(init.body as string).events).toHaveLength(1);
  });

  it("swallows network failures and sends nothing without a token", async () => {
    store.set("InstituteId", "inst-9");
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", failing);
    await expect(
      postHomeEvents([{ block_key: "b", type: "CLICK", device: "PHONE", platform: "WEB", layout_version: 1, ts: "x" }])
    ).resolves.toBeUndefined();
  });
});

describe("dismiss / ack failures (API contract 409/404 codes)", () => {
  const err = (code?: string) => ({ response: { status: 409, data: code ? { code, message: "x" } : "<html>" } });
  it("reads the feature's error code", () => {
    expect(homeActionErrorCode(err("NOT_DISMISSIBLE"))).toBe("NOT_DISMISSIBLE");
    expect(homeActionErrorCode(err())).toBeNull();
    expect(homeActionErrorCode(new Error("Network Error"))).toBeNull();
  });
  it("keeps the outcome when it already holds, reverts otherwise", () => {
    expect(homeActionOutcome(err("ACK_NOT_REQUIRED"))).toBe("keep");
    expect(homeActionOutcome(err("BLOCK_NOT_FOUND"))).toBe("keep");
    expect(homeActionOutcome(err("NOT_DISMISSIBLE"))).toBe("revert");
    expect(homeActionOutcome(err("ACK_REQUIRED"))).toBe("revert");
    expect(homeActionOutcome(new Error("offline"))).toBe("revert");
  });
});
