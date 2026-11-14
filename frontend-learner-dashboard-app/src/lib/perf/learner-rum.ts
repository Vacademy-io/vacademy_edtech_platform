/**
 * Real-user speed numbers for the learner app, by screen, skin, institute, device
 * tier and platform. How to read them: docs/LEARNER_RUM.md.
 *
 * WHERE IT GOES: the platform's own /admin-core-service/v1/perf/rum, the same
 * first-party endpoint and table (perf_rum_minute) the admin dashboard reports to. No
 * third party sees the report, and nothing here calls Sentry from the browser: no event,
 * span, replay or log. It is still an authenticated request to admin_core, whose own
 * Sentry samples requests like any other API call, so the backend side of this has a
 * cost: see "Sentry cost" in docs/LEARNER_RUM.md.
 *
 * WHAT IS SENT: one short key per measurement and nothing else. The key holds fixed
 * words from allowlists below, a rounded number, a build id and a route TEMPLATE
 * (`/study-library/courses/$id`), never a URL, id, query or hash. There is no user id,
 * name, email, token or session id in the body. The institute goes in the `clientId`
 * header, as on every other API call. The Authorization header is there because the
 * endpoint requires it; it never reaches a stored row.
 *
 * HOW THE TABLE IS USED, because it looks odd at first:
 *  - The value is rounded to a bin and the bin is IN the key. The table's own histogram
 *    tops out at <=2000, <=5000, <=10000 ms, too coarse to tell 2.4 s from 4.9 s, while
 *    a count per key gives whatever resolution the bins below have.
 *  - The count is sent as `u`, stored in unannotated_count, and the histogram is left
 *    at zero. The admin server/network charts read that histogram, so a 4 s paint time
 *    can never show up there as 4 s of server time.
 *
 * ONE VISIT, ONE ROW: `inp` and `cls` go out when the tab is hidden, and the learner may
 * come back to the same visit. Rows carry no visit id, so nothing can be corrected after
 * collection. A later report says nothing unless the value moved to a higher bin, and
 * then it also sends the earlier row with `-` after the metric, which the query subtracts.
 *
 * It must never affect the app: every entry point swallows its errors, the observers
 * only copy a number or two, and failures are dropped, never retried.
 *
 * Differences from the web-vitals library, which is not a dependency here: INP is the
 * worst interaction per screen visit (identical below 50 interactions, an upper bound
 * above that). A browser that lacks an entry type, mainly Safari, does not report that
 * metric, and browsers report no LCP at all for some screens, so `settle` covers those.
 */

export type RumMetric =
  | "lcp"
  | "inp"
  | "cls"
  | "fcp"
  | "ttfb"
  | "settle" // first load: page start to the first screen having no query in flight
  | "nav" // tap to the new screen being committed
  | "navs" // tap to that screen having no query in flight
  | "navq" // as nav, for a search-param-only change on the same screen
  | "navqs"; // as navs, for a search-param-only change on the same screen

export interface RumDims {
  skin: string;
  tier: string;
  conn: string;
  platform: string;
  viewport: string;
  cache: string;
  build: string;
}

/** Fraction of tab sessions that report at all. See docs/LEARNER_RUM.md for the cost. */
const SAMPLE_RATE = 0.2;
const SAMPLING_KEY = "vacademy.perf.rum.learner";
/** A logged-out visit cannot post (the endpoint is authenticated), so one is parked. */
const PENDING_KEY = "vacademy.perf.rum.learner.pending";

const KEY_VERSION = "lv1";
/** PerfRumService ignores routes past 40 in one report. */
const MAX_KEYS_PER_REPORT = 40;
/** Hard ceiling per page load, so a tab left open for days stays cheap. */
const MAX_KEYS_PER_PAGE_LOAD = 200;
const ROUTE_KEY_MAX_LENGTH = 255;
/** A navigation only counts as a tap if input came this recently. */
const TAP_WINDOW_MS = 1000;
const SETTLE_POLL_MS = 150;
const SETTLE_CAP_MS = 30000;
/** Measurements from before the first screen resolved, if it never did. */
const UNRESOLVED_ROUTE = "unresolved";

