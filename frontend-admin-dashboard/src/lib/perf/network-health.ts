/**
 * "Is the LMS slow, or is your connection slow?"
 *
 * Every request carries `Server-Timing: app;dur=<ms>` (emitted by the backend's
 * RequestTracingFilter). Comparing that against the total round trip lets us split
 * a slow experience into our time versus everything else, so a user can be told
 * which side to look at instead of just being told "it's slow".
 *
 * Two deliberate design choices, both about not lying:
 *
 * 1) The network verdict comes from the /perf/ping baseline, NOT from
 *    (total - server) on real requests. That subtraction includes response
 *    transfer, so a teacher downloading a 20MB report over hotel wifi would be
 *    reported as "network slow" when nothing is actually wrong with their
 *    connection. Ping is a fixed three-byte body, so its round trip is comparable
 *    over time and across users.
 *
 * 2) Nothing is reported until MIN_SAMPLES have accumulated, and every verdict is
 *    a MEDIAN, never a single request. One slow report export must not turn the
 *    indicator red — an indicator that cries wolf gets ignored exactly when it is
 *    finally right.
 *
 * Phase 1 keeps everything in memory. Nothing is sent anywhere.
 */

export type PerfVerdict = 'unknown' | 'healthy' | 'server-slow' | 'network-slow';

export interface PerfSnapshot {
    verdict: PerfVerdict;
    /** Median server processing time (ms) over the recent window, if known. */
    serverMs: number | null;
    /** Median ping round trip (ms) — our proxy for the user's network. */
    networkMs: number | null;
    /**
     * Median time spent waiting on third parties, when any request reported it.
     * Shown to explain a slow-feeling page that is nobody's fault locally — it is
     * never counted against `serverMs`.
     */
    externalMs: number | null;
    /** How many API samples the verdict is based on. */
    sampleCount: number;
    /** Requests whose response carried no Server-Timing (large responses / SSE). */
    unannotatedCount: number;

    // --- Detail below exists to make a complaint actionable ---------------
    // A median alone tells you THAT it was slow. To do anything about it you need
    // to know which call, how bad the worst one was, and exactly when — so the
    // window can be lined up against backend logs and deploys.

    /** Epoch ms of the newest sample, or null when nothing has been measured. */
    updatedAt: number | null;
    /** Epoch ms of the oldest sample still in the window. */
    windowStart: number | null;
    /** Worst single server timing in the window — the one worth investigating. */
    slowest: { routeKey: string; serverMs: number; at: number } | null;
    /** How many ping baselines the network figure rests on. */
    pingCount: number;
    /** Non-2xx responses in the window; slowness plus errors is a different story. */
    errorCount: number;
}

interface ApiSample {
    at: number;
    totalMs: number;
    serverMs: number | null;
    /** Third-party wait for this request, when the backend reported one. */
    externalMs: number | null;
    routeKey: string;
    status: number;
}

// ---------------------------------------------------------------------------
// Tuning. These are deliberately conservative: a false "your internet is slow"
// is worse than staying quiet, because it blames the user for our problem.
// ---------------------------------------------------------------------------

/** No verdict at all below this many API samples. */
const MIN_SAMPLES = 8;
/** Rolling window used for every median. */
const WINDOW = 20;
/** Ring buffer size. */
const MAX_SAMPLES = 60;
/** Median server time above this reads as "our fault". */
export const SERVER_SLOW_MS = 1500;
/** Median ping RTT above this reads as "their connection". */
export const NETWORK_SLOW_MS = 700;
/** Samples older than this are stale — a network can recover. */
const SAMPLE_TTL_MS = 5 * 60 * 1000;
/** How often to re-measure the network baseline while the tab is visible. */
const PING_INTERVAL_MS = 60_000;
/** A ping slower than this counts as "no answer" rather than a huge number. */
const PING_TIMEOUT_MS = 8000;

const apiSamples: ApiSample[] = [];

/**
 * Separate from the ring buffer above. The ring buffer answers "how are things right
 * now" for the pill and is pruned by age; this accumulates everything since the last
 * report so nothing is lost between sends. Drained by the RUM reporter.
 */
const pendingRoutes = new Map<string, { n: number; u: number; s: number[] }>();
const pendingPings: number[] = [];
/** Ceilings so a long-lived tab cannot grow these without bound. */
const MAX_PENDING_ROUTES = 40;
const MAX_PENDING_SAMPLES_PER_ROUTE = 200;
const MAX_PENDING_PINGS = 60;
const pingSamples: { at: number; rttMs: number }[] = [];
let unannotatedCount = 0;
const listeners = new Set<() => void>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collapse a concrete URL into a route template.
 *
 * This runs before anything is recorded, for two reasons: raw URLs carry IDs and
 * sometimes emails (so keeping them would leak identifiers into telemetry), and
 * unique-per-request keys make cardinality explode the moment this is aggregated
 * server-side in Phase 2.
 */
