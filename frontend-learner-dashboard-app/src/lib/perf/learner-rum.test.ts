import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addInteraction,
  addLayoutShift,
  binFor,
  buildClass,
  buildKey,
  cacheClass,
  cancelKey,
  connectionClass,
  deviceTier,
  installLearnerRum,
  newVisit,
  platformClass,
  routeTemplate,
  skinClass,
  toReports,
  viewportClass,
  visitRows,
  type RumDims,
} from "./learner-rum";

const dims: RumDims = {
  skin: "corporate",
  tier: "mid",
  conn: "4g",
  platform: "web",
  viewport: "phone",
  cache: "cold",
  build: "abc12345",
};

describe("binFor", () => {
  it("reports the first bound a value does not exceed", () => {
    expect(binFor("lcp", 2400)).toBe(2500);
    expect(binFor("lcp", 2500)).toBe(2500);
    expect(binFor("lcp", 2501)).toBe(3000);
    expect(binFor("inp", 180)).toBe(200);
  });

  it("separates the targets the plan is judged on", () => {
    expect(binFor("lcp", 2500)).toBeLessThan(binFor("lcp", 2600));
    expect(binFor("inp", 200)).toBeLessThan(binFor("inp", 210));
    expect(binFor("cls", 100)).toBeLessThan(binFor("cls", 101));
  });

  it("keeps an exactly zero layout shift distinct and caps the top", () => {
    expect(binFor("cls", 0)).toBe(0);
    expect(binFor("lcp", 999999)).toBe(60000);
  });
});

describe("routeTemplate", () => {
  it("keeps templates and drops the trailing slash", () => {
    expect(routeTemplate("/study-library/courses/$courseId/")).toBe(
      "/study-library/courses/$courseId"
    );
    expect(routeTemplate("/")).toBe("/");
    expect(routeTemplate("/$tagName/")).toBe("/$tagName");
    expect(routeTemplate("__root__")).toBe("__root__");
  });

  it.each([
    "https://learner.vacademy.io/dashboard",
    "/auth-transfer?accessToken=abc",
    "/dashboard#section",
    "/users/someone@example.com",
    "/courses/3f2b8c1e-1234-4abc-8def-0123456789ab",
    "/orders/1234567",
    "/a b",
    "/a|b",
    "",
    null,
    undefined,
  ])("refuses anything that is not a template: %s", (value: string | null | undefined) => {
    expect(routeTemplate(value)).toBe("other");
  });
});

describe("deviceTier", () => {
  it("classifies from cores and memory", () => {
    expect(deviceTier(8, 2)).toBe("low");
    expect(deviceTier(4, 8)).toBe("low");
    expect(deviceTier(8, 4)).toBe("mid");
    expect(deviceTier(6, undefined)).toBe("mid");
    expect(deviceTier(8, 8)).toBe("high");
    expect(deviceTier(8, undefined)).toBe("high");
    expect(deviceTier(undefined, undefined)).toBe("na");
  });
});

describe("allowlisted dimensions", () => {
  it("connection", () => {
    expect(connectionClass("4g")).toBe("4g");
    expect(connectionClass("slow-2g")).toBe("slow-2g");
    expect(connectionClass("something|else")).toBe("na");
    expect(connectionClass(undefined)).toBe("na");
  });

  it("viewport", () => {
    expect(viewportClass(390)).toBe("phone");
    expect(viewportClass(1024)).toBe("tablet");
    expect(viewportClass(1440)).toBe("desktop");
  });

  it("platform", () => {
    expect(platformClass("android")).toBe("android");
    expect(platformClass("electron")).toBe("electron");
    expect(platformClass("web")).toBe("web");
    expect(platformClass(undefined)).toBe("web");
  });

  it("skin", () => {
    const has = (name: string) => ({ contains: (c: string) => c === name });
    expect(skinClass(has("ui-corporate"))).toBe("corporate");
    expect(skinClass(has("ui-cleaner-play"))).toBe("cleanerPlay");
    expect(skinClass(has("ui-play"))).toBe("play");
    expect(skinClass(has("ui-vibrant"))).toBe("vibrant");
    expect(skinClass(has("anything"))).toBe("default");
  });

  it("build", () => {
    expect(buildClass("abc12345")).toBe("abc12345");
    expect(buildClass("2.5.9")).toBe("2.5.9");
    expect(buildClass("a|b")).toBe("na");
    expect(buildClass("")).toBe("na");
  });
});

