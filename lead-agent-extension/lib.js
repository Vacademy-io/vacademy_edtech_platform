// Pure helpers for the Vacademy Lead Agent extension.
// No chrome.* calls in this file, so everything here runs (and is tested) under plain Node.

export const DEFAULT_API_BASE = 'https://backend-stage.vacademy.io/ai-service';
export const API_PREFIX = '/lead-agent/v1';
export const DAILY_CAP = 300; // pages per local day
export const MAX_HTML_BYTES = 1_500_000; // spec: html <= 1.5 MB
export const TICK_BUDGET_MS = 25_000; // finish a tick before the service worker can be stopped
export const RESULT_MARGIN_MS = 2_500; // time kept back to post a result
export const MIN_TASK_MS = 4_000; // do not start a fetch with less time than this
export const MIN_TAB_MS = 8_000; // do not start a tab render with less time than this
export const DEFAULT_TASK_TIMEOUT_MS = 20_000;
export const TAB_SETTLE_MS = 2_500; // wait after "complete" so scripts can build the page
export const HELLO_EVERY_MS = 10 * 60_000;
export const FAILURES_BEFORE_BACKOFF = 5;
export const BACKOFF_MS = 10 * 60_000;
export const MAX_PARALLEL = 2;
export const RENDER_WINDOW_IDLE_MS = 5 * 60_000;

// Dashboard pages allowed to pair the extension by window.postMessage. Other *.vacademy.io pages
// (institute websites, learner apps) can carry third-party content, so they may NOT pair.
export const PAIR_PAGE_HOSTS = ['dash.vacademy.io'];

// ---------------------------------------------------------------------------------------------
// Hosts and URLs

export function isVacademyHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'vacademy.io' || h.endsWith('.vacademy.io');
}

/**
 * Validates and normalises the API base. Allowed: https://(*.)vacademy.io/... and http://localhost[:port]/...
 * (exactly what host_permissions cover). Returns the normalised base without a trailing slash, or null.
 */
export function normalizeApiBase(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash) return null;
  const host = u.hostname.toLowerCase();
  const okHttps = u.protocol === 'https:' && isVacademyHost(host) && (u.port === '' || u.port === '443');
  const okLocal = u.protocol === 'http:' && host === 'localhost';
  if (!okHttps && !okLocal) return null;
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.protocol}//${u.host}${path}`;
}

/** Origin of a page that may send VACADEMY_LEAD_AGENT_PAIR (the dashboard, or localhost for development). */
export function isPairPageOrigin(origin) {
  let u;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol === 'http:' && host === 'localhost') return true;
  return u.protocol === 'https:' && PAIR_PAGE_HOSTS.includes(host);
}

/** Pairing codes are url-safe random tokens (32 bytes -> 43 chars). Reject anything that is not. */
export function isPlausibleToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{16,256}$/.test(token);
}

/** The "site" two tasks must not share at the same time: lower-case hostname without a leading www. */
export function siteKey(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return String(url);
  }
}

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home', '.corp', '.home.arpa'];
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

function privateIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null; // not an IPv4 literal
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast + reserved
  );
}

/**
 * Defence in depth against a server-supplied URL pointing into the user's own network.
 * The server already only hands out organisations' public websites; the extension double-checks.
 */
export function checkTaskUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (u.username || u.password) return { ok: false, reason: 'credentials_in_url' };
  if (!ALLOWED_PORTS.has(u.port)) return { ok: false, reason: 'port' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) return { ok: false, reason: 'ipv6_literal' };
  if (host === 'localhost' || !host.includes('.')) return { ok: false, reason: 'local_host' };
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: 'local_host' };
  if (privateIPv4(host)) return { ok: false, reason: 'private_ip' };
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Page content

/**
 * Truncates a string so its UTF-8 encoding fits in maxBytes, never splitting a character.
 * TextEncoder.encodeInto only writes whole code points, so `read` is a safe cut.
 */