export function routeKeyFromUrl(rawUrl: string): string {
    try {
        // Tolerate both absolute and relative URLs.
        const path = rawUrl.startsWith('http')
            ? new URL(rawUrl).pathname
            : rawUrl.split('?')[0] || rawUrl;

        return path
            .split('/')
            .map((seg) => {
                if (!seg) return seg;
                if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg))
                    return ':id';
                if (/^\d+$/.test(seg)) return ':n';
                // Long opaque tokens (base64-ish ids, hashes).
                if (seg.length > 24 && !seg.includes('.')) return ':id';
                if (seg.includes('@')) return ':email';
                return seg;
            })
            .join('/');
    } catch {
        return 'unknown';
    }
}

/**
 * Parse `ext;dur=2035` — time the request spent waiting on a third party (the
 * telephony provider dialling a phone, BBB creating a room, an LLM answering).
 * Deliberately NOT part of the verdict: it is real latency the user feels, but it
 * is not us being slow, and calling it ours is what made the indicator report
 * "Vacademy is slow" while the platform was serving p50 16ms.
 */
export function parseExternalTiming(headerValue: string | undefined | null): number | null {
    if (!headerValue) return null;
    const m = /(?:^|,)\s*ext;dur=([\d.]+)/i.exec(headerValue);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
}

/** Parse `app;dur=42` out of a Server-Timing header value. */
export function parseServerTiming(headerValue: string | undefined | null): number | null {
    if (!headerValue) return null;
    const m = /(?:^|,)\s*app;dur=([\d.]+)/i.exec(headerValue);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
}