describe("cacheClass", () => {
  it("reads the entry script's transfer", () => {
    expect(cacheClass({ transferSize: 0, encodedBodySize: 2000000 })).toBe("warm");
    expect(cacheClass({ transferSize: 300, encodedBodySize: 2000000 })).toBe("warm");
    expect(cacheClass({ transferSize: 2000400, encodedBodySize: 2000000 })).toBe("cold");
    expect(cacheClass(undefined)).toBe("na");
  });
});

describe("buildKey", () => {
  it("has the fixed shape the documented query splits on", () => {
    expect(buildKey("lcp", 2400, dims, "/dashboard").split("|")).toEqual([
      "lv1",
      "lcp",
      "2500",
      "corporate",
      "mid",
      "4g",
      "web",
      "phone",
      "cold",
      "abc12345",
      "/dashboard",
    ]);
  });

  it("fits the column, and truncation only ever shortens the route", () => {
    const key = buildKey("lcp", 2400, dims, `/${"a".repeat(400)}`);
    expect(key.length).toBe(255);
    expect(key.split("|").slice(0, 10).join("|")).toBe(
      "lv1|lcp|2500|corporate|mid|4g|web|phone|cold|abc12345"
    );
  });
});

describe("toReports", () => {
  it("counts identical keys once and sends no histogram samples", () => {
    expect(toReports(["a", "b", "a"])).toEqual([
      {
        routes: [
          { k: "a", u: 2 },
          { k: "b", u: 1 },
        ],
      },
    ]);
  });

  it("stays inside the 40 routes per report the service accepts", () => {
    const keys = Array.from({ length: 95 }, (_, i) => `k${i}`);
    const reports = toReports(keys);
    expect(reports.map((r) => r.routes.length)).toEqual([40, 40, 15]);
    // The server reads samples from `s`. Its absence is what keeps these out of the
    // histogram the server and network charts read.
    expect(JSON.stringify(reports)).not.toContain('"s"');
  });
});

describe("visitRows: one visit, one row", () => {
  const bin = (row: string) => row.split("|").slice(1, 3).join("|");

  it("sends nothing more after hide, return, tap, hide when nothing got worse", () => {
    const visit = newVisit("/dashboard");
    addLayoutShift(visit, 100, 1);
    addInteraction(visit, 40);
    expect(visitRows(visit, dims).map(bin)).toEqual(["inp|50", "cls|1000"]);
    addInteraction(visit, 30);
    expect(visitRows(visit, dims)).toEqual([]);
    expect(visitRows(visit, dims)).toEqual([]);
  });

  it("still reports a clean visit once, as zero", () => {
    const visit = newVisit("/dashboard");
    expect(visitRows(visit, dims).map(bin)).toEqual(["cls|0"]);
    expect(visitRows(visit, dims)).toEqual([]);
  });

  it("stays quiet when a value grows inside its bin", () => {
    const visit = newVisit("/dashboard");
    addInteraction(visit, 210);
    visitRows(visit, dims);
    addInteraction(visit, 240);
    expect(visitRows(visit, dims)).toEqual([]);
  });

  it("replaces the earlier row when a value moves to a higher bin", () => {
    const visit = newVisit("/dashboard");
    addInteraction(visit, 40);
    const [first] = visitRows(visit, dims);
    addInteraction(visit, 900);
    const later = visitRows({ ...visit }, { ...dims, conn: "3g" });
    expect(later.map(bin)).toEqual(["inp-|50", "inp|1000"]);
    // The cancelling row matches the earlier one exactly, even if a dimension moved.
    expect(later[0]).toBe(cancelKey(first!));
    expect(later[1]).toContain("|3g|");
  });

  it("nets to one row per visit however many times the tab comes back", () => {
    const visit = newVisit("/dashboard");
    const rows: string[] = [];
    for (const duration of [40, 90, 90, 450, 450, 2000]) {
      addInteraction(visit, duration);
      rows.push(...visitRows(visit, dims));
    }
    const net = new Map<string, number>();
    for (const row of rows.filter((r) => r.includes("|inp"))) {
      const [, metric, value] = row.split("|");
      const sign = metric!.endsWith("-") ? -1 : 1;
      net.set(value!, (net.get(value!) ?? 0) + sign);
    }
    expect(Array.from(net).filter(([, count]) => count !== 0)).toEqual([["2000", 1]]);
  });

  it("keeps the burst going across a return, so CLS is not reset by a hide", () => {
    const visit = newVisit("/dashboard");
    addLayoutShift(visit, 100, 0.06);
    expect(visitRows(visit, dims).map(bin)).toEqual(["cls|75"]);
    addLayoutShift(visit, 500, 0.06);
    expect(visitRows(visit, dims).map(bin)).toEqual(["cls-|75", "cls|150"]);
  });
});