/** Upper bounds. A value is reported as the first bound it does not exceed. */
const TIME_BINS_MS = [
  50, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1250, 1500, 1750, 2000, 2500, 3000, 3500,
  4000, 5000, 6000, 8000, 10000, 15000, 20000, 30000, 60000,
];
/** Layout shift score multiplied by 1000: 100 is the 0.1 target. */
const CLS_BINS = [0, 5, 10, 25, 50, 75, 100, 150, 200, 250, 300, 500, 1000, 2000, 5000];

export const binFor = (metric: RumMetric, value: number): number => {
  const bins = metric === "cls" ? CLS_BINS : TIME_BINS_MS;
  for (const bound of bins) {
    if (value <= bound) return bound;
  }
  return bins[bins.length - 1]!;
};

export const deviceTier = (cores?: number, memoryGb?: number): string => {
  const hasCores = typeof cores === "number" && cores > 0;
  const hasMemory = typeof memoryGb === "number" && memoryGb > 0;
  if (!hasCores && !hasMemory) return "na";
  if ((hasMemory && memoryGb! <= 2) || (hasCores && cores! <= 4)) return "low";
  if ((hasMemory && memoryGb! <= 4) || (hasCores && cores! <= 6)) return "mid";
  return "high";
};

export const connectionClass = (effectiveType?: string): string =>
  effectiveType === "4g" || effectiveType === "3g" || effectiveType === "2g" || effectiveType === "slow-2g"
    ? effectiveType
    : "na";

export const viewportClass = (width: number): string =>
  width <= 767 ? "phone" : width <= 1024 ? "tablet" : "desktop";

export const platformClass = (platform?: string): string =>
  platform === "ios" || platform === "android" || platform === "electron" ? platform : "web";

export const skinClass = (classes: { contains(name: string): boolean }): string => {
  if (classes.contains("ui-corporate")) return "corporate";
  if (classes.contains("ui-fun")) return "fun";
  if (classes.contains("ui-cleaner-play")) return "cleanerPlay";
  if (classes.contains("ui-play")) return "play";
  if (classes.contains("ui-vibrant")) return "vibrant";
  return "default";
};

/** Whether the app's entry script came from the browser cache on this load. */
export const cacheClass = (entry?: { transferSize?: number; encodedBodySize?: number }): string => {
  if (!entry || typeof entry.transferSize !== "number") return "na";
  if (entry.transferSize === 0) return "warm";
  // A 304 costs headers only, so it transfers less than the file it validated.
  return (entry.encodedBodySize ?? 0) > entry.transferSize ? "warm" : "cold";
};

export const buildClass = (build: string): string =>
  /^[a-z0-9.]{1,12}$/i.test(build) ? build : "na";

/**
 * Route ids come from the generated route tree, so they are templates by construction.
 * This is the second lock on the rule that matters most here: anything that does not
 * look like one (a query, an address, a long number, a uuid) is reported as "other".
 */
export const routeTemplate = (routeId?: string | null): string => {
  if (!routeId) return "other";
  if (routeId === "__root__") return routeId;
  if (!/^\/[A-Za-z0-9_$./-]*$/.test(routeId)) return "other";
  if (/\d{5,}|[0-9a-f]{8}-[0-9a-f]{4}/i.test(routeId)) return "other";
  const trimmed = routeId.length > 1 ? routeId.replace(/\/+$/, "") : routeId;
  return trimmed || "/";
};

/** The route template goes last so a truncation can only ever shorten the route. */
export const buildKey = (metric: RumMetric, value: number, dims: RumDims, route: string): string =>
  [
    KEY_VERSION,
    metric,
    binFor(metric, value),
    dims.skin,
    dims.tier,
    dims.conn,
    dims.platform,
    dims.viewport,
    dims.cache,
    dims.build,
    route,
  ]
    .join("|")
    .slice(0, ROUTE_KEY_MAX_LENGTH);