function median(values: number[]): number | null {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function prune() {
    const cutoff = Date.now() - SAMPLE_TTL_MS;
    while (apiSamples.length && apiSamples[0]!.at < cutoff) apiSamples.shift();
    while (pingSamples.length && pingSamples[0]!.at < cutoff) pingSamples.shift();
    while (apiSamples.length > MAX_SAMPLES) apiSamples.shift();
    while (pingSamples.length > MAX_SAMPLES) pingSamples.shift();
}

function notify() {
    listeners.forEach((fn) => {
        try {
            fn();
        } catch {
            // A broken subscriber must not break measurement.
        }
    });
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export function recordApiSample(sample: {
    url: string;
    totalMs: number;
    serverTimingHeader?: string | null;
    status: number;
}) {
    try {
        // Never measure our own telemetry. Recording the RUM upload would feed its
        // own latency back into the next report — a loop that inflates every number
        // it reports and grows with each cycle.
        if (sample.url.includes('/v1/perf/')) return;

        const serverMs = parseServerTiming(sample.serverTimingHeader);
        // Absence means "the response could not be annotated" — never "the server
        // was fast". This should now be rare (the backend stamps the header at
        // commit time, covering large bodies and SSE too), but counting these
        // separately keeps them out of the median rather than biasing it downward
        // toward zero, which would make us look faster than we are.
        if (serverMs === null) unannotatedCount++;

        const routeKey = routeKeyFromUrl(sample.url);

        apiSamples.push({
            at: Date.now(),
            totalMs: sample.totalMs,
            serverMs,
            externalMs: parseExternalTiming(sample.serverTimingHeader),
            routeKey,
            status: sample.status,
        });

        let pending = pendingRoutes.get(routeKey);
        if (!pending && pendingRoutes.size < MAX_PENDING_ROUTES) {
            pending = { n: 0, u: 0, s: [] };
            pendingRoutes.set(routeKey, pending);
        }
        if (pending) {
            pending.n++;
            if (serverMs === null) pending.u++;
            else if (pending.s.length < MAX_PENDING_SAMPLES_PER_ROUTE)
                pending.s.push(Math.round(serverMs));
        }

        prune();
        notify();
    } catch {
        // Observability must never break the request it observes.
    }
}

/**
 * Measure the network baseline.
 *
 * Uses a bare fetch rather than the app's axios instance on purpose: no
 * Authorization header (so the backend does no token work and this stays a pure
 * network measurement), no auth interceptors, and no chance of tripping the
 * refresh-token or forced-logout paths from a background timer.
 */
export async function measurePing(baseUrl: string): Promise<number | null> {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
        // Cache-buster: a cached ping returns instantly without touching the
        // network, which would silently make the baseline meaningless.
        await fetch(`${baseUrl}/admin-core-service/v1/perf/ping?t=${Date.now()}`, {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal,
        });
        const rttMs = performance.now() - started;
        pingSamples.push({ at: Date.now(), rttMs });
        if (pendingPings.length < MAX_PENDING_PINGS) pendingPings.push(Math.round(rttMs));
        prune();
        notify();
        return rttMs;
    } catch {
        // Offline, aborted, or blocked. Not a measurement — record nothing rather
        // than recording a fake huge number.
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export function getSnapshot(): PerfSnapshot {
    prune();

    const recentApi = apiSamples.slice(-WINDOW);
    const serverValues = recentApi.map((s) => s.serverMs).filter((v): v is number => v !== null);
    const serverMs = median(serverValues);
    const networkMs = median(pingSamples.slice(-WINDOW).map((p) => p.rttMs));
    // Median over the requests that actually had a third-party wait, not over all
    // of them — averaging in the zeroes would hide a genuine 2s provider call.
    const externalMs = median(
        recentApi.map((s) => s.externalMs).filter((v): v is number => v !== null && v > 0)
    );

    let verdict: PerfVerdict = 'unknown';
    if (recentApi.length >= MIN_SAMPLES) {
        const networkBad = networkMs !== null && networkMs > NETWORK_SLOW_MS;
        const serverBad = serverMs !== null && serverMs > SERVER_SLOW_MS;

        // Server first when both are bad: if our backend is genuinely slow, saying
        // "your connection" would be blaming the user for our outage.
        if (serverBad) verdict = 'server-slow';
        else if (networkBad) verdict = 'network-slow';
        else verdict = 'healthy';
    }

    let slowest: PerfSnapshot['slowest'] = null;
    for (const sample of recentApi) {
        if (sample.serverMs === null) continue;
        if (!slowest || sample.serverMs > slowest.serverMs) {
            slowest = { routeKey: sample.routeKey, serverMs: sample.serverMs, at: sample.at };
        }
    }

    const times = [...recentApi.map((s) => s.at), ...pingSamples.slice(-WINDOW).map((p) => p.at)];

    return {
        verdict,
        serverMs,
        networkMs,
        externalMs,
        sampleCount: recentApi.length,
        unannotatedCount,
        updatedAt: times.length ? Math.max(...times) : null,
        windowStart: times.length ? Math.min(...times) : null,
        slowest,
        pingCount: pingSamples.length,
        errorCount: recentApi.filter((s) => s.status >= 400 || s.status === 0).length,
    };
}

/**
 * A pasteable diagnostic block.
 *
 * The point is that a user reporting "it's slow" can hand over something with exact
 * timestamps in it. Without those, the report reaches us as "it was slow this
 * afternoon" and nobody can line it up against logs, a deploy, or a spike — which is
 * precisely how the 2026-08-22 incident ended up being reconstructed from container
 * logs that had already rotated.
 */
export function buildDiagnostics(): string {
    const snap = getSnapshot();
    const iso = (t: number | null) => (t === null ? 'n/a' : new Date(t).toISOString());
    const ms = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v)}ms`);

    return [
        'Performance diagnostics',
        `verdict:      ${snap.verdict}`,
        `server(med):  ${ms(snap.serverMs)}`,
        `network(med): ${ms(snap.networkMs)}`,
        snap.slowest
            ? `slowest:      ${ms(snap.slowest.serverMs)} ${snap.slowest.routeKey} at ${iso(snap.slowest.at)}`
            : 'slowest:      n/a',
        `window:       ${iso(snap.windowStart)} .. ${iso(snap.updatedAt)}`,
        `samples:      ${snap.sampleCount} requests, ${snap.pingCount} pings, ${snap.errorCount} errors, ${snap.unannotatedCount} unannotated`,
        `page:         ${typeof window === 'undefined' ? 'n/a' : window.location.pathname}`,
        `agent:        ${typeof navigator === 'undefined' ? 'n/a' : navigator.userAgent}`,
        `generated:    ${new Date().toISOString()}`,
    ].join('\n');
}

export function subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/**
 * Start the periodic baseline. Only pings while the tab is visible — a background
 * tab pinging forever is pure waste, and its numbers would be throttled and
 * misleading anyway.
 */
export function startPingLoop(baseUrl: string): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const tick = async () => {
        if (stopped) return;
        if (typeof document === 'undefined' || !document.hidden) {
            await measurePing(baseUrl);
        }
        if (stopped) return;
        // Jitter so many tabs/users don't align into a synchronised burst.
        timer = setTimeout(tick, PING_INTERVAL_MS + Math.random() * 15_000);
    };

    void tick();

    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
}

/**
 * Hand over everything accumulated since the last call, and reset.
 *
 * Returns null when there is nothing to report, so the caller can skip the request
 * entirely rather than posting an empty payload every minute from an idle tab.
 */
export function drainPending(): {
    routes: { k: string; n: number; u: number; s: number[] }[];
    pings: number[];
} | null {
    if (!pendingRoutes.size && !pendingPings.length) return null;

    const routes = Array.from(pendingRoutes.entries()).map(([k, v]) => ({
        k,
        n: v.n,
        u: v.u,
        s: v.s,
    }));
    const pings = [...pendingPings];

    pendingRoutes.clear();
    pendingPings.length = 0;

    return { routes, pings };
}

/** Test/debug seam. */
export function __resetForTest() {
    apiSamples.length = 0;
    pingSamples.length = 0;
    pendingRoutes.clear();
    pendingPings.length = 0;
    unannotatedCount = 0;
}