describe("cancelKey", () => {
  it("only touches the metric, so the query can split it the same way", () => {
    expect(cancelKey(buildKey("cls", 100, dims, "/dashboard")).split("|")).toEqual([
      "lv1",
      "cls-",
      "100",
      "corporate",
      "mid",
      "4g",
      "web",
      "phone",
      "cold",
      "abc12345",
      "/dashboard",
    ]);
  });
});

describe("installLearnerRum in a stubbed browser", () => {
  const ENDPOINT = "https://api.example.org/rum";
  const PENDING = "vacademy.perf.rum.learner.pending";

  const memoryStorage = (seed: Record<string, string> = {}) => {
    const data = new Map(Object.entries(seed));
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  };

  interface Harness {
    fetchMock: ReturnType<typeof vi.fn>;
    local: ReturnType<typeof memoryStorage>;
    token: { value: string | null; failRead?: boolean };
    hide: () => Promise<void>;
    show: () => Promise<void>;
    shift: (value: number, startTime: number) => void;
    interact: (duration: number) => void;
    resolve: (routeId: string) => void;
    /** Rows of every POST so far, and the token each one carried. */
    posts: () => Array<{ auth: string; rows: string[] }>;
  }

  const setup = (initialToken: string | null): Harness => {
    const observers = new Map<string, (entries: unknown[]) => void>();
    const documentListeners: Array<() => void> = [];
    const routerListeners: Record<string, Array<(c: unknown) => void>> = {};
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
    const local = memoryStorage();
    const token: Harness["token"] = { value: initialToken };
    const doc = {
      visibilityState: "visible",
      documentElement: { classList: { contains: (c: string) => c === "ui-play" } },
      addEventListener: (_: string, fn: () => void) => void documentListeners.push(fn),
    };
    class FakeObserver {
      static supportedEntryTypes = ["largest-contentful-paint", "paint", "layout-shift", "event"];
      constructor(private readonly callback: (list: { getEntries(): unknown[] }) => void) {}
      observe(init: { type: string }) {
        observers.set(init.type, (entries) => this.callback({ getEntries: () => entries }));
      }
    }
    const win = { addEventListener: vi.fn(), innerWidth: 390 } as Record<string, unknown>;
    win.self = win;
    win.top = win;
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    vi.stubGlobal("PerformanceObserver", FakeObserver);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", memoryStorage({ "vacademy.perf.rum.learner": "y" }));
    vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
    vi.stubGlobal("performance", {
      now: () => 1000,
      getEntriesByType: () => [],
    });

    const matches = [{ routeId: "/dashboard/" }];
    installLearnerRum({
      endpoint: ENDPOINT,
      router: {
        subscribe: (event, listener) => {
          (routerListeners[event] ??= []).push(listener as (c: unknown) => void);
        },
        state: { matches },
      },
      isFetching: () => 0,
      getAccessToken: () =>
        token.failRead ? Promise.reject(new Error("storage")) : Promise.resolve(token.value),
      isTokenExpired: (t) => !t || t.startsWith("expired"),
      getInstituteId: () => "inst-1",
      getPlatform: () => "web",
      build: "abc12345",
    });

    const settle = () => vi.advanceTimersByTimeAsync(0);
    return {
      fetchMock,
      local,
      token,
      hide: async () => {
        doc.visibilityState = "hidden";
        documentListeners.forEach((fn) => fn());
        await settle();
      },
      show: async () => {
        doc.visibilityState = "visible";
        documentListeners.forEach((fn) => fn());
        await settle();
      },
      shift: (value, startTime) =>
        observers.get("layout-shift")!([{ value, startTime, hadRecentInput: false }]),
      interact: (duration) => observers.get("event")!([{ interactionId: 7, duration }]),
      resolve: (routeId) => {
        matches[0] = { routeId };
        routerListeners.onResolved!.forEach((fn) => fn({ pathChanged: true, hrefChanged: true }));
      },
      posts: () =>
        fetchMock.mock.calls.map((call: unknown) => {
          const init = (call as unknown as [string, RequestInit])[1];
          return {
            auth: (init.headers as Record<string, string>).Authorization!,
            rows: (JSON.parse(init.body as string) as { routes: Array<{ k: string }> }).routes.map(
              (r) => r.k
            ),
          };
        }),
    };
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const metricRows = (rows: string[], route: string) =>
    rows.filter((r) => r.endsWith(`|${route}`)).map((r) => r.split("|").slice(1, 3).join("|"));

  it("hide, return, tap, hide on one visit sends its cls once", async () => {
    const page = setup("good");
    await vi.advanceTimersByTimeAsync(0);
    page.resolve("/dashboard/");
    page.shift(1, 100);
    await page.hide();
    expect(metricRows(page.posts().flatMap((p) => p.rows), "/dashboard")).toContain("cls|1000");
    for (let i = 0; i < 5; i += 1) {
      await page.show();
      await page.hide();
    }
    const rows = page.posts().flatMap((p) => p.rows);
    expect(rows.filter((r) => r.includes("|cls"))).toHaveLength(1);
    expect(rows.some((r) => r.includes("|cls|0|"))).toBe(false);
    expect(page.posts()).toHaveLength(1);
  });

  it("a second visit to a screen gets its own row, after the first one has gone out", async () => {
    const page = setup("good");
    await vi.advanceTimersByTimeAsync(0);
    page.resolve("/dashboard/");
    await page.hide();
    await page.show();
    page.resolve("/referral/");
    page.resolve("/dashboard/");
    await page.hide();
    const rows = page.posts().flatMap((p) => p.rows);
    expect(metricRows(rows, "/dashboard").filter((m) => m === "cls|0")).toHaveLength(2);
    expect(metricRows(rows, "/referral")).toContain("cls|0");
  });

  it("uses the token the app refreshed, not an earlier copy", async () => {
    const page = setup("expired-old");
    await vi.advanceTimersByTimeAsync(0);
    page.resolve("/dashboard/");
    page.token.value = "rotated";
    await vi.advanceTimersByTimeAsync(0);
    await page.hide();
    expect(page.posts().map((p) => p.auth)).toEqual(["Bearer rotated"]);
  });

  it("never posts an expired token, and parks instead of losing the rows", async () => {
    const page = setup("expired-old");
    await vi.advanceTimersByTimeAsync(0);
    page.resolve("/dashboard/");
    await vi.advanceTimersByTimeAsync(0);
    await page.hide();
    expect(page.fetchMock).not.toHaveBeenCalled();
    expect(page.local.getItem(PENDING)).toContain("|cls|0|");
    // The next report after the token rotates carries what was parked.
    page.token.value = "rotated";
    await page.show();
    await page.hide();
    expect(page.posts().map((p) => p.auth)).toEqual(["Bearer rotated"]);
    expect(page.posts()[0]!.rows.some((r) => r.includes("|cls|0|"))).toBe(true);
    expect(page.local.getItem(PENDING)).toBeNull();
  });

  it("sends parked rows straight away when the read after a flush finds a fresh token", async () => {
    const page = setup("expired-old");
    await vi.advanceTimersByTimeAsync(0);
    page.resolve("/dashboard/");
    await vi.advanceTimersByTimeAsync(0);
    // The app refreshes between the last read and the tab going away.
    page.token.value = "rotated";
    await page.hide();
    expect(page.posts().map((p) => p.auth)).toEqual(["Bearer rotated"]);
    expect(page.local.getItem(PENDING)).toBeNull();
  });

  it("keeps earlier parked rows when more are parked, so a cancel keeps its pair", async () => {
    const page = setup(null);
    await vi.advanceTimersByTimeAsync(0);
    page.resolve("/dashboard/");
    page.interact(40);
    await page.hide();
    await page.show();
    page.interact(900);
    await page.hide();
    const parked = JSON.parse(page.local.getItem(PENDING)!) as { k: string[] };
    expect(metricRows(parked.k, "/dashboard")).toEqual(
      expect.arrayContaining(["inp|50", "inp-|50", "inp|1000"])
    );
    expect(page.fetchMock).not.toHaveBeenCalled();
  });

  it("survives a token read that fails", async () => {
    const page = setup("good");
    await vi.advanceTimersByTimeAsync(0);
    page.token.failRead = true;
    page.resolve("/dashboard/");
    await expect(page.hide()).resolves.toBeUndefined();
    await expect(page.show()).resolves.toBeUndefined();
  });

  it("a search-param change on one screen stays one visit", async () => {
    const page = setup("good");
    await vi.advanceTimersByTimeAsync(0);
    page.resolve("/dashboard/");
    page.shift(1, 100);
    page.resolve("/dashboard/");
    await page.hide();
    const rows = page.posts().flatMap((p) => p.rows);
    expect(metricRows(rows, "/dashboard").filter((m) => m.startsWith("cls|"))).toEqual(["cls|1000"]);
  });
});