/** The row that cancels an earlier one: same dimensions, with `-` after the metric. */
export const cancelKey = (key: string): string => {
  const parts = key.split("|");
  parts[1] = `${parts[1]}-`;
  return parts.join("|").slice(0, ROUTE_KEY_MAX_LENGTH);
};

/** Same keys collapse into one count. Field names follow PerfRumReportDTO.RoutePerf. */
export const toReports = (keys: string[]): Array<{ routes: Array<{ k: string; u: number }> }> => {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  const routes = Array.from(counts, ([k, u]) => ({ k, u }));
  const reports: Array<{ routes: Array<{ k: string; u: number }> }> = [];
  for (let i = 0; i < routes.length; i += MAX_KEYS_PER_REPORT) {
    reports.push({ routes: routes.slice(i, i + MAX_KEYS_PER_REPORT) });
  }
  return reports;
};

/** One stay on one screen. It outlives a hidden tab: coming back continues the same stay. */
export interface Visit {
  route: string;
  worstInteraction: number | null;
  cls: number;
  windowValue: number;
  windowFirst: number;
  windowLast: number;
  /** The row each metric last went out as. */
  sent: { inp?: string; cls?: string };
}

export const newVisit = (route: string): Visit => ({
  route,
  worstInteraction: null,
  cls: 0,
  windowValue: 0,
  windowFirst: 0,
  windowLast: 0,
  sent: {},
});

/** Same grouping as the CLS definition: a burst ends after a 1 s gap or at 5 s. */
export const addLayoutShift = (visit: Visit, startTime: number, value: number): void => {
  const continues =
    visit.windowValue > 0 &&
    startTime - visit.windowLast < 1000 &&
    startTime - visit.windowFirst < 5000;
  if (continues) {
    visit.windowValue += value;
  } else {
    visit.windowValue = value;
    visit.windowFirst = startTime;
  }
  visit.windowLast = startTime;
  visit.cls = Math.max(visit.cls, visit.windowValue);
};

export const addInteraction = (visit: Visit, duration: number): void => {
  visit.worstInteraction = Math.max(visit.worstInteraction ?? 0, duration);
};

/** What this visit has to say now that it has not already said. See ONE VISIT, ONE ROW. */
export const visitRows = (visit: Visit, dims: RumDims): string[] => {
  const rows: string[] = [];
  const report = (metric: "inp" | "cls", value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    const earlier = visit.sent[metric];
    if (earlier !== undefined) {
      if (binFor(metric, value) <= Number(earlier.split("|")[2])) return;
      rows.push(cancelKey(earlier));
    }
    const key = buildKey(metric, value, dims, visit.route);
    rows.push(key);
    visit.sent[metric] = key;
  };
  if (visit.worstInteraction !== null) report("inp", visit.worstInteraction);
  report("cls", Math.round(visit.cls * 1000));
  return rows;
};

// ---------------------------------------------------------------------------
// Browser side. Everything below only runs in the sampled sessions.
// ---------------------------------------------------------------------------

/** The parts of the router this uses, so its heavy generics stay out of this file. */
export interface RumRouter {
  subscribe(
    event: "onBeforeLoad" | "onResolved",
    listener: (change: { pathChanged: boolean; hrefChanged: boolean }) => void
  ): unknown;
  state: { matches: Array<{ routeId: string }> };
}

export interface RumOptions {
  endpoint: string;
  router: RumRouter;
  isFetching: () => number;
  /** The same read the app's API calls use, so it sees a token they refreshed. */
  getAccessToken: () => Promise<string | null>;
  isTokenExpired: (token: string | null) => boolean;
  getInstituteId: () => string | null | undefined;
  getPlatform: () => string;
  build: string;
}

