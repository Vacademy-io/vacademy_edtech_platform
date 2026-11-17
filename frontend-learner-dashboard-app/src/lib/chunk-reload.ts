/**
 * Handles the "Failed to fetch dynamically imported module" failure mode
 * that happens when a user's tab is older than the currently-deployed build:
 * the main bundle references hashed chunk filenames that no longer exist on
 * the CDN, so the lazy import 404s. The fix is to force a hard reload so the
 * browser pulls a fresh index.html and its current chunk references.
 *
 * A sessionStorage-backed budget prevents infinite reload loops in the rare
 * case that a deploy ships genuinely broken chunks.
 */

const RELOAD_KEY = "vacademy:chunk-reload-attempts";
const RELOAD_WINDOW_MS = 10_000;
const MAX_RELOADS = 2;

interface ReloadRecord {
  count: number;
  firstAt: number;
}

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const errObj = err as { name?: string; message?: string };
  const name = errObj.name ?? "";
  const message = errObj.message ?? (typeof err === "string" ? err : "");
  return (
    name === "ChunkLoadError" ||
    message.includes("Failed to fetch dynamically imported module") ||
    message.includes("Importing a module script failed") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("Unable to preload CSS")
  );
}

/**
 * Detects the React.lazy resolver crash where the dynamic import resolved
 * but the resulting module object was undefined — so React's internal
 * `moduleObject.default` access throws a TypeError. Observed after a deploy
 * when a stale tab fetches a chunk filename whose body was rewritten or
 * replaced (the request itself succeeds, so it does not surface as a
 * ChunkLoadError).
 *
 * Engine-specific message wording:
 *   - V8 (Chrome/Edge):   "Cannot read properties of undefined (reading 'default')"
 *   - SpiderMonkey (FF):  "can't access property \"default\" of undefined"
 *   - JSC (Safari):       "undefined is not an object (evaluating 'X.default')"
 */
export function isLazyResolverError(err: unknown): boolean {
  if (!err) return false;
  const errObj = err as { name?: string; message?: string };
  if (errObj.name !== "TypeError") return false;
  const message = errObj.message ?? "";
  return (
    /reading ['"]default['"]/.test(message) ||
    /property ['"]default['"] of undefined/.test(message) ||
    /evaluating ['"][^'"]*\.default['"]/.test(message)
  );
}

function readRecord(): ReloadRecord {
  try {
    const raw = sessionStorage.getItem(RELOAD_KEY);
    if (!raw) return { count: 0, firstAt: 0 };
    const parsed = JSON.parse(raw) as ReloadRecord;
    if (Date.now() - parsed.firstAt > RELOAD_WINDOW_MS) {
      return { count: 0, firstAt: 0 };
    }
    return parsed;
  } catch {
    return { count: 0, firstAt: 0 };
  }
}

function writeRecord(record: ReloadRecord): void {
  try {
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify(record));
  } catch {
    // Private-mode / quota errors — nothing we can do
  }
}

/** Matches an absolute asset URL embedded in a chunk-error message. */
const ASSET_URL_RE = /https?:\/\/[^\s'")]+?\.(?:js|mjs|css)(?:\?[^\s'")]*)?/gi;

/**
 * Pull the failing asset URL(s) out of a chunk error. Browsers put the URL in
 * the message for dynamic-import failures ("Failed to fetch dynamically
 * imported module: https://host/assets/foo-hash.js").
 */
function extractAssetUrls(err: unknown): string[] {
  const message =
    typeof err === "string"
      ? err
      : ((err as { message?: string } | null)?.message ?? "");
  if (!message) return [];
  const matches = message.match(ASSET_URL_RE);
  if (!matches) return [];
  return Array.from(new Set(matches)).filter((u) => {
    try {
      return new URL(u).origin === window.location.origin;
    } catch {
      return false;
    }
  });
}

/**
 * Re-request the failed assets with `cache: "reload"`, which bypasses the HTTP
 * cache and overwrites the stored entry with the real response.
 *
 * This is what makes the reload below actually work. When Pages cannot resolve
 * a chunk it answers with index.html under the .js URL, and public/_headers
 * matches the request path — so that HTML body lands in cache under a long
 * max-age. A plain location.reload() re-reads it and fails identically. See
 * functions/assets/[[path]].ts for the server-side half of this fix.
 */
function forceRevalidate(urls: string[]): Promise<unknown> {
  if (!urls.length || typeof fetch !== "function") return Promise.resolve();
  return Promise.all(
    urls.map((u) =>
      fetch(u, { cache: "reload", credentials: "same-origin" }).catch(
        () => undefined,
      ),
    ),
  );
}

/**
 * Reload the page, subject to a retry budget. Returns true if a reload was
 * triggered; false when the budget is exhausted and the caller should fall
 * back to a visible error UI.
 *
 * Also a no-op on Zoom-embed routes — the SDK fires unhandled rejections
 * during reconnect/visibilitychange that look like chunk errors but aren't;
 * reloading mid-meeting is a worse UX than letting the SDK self-recover.
 */
export function reloadForChunkError(err?: unknown): boolean {
  if (typeof window === "undefined") return false;
  if ((window as unknown as { __zoomMeetingActive?: boolean }).__zoomMeetingActive) {
    return false;
  }
  const path = window.location.pathname;
  if (
    path.includes("/live-session/host/") ||
    path.includes("/live-class/embed") ||
    path.includes("/live-class/classroom")
  ) {
    return false;
  }
  const record = readRecord();
  if (record.count >= MAX_RELOADS) {
    return false;
  }
  writeRecord({
    count: record.count + 1,
    firstAt: record.firstAt || Date.now(),
  });

  const urls = extractAssetUrls(err);
  if (!urls.length) {
    window.location.reload();
    return true;
  }

  // Purge first, then reload — with a ceiling so a hung request cannot leave
  // the user staring at a dead page.
  void forceRevalidate(urls).then(() => window.location.reload());
  window.setTimeout(() => window.location.reload(), 8000);
  return true;
}

/**
 * Install global listeners for dynamic-import failures so stale tabs recover
 * without reaching any route-level error boundary. Call once at app bootstrap.
 */
export function installChunkErrorHandler(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("vite:preloadError", (event) => {
    // Vite attaches the underlying error (which carries the failing URL) as
    // `payload`; pass it through so the purge knows what to re-fetch.
    const payload = (event as unknown as { payload?: unknown }).payload;
    if (reloadForChunkError(payload ?? event)) {
      event.preventDefault();
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (isChunkLoadError(event.reason) || isLazyResolverError(event.reason)) {
      if (reloadForChunkError(event.reason)) {
        event.preventDefault();
      }
    }
  });

  window.addEventListener("error", (event) => {
    if (
      isChunkLoadError(event.error) ||
      isChunkLoadError(event.message) ||
      isLazyResolverError(event.error)
    ) {
      if (reloadForChunkError(event.error ?? event.message)) {
        event.preventDefault();
      }
    }
  });
}