export function truncateUtf8(text, maxBytes = MAX_HTML_BYTES) {
  const s = String(text ?? '');
  if (s.length * 3 <= maxBytes) return { text: s, truncated: false };
  const buf = new Uint8Array(maxBytes);
  const { read } = new TextEncoder().encodeInto(s, buf);
  if (read >= s.length) return { text: s, truncated: false };
  return { text: s.slice(0, read), truncated: true };
}

export function isHtmlContentType(contentType) {
  const ct = String(contentType || '').toLowerCase();
  return ct.includes('text/html') || ct.includes('application/xhtml+xml');
}

/** No (or a vague) content type: decide from the first bytes. */
export function looksLikeHtmlBytes(bytes) {
  // a UTF-8 BOM arrives as the three bytes EF BB BF
  const head = asciiHead(bytes, 512).replace(/^\xEF\xBB\xBF/, '').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<head') || head.startsWith('<!--') || head.startsWith('<body') || head.startsWith('<meta');
}

function asciiHead(bytes, n) {
  const end = Math.min(bytes?.length || 0, n);
  let out = '';
  for (let i = 0; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

/** Charset from the Content-Type header, else from a <meta> in the first 2 KB, else utf-8. */
export function detectCharset(contentType, bytes) {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(String(contentType || ''));
  if (fromHeader) return fromHeader[1].toLowerCase();
  const head = asciiHead(bytes, 2048);
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head);
  if (fromMeta) return fromMeta[1].toLowerCase();
  return 'utf-8';
}

export function decodeBytes(bytes, charset) {
  try {
    return new TextDecoder(charset || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** Reads at most maxBytes of a Response body, then cancels the rest. */
export async function readCapped(response, maxBytes = MAX_HTML_BYTES) {
  if (!response.body) {
    const all = new Uint8Array(await response.arrayBuffer());
    return { bytes: all.subarray(0, maxBytes), truncated: all.length > maxBytes };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= maxBytes) {
      truncated = total > maxBytes;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
  }
  const out = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - off);
    out.set(c.subarray(0, take), off);
    off += take;
    if (off >= out.length) break;
  }
  return { bytes: out, truncated };
}

/** Rough visible text of an HTML document (no DOMParser in a service worker). */
export function visibleText(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MOUNT_NODE_RE = /<[a-z][\w-]*\b[^>]*\bid\s*=\s*["']?(?:__next|root|app|__nuxt)(?=["'\s/>])/i;

/** An empty JavaScript shell: almost no visible text plus a framework mount node. */
export function looksLikeJsShell(html, minText = 300) {
  if (!html) return false;
  return MOUNT_NODE_RE.test(html) && visibleText(html).length < minText;
}

// ---------------------------------------------------------------------------------------------
// Daily cap, claims, backoff

export function localDay(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function emptyStats(now = new Date()) {
  return { day: localDay(now), pages: 0, errors: 0, lastError: null, lastErrorAt: null, lastRunAt: null };
}

/** Resets the day's counters when the local date changed; keeps last error / last run. */
export function rollDay(stats, now = new Date()) {
  const s = { ...emptyStats(now), ...(stats || {}) };
  const today = localDay(now);
  if (s.day !== today) return { ...s, day: today, pages: 0, errors: 0 };
  return s;
}

export function remainingToday(stats, cap = DAILY_CAP, now = new Date()) {
  return Math.max(0, cap - rollDay(stats, now).pages);
}

/**
 * How many tasks to ask for: never more than the parallel limit or the day's remaining pages
 * (minus tasks already carried over from the last tick), and none when too little of the tick is left.
 * Returns 0..4 (the API accepts 1..4; 0 means "do not claim").
 */
export function claimCount({ remaining, maxParallel = MAX_PARALLEL, carried = 0, msLeft }) {
  if (msLeft !== undefined && msLeft < MIN_TASK_MS + RESULT_MARGIN_MS) return 0;
  const n = Math.min(maxParallel - carried, remaining - carried, 4);
  return Math.max(0, n);
}

export function clampParallel(n) {
  const v = Number.isFinite(Number(n)) ? Math.floor(Number(n)) : MAX_PARALLEL;
  return Math.min(MAX_PARALLEL, Math.max(1, v));
}

/** Consecutive-failure tracking. After FAILURES_BEFORE_BACKOFF failures in a row, pause BACKOFF_MS. */
export function applyOutcome(health, ok, now = Date.now()) {
  const h = { consecutiveFailures: 0, backoffUntil: 0, ...(health || {}) };
  if (ok) return { ...h, consecutiveFailures: 0 };
  const failures = h.consecutiveFailures + 1;
  if (failures >= FAILURES_BEFORE_BACKOFF) return { consecutiveFailures: 0, backoffUntil: now + BACKOFF_MS };
  return { ...h, consecutiveFailures: failures };
}

export function isBackingOff(health, now = Date.now()) {
  return !!health && Number(health.backoffUntil) > now;
}

/** A carried-over task is still worth running if its lease outlives one more attempt. */
export function leaseStillValid(task, now = Date.now()) {
  const leaseMs = (Number(task.leaseS) || 120) * 1000;
  const timeout = Number(task.timeout_ms) || DEFAULT_TASK_TIMEOUT_MS;
  return Number(task.claimedAt || 0) + leaseMs - now > timeout + RESULT_MARGIN_MS;
}

// ---------------------------------------------------------------------------------------------
// Scheduler

/**
 * Runs items with at most `concurrency` in flight and never two with the same key at once.
 * Resolves (never rejects) with [{ok, value} | {ok:false, error}] in input order.
 */
export function runHostSerialized(items, { concurrency = MAX_PARALLEL, keyOf, run }) {
  const limit = Math.max(1, concurrency | 0);
  const results = new Array(items.length);
  const pending = items.map((item, index) => ({ item, index, key: keyOf(item) }));
  const activeKeys = new Set();
  let active = 0;
  return new Promise((resolve) => {
    const pump = () => {
      if (pending.length === 0 && active === 0) {
        resolve(results);
        return;
      }
      for (let i = 0; i < pending.length && active < limit; ) {
        const job = pending[i];
        if (activeKeys.has(job.key)) {
          i++;
          continue;
        }
        pending.splice(i, 1);
        activeKeys.add(job.key);
        active++;
        Promise.resolve()
          .then(() => run(job.item))
          .then(
            (value) => {
              results[job.index] = { ok: true, value };
            },
            (error) => {
              results[job.index] = { ok: false, error };
            },
          )
          .finally(() => {
            activeKeys.delete(job.key);
            active--;
            pump();
          });
      }
    };
    pump();
  });
}

// ---------------------------------------------------------------------------------------------
// Badge

/** Badge text/colour/title for the current state. */
export function badgeFor(s) {
  if (!s.connected) {
    if (s.disconnected) return { text: '!', color: '#C62828', title: 'Vacademy Lead Agent: disconnected. Open to reconnect.' };
    return { text: '', color: '#5F6368', title: 'Vacademy Lead Agent: not connected' };
  }
  if (s.paused) return { text: 'II', color: '#5F6368', title: 'Vacademy Lead Agent: paused' };
  if (!s.siteAccess) return { text: '!', color: '#C62828', title: 'Vacademy Lead Agent: needs permission to read websites' };
  if (s.backingOff) return { text: '!', color: '#C62828', title: 'Vacademy Lead Agent: errors, retrying in a few minutes' };
  if (s.serverPaused) return { text: 'II', color: '#5F6368', title: 'Vacademy Lead Agent: paused from the dashboard' };
  if (s.lastTickError) return { text: '!', color: '#C62828', title: `Vacademy Lead Agent: ${s.lastError || 'error'}` };
  const pages = s.pagesToday || 0;
  const title = s.capReached
    ? `Vacademy Lead Agent: daily limit reached (${pages} pages)`
    : `Vacademy Lead Agent: running, ${pages} pages today`;
  return { text: pages > 0 ? String(pages) : '', color: '#1F4FD8', title };
}