interface PendingNav {
  startedAt: number;
  sameScreen: boolean;
}

/** Wrapped so a bad entry in one callback cannot reach the caller. */
const guarded =
  <A extends unknown[]>(fn: (...args: A) => void) =>
  (...args: A): void => {
    try {
      fn(...args);
    } catch {
      // never let telemetry break the app
    }
  };

const isSampledSession = (): boolean => {
  try {
    const stored = sessionStorage.getItem(SAMPLING_KEY);
    if (stored === "y") return true;
    if (stored === "n") return false;
    const sampled = Math.random() < SAMPLE_RATE;
    sessionStorage.setItem(SAMPLING_KEY, sampled ? "y" : "n");
    return sampled;
  } catch {
    // Storage is off. A missing sample costs a data point, nothing more.
    return false;
  }
};

/**
 * The token as last read. The read is async, and a page going away cannot wait for it, so
 * a report uses this copy. An expired copy parks the report instead of sending a request
 * that is bound to fail; the read that follows every flush lets it go out straight away
 * if the app has refreshed the token since.
 */
let latestToken: string | null = null;

const usableToken = (options: RumOptions): string | null =>
  latestToken && !options.isTokenExpired(latestToken) ? latestToken : null;

const readToken = (options: RumOptions): Promise<void> =>
  Promise.resolve()
    .then(() => options.getAccessToken())
    .then((token) => {
      latestToken = token;
    })
    .catch(() => {
      // Keep the copy we have. An expired one is caught when it is used.
    });

const post = (options: RumOptions, token: string, keys: string[], instituteId?: string | null): void => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (instituteId) headers.clientId = instituteId;
  for (const report of toReports(keys)) {
    // Keepalive fetch rather than sendBeacon: it survives the page going away in the
    // same way, and sendBeacon cannot carry the Authorization header. A bare fetch also
    // keeps this out of the axios refresh and logout handling.
    void fetch(options.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(report),
      keepalive: true,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }).catch(() => {
      // Dropped on purpose. Retrying during an outage adds load when it hurts most.
    });
  }
};

const readParked = (): { i: string | null; k: string[] } => {
  try {
    const parked = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}") as {
      i?: string | null;
      k?: unknown;
    };
    return {
      i: parked.i ?? null,
      k: Array.isArray(parked.k)
        ? parked.k.filter((k): k is string => typeof k === "string" && k.startsWith(`${KEY_VERSION}|`))
        : [],
    };
  } catch {
    return { i: null, k: [] };
  }
};

/** Adds to what is there: a later row may cancel an earlier one, so both have to survive. */
const park = (keys: string[], instituteId?: string | null): void => {
  try {
    const earlier = readParked();
    localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({
        i: instituteId ?? earlier.i,
        k: [...earlier.k, ...keys].slice(0, MAX_KEYS_PER_REPORT),
      })
    );
  } catch {
    // Storage is off: this visit simply is not counted.
  }
};

const drainParked = guarded((options: RumOptions): void => {
  const token = usableToken(options);
  if (!token) return;
  const parked = readParked();
  localStorage.removeItem(PENDING_KEY);
  if (parked.k.length) post(options, token, parked.k, parked.i ?? options.getInstituteId());
});

const readDims = (options: RumOptions, cache: string): RumDims => {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string };
  };
  return {
    skin: skinClass(document.documentElement.classList),
    tier: deviceTier(nav.hardwareConcurrency, nav.deviceMemory),
    conn: connectionClass(nav.connection?.effectiveType),
    platform: platformClass(options.getPlatform()),
    viewport: viewportClass(window.innerWidth),
    cache,
    build: buildClass(options.build),
  };
};

const readCache = (): string => {
  try {
    const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    return cacheClass(
      entries.find((e) => e.initiatorType === "script" && /\/assets\/index-[^/]*\.js/.test(e.name))
    );
  } catch {
    return "na";
  }
};

const observe = (
  type: string,
  onEntries: (entries: PerformanceEntry[]) => void,
  extra?: Record<string, unknown>
): void => {
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
    new PerformanceObserver(guarded((list: PerformanceObserverEntryList) => {
      onEntries(list.getEntries());
    })).observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
  } catch {
    // Unsupported browser: that metric is simply absent.
  }
};

const start = (options: RumOptions): void => {
  void readToken(options);
  const startedHidden = document.visibilityState === "hidden";
  /** Screens already left whose rows have not gone out yet. */
  const finished: Visit[] = [];
  let current: Visit | null = null;
  const navKeys: Array<{ metric: RumMetric; value: number; route: string }> = [];

  let currentRoute: string | null = null;
  let firstLoadRoute: string | null = null;
  let firstLoadSent = false;
  let lcp: number | null = null;
  let fcp: number | null = null;
  let keysSent = 0;
  let lastInputAt = Number.NEGATIVE_INFINITY;
  let pendingNav: PendingNav | null = null;
  let settleToken = 0;

  const routeNow = (): string => {
    const matches = options.router.state.matches;
    return routeTemplate(matches[matches.length - 1]?.routeId);
  };

  const currentVisit = (): Visit => (current ??= newVisit(UNRESOLVED_ROUTE));

  observe("largest-contentful-paint", (entries) => {
    const last = entries[entries.length - 1];
    if (!last || startedHidden) return;
    lcp = last.startTime;
    if (currentRoute) firstLoadRoute = currentRoute;
  });

  observe("paint", (entries) => {
    const entry = entries.find((e) => e.name === "first-contentful-paint");
    if (entry && !startedHidden) fcp = entry.startTime;
  });

  observe(
    "layout-shift",
    (entries) => {
      const visit = currentVisit();
      for (const raw of entries) {
        const shift = raw as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) addLayoutShift(visit, shift.startTime, shift.value);
      }
    }
  );

  observe(
    "event",
    (entries) => {
      for (const raw of entries) {
        const event = raw as PerformanceEntry & { interactionId?: number };
        if (!event.interactionId) continue;
        addInteraction(currentVisit(), event.duration);
      }
    },
    // The lowest the browser allows, so a fast interaction is counted as fast rather
    // than missing, which would make the percentile look worse than it is.
    { durationThreshold: 16 }
  );

  // Passive and capture-phase: this only notes the time, and cannot block a tap.
  const noteInput = (event: Event) => {
    lastInputAt = event.timeStamp;
  };
  window.addEventListener("pointerdown", noteInput, { capture: true, passive: true });
  window.addEventListener("keydown", noteInput, { capture: true, passive: true });

  /**
   * Two quiet polls in a row, so the gap between one query finishing and the next one
   * starting does not read as settled. Abandoned when the tab goes away or another tap
   * starts, because a timer in a hidden tab measures nothing the learner saw.
   */
  const waitForSettled = (metric: RumMetric, startedAt: number, route: string) => {
    const token = settleToken;
    let quietSince: number | null = null;
    const check = guarded(() => {
      if (token !== settleToken || document.visibilityState === "hidden") return;
      const now = performance.now();
      if (options.isFetching() > 0) {
        quietSince = null;
      } else if (quietSince === null) {
        quietSince = now;
      } else {
        navKeys.push({ metric, value: quietSince - startedAt, route });
        return;
      }
      if (now - startedAt >= SETTLE_CAP_MS) {
        navKeys.push({ metric, value: SETTLE_CAP_MS, route });
        return;
      }
      setTimeout(check, SETTLE_POLL_MS);
    });
    setTimeout(check, SETTLE_POLL_MS);
  };

  // onBeforeLoad rather than onBeforeNavigate: the router skips the latter for the first
  // navigation after any redirect, which here is often the learner's first tap.
  options.router.subscribe(
    "onBeforeLoad",
    guarded((change: { hrefChanged: boolean; pathChanged: boolean }) => {
      if (!change.hrefChanged) return;
      // Redirects and code-driven URL changes have no tap to measure from. They also do
      // not cancel a tap being timed: they are part of how long that tap took.
      if (performance.now() - lastInputAt > TAP_WINDOW_MS) return;
      settleToken += 1;
      pendingNav = { startedAt: lastInputAt, sameScreen: !change.pathChanged };
    })
  );

  options.router.subscribe(
    "onResolved",
    guarded(() => {
      const route = routeNow();
      // What happened before the first screen resolved is that screen's load. A
      // search-param change on the same screen is not a new visit to it.
      if (!current || current.route === UNRESOLVED_ROUTE) {
        currentVisit().route = route;
      } else if (current.route !== route) {
        if (finished.length < MAX_KEYS_PER_PAGE_LOAD) finished.push(current);
        current = newVisit(route);
      }
      currentRoute = route;
      void readToken(options);

      const visible = document.visibilityState !== "hidden";
      if (!firstLoadRoute) {
        firstLoadRoute = route;
        if (visible && !startedHidden) waitForSettled("settle", 0, route);
      }

      const nav = pendingNav;
      pendingNav = null;
      if (nav && visible) {
        navKeys.push({
          metric: nav.sameScreen ? "navq" : "nav",
          value: performance.now() - nav.startedAt,
          route,
        });
        waitForSettled(nav.sameScreen ? "navqs" : "navs", nav.startedAt, route);
      }
    })
  );

  const collect = (): string[] => {
    const dims = readDims(options, readCache());
    const keys: string[] = [];
    const add = (metric: RumMetric, value: number, route: string) => {
      if (Number.isFinite(value) && value >= 0) keys.push(buildKey(metric, value, dims, route));
    };

    if (!firstLoadSent) {
      firstLoadSent = true;
      const route = firstLoadRoute ?? currentRoute ?? UNRESOLVED_ROUTE;
      if (lcp !== null) add("lcp", lcp, route);
      if (fcp !== null) add("fcp", fcp, route);
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (nav && nav.responseStart > 0) add("ttfb", nav.responseStart, route);
    }

    for (const visit of finished) keys.push(...visitRows(visit, dims));
    finished.length = 0;
    if (current) keys.push(...visitRows(current, dims));

    for (const nav of navKeys) add(nav.metric, nav.value, nav.route);
    navKeys.length = 0;

    return keys;
  };

  const deliver = () => {
    drainParked(options);
    const keys = collect();
    if (!keys.length) return;
    const allowed = keys.slice(0, Math.max(0, MAX_KEYS_PER_PAGE_LOAD - keysSent));
    if (!allowed.length) return;
    const instituteId = options.getInstituteId();
    const token = usableToken(options);
    if (token) {
      keysSent += allowed.length;
      post(options, token, allowed, instituteId);
    } else {
      park(allowed, instituteId);
    }
  };

  const flush = guarded(() => {
    deliver();
    void readToken(options).then(() => drainParked(options));
  });

  document.addEventListener(
    "visibilitychange",
    guarded(() => {
      if (document.visibilityState === "hidden") flush();
      else void readToken(options);
    })
  );
  // Safari does not reliably fire visibilitychange when a page is closed.
  window.addEventListener("pagehide", flush);
};

/** Call once at boot. Safe everywhere: it does nothing in an unsampled session. */
export const installLearnerRum = (options: RumOptions): void => {
  try {
    if (typeof window === "undefined" || window.self !== window.top) return;
    if (typeof PerformanceObserver === "undefined" || typeof fetch !== "function") return;
    // Not on the first tick, and independent of sampling: a visit parked while logged
    // out belongs to the session that sampled it, whatever this one decides.
    setTimeout(() => {
      void readToken(options).then(() => drainParked(options));
    }, 5000);
    if (isSampledSession()) start(options);
  } catch {
    // never let telemetry break the app
  }
};
