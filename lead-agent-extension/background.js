// Vacademy Lead Agent: background service worker (Manifest V3, ES module).
//
// It only fetches the organisation pages the Vacademy server hands it (POST /ext/claim) and sends the raw
// HTML back (POST /ext/result). It never searches, never reads the user's tabs, and never sends the user's
// cookies with a normal fetch. All parsing and AI happen on the server.

import * as L from './lib.js';

const VERSION = chrome.runtime.getManifest().version;
const ALL_URLS = { origins: ['<all_urls>'] };
const API_TIMEOUT_MS = 15_000;

const DEFAULTS = {
  token: null,
  apiBase: L.DEFAULT_API_BASE,
  workerId: null,
  instituteId: null,
  instituteName: null,
  userName: null,
  paused: false, // paused by the user in the popup
  serverPaused: false, // `paused` from /ext/hello
  maxParallel: L.MAX_PARALLEL,
  lastHelloAt: 0,
  disconnected: null, // {reason, at, instituteName} after a 401
  stats: null, // {day, pages, errors, lastError, lastErrorAt, lastRunAt}
  health: null, // {consecutiveFailures, backoffUntil, lastTickError}
};

// ---------------------------------------------------------------------------------------------
// State

async function getState() {
  const s = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
  s.stats = L.rollDay(s.stats);
  s.health = { consecutiveFailures: 0, backoffUntil: 0, lastTickError: false, ...(s.health || {}) };
  return s;
}

function setState(patch) {
  return chrome.storage.local.set(patch);
}

// Serialise read-modify-write of stats/health (tasks finish in parallel).
let statsChain = Promise.resolve();
function updateStats(fn) {
  statsChain = statsChain.then(async () => {
    const s = await getState();
    const next = fn({ stats: s.stats, health: s.health });
    await setState(next);
  }).catch(() => {});
  return statsChain;
}

function recordError(message) {
  return updateStats(({ stats, health }) => ({
    stats: { ...stats, errors: stats.errors + 1, lastError: String(message).slice(0, 300), lastErrorAt: Date.now() },
    health: { ...L.applyOutcome(health, false), lastTickError: true },
  }));
}

function recordApiOk() {
  return updateStats(({ stats, health }) => ({ stats, health: { ...L.applyOutcome(health, true), lastTickError: false } }));
}

async function hasSiteAccess() {
  try {
    return await chrome.permissions.contains(ALL_URLS);
  } catch {
    return false;
  }
}

async function publicStatus() {
  const s = await getState();
  const siteAccess = await hasSiteAccess();
  return {
    ok: true,
    version: VERSION,
    connected: !!s.token,
    apiBase: s.apiBase,
    workerId: s.workerId,
    instituteName: s.instituteName,
    userName: s.userName,
    paused: s.paused,
    serverPaused: s.serverPaused,
    siteAccess,
    disconnected: s.disconnected,
    stats: s.stats,
    cap: L.DAILY_CAP,
    capReached: L.remainingToday(s.stats) === 0,
    backoffUntil: L.isBackingOff(s.health) ? s.health.backoffUntil : 0,
    lastTickError: s.health.lastTickError,
    running: ticking,
  };
}

async function updateBadge() {
  try {
    const st = await publicStatus();
    const b = L.badgeFor({
      connected: st.connected,
      disconnected: st.disconnected,
      paused: st.paused,
      serverPaused: st.serverPaused,
      siteAccess: st.siteAccess,
      backingOff: st.backoffUntil > 0,
      lastTickError: st.lastTickError,
      lastError: st.stats.lastError,
      pagesToday: st.stats.pages,
      capReached: st.capReached,
    });
    await chrome.action.setBadgeText({ text: b.text });
    await chrome.action.setBadgeBackgroundColor({ color: b.color });
    await chrome.action.setTitle({ title: b.title });
  } catch {
    /* badge is cosmetic */
  }
}

// ---------------------------------------------------------------------------------------------
// Vacademy API

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(apiBase, token, path, body, timeoutMs = API_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${apiBase}${L.API_PREFIX}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lead-Agent-Token': token },
      body: JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new ApiError(0, ctrl.signal.aborted ? `Vacademy did not answer within ${timeoutMs / 1000} s` : `Cannot reach Vacademy (${e.message})`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, `Vacademy ${path} returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  try {
    return await res.json();
  } catch {
    throw new ApiError(res.status, `Vacademy ${path} returned an unreadable answer`);
  }
}

function workerLabel() {
  const p = (self.navigator && (navigator.userAgentData?.platform || navigator.platform)) || '';
  return `Chrome${p ? ` on ${p}` : ''}`.slice(0, 120);
}

function hello(apiBase, token) {
  return api(apiBase, token, '/ext/hello', { version: VERSION, label: workerLabel() });
}

function helloPatch(h) {
  return {
    workerId: h.worker_id ?? null,
    instituteId: h.institute_id ?? null,
    instituteName: h.institute_name ?? null,
    userName: h.user_name ?? null,
    serverPaused: !!h.paused,
    maxParallel: L.clampParallel(h.max_parallel),
    lastHelloAt: Date.now(),
  };
}

async function markDisconnected(reason) {
  const s = await getState();
  await setState({
    token: null,
    workerId: null,
    lastHelloAt: 0,
    disconnected: { reason, at: Date.now(), instituteName: s.instituteName },
  });
  await chrome.storage.session.remove('carry');
  await closeRenderWindow();
}

// ---------------------------------------------------------------------------------------------
// Fetch mode

async function fetchPage(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'omit', // never the user's cookies
      redirect: 'follow',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      signal: ctrl.signal,
    });
    const finalUrl = res.url || url;
    const contentType = res.headers.get('content-type') || '';
    const base = { status_code: res.status, final_url: finalUrl, content_type: contentType || null };
    const httpError = res.status >= 400 ? `HTTP ${res.status}` : null;

    const fin = L.checkTaskUrl(finalUrl);
    if (!fin.ok) {
      res.body?.cancel().catch(() => {});
      return { ok: false, ...base, error: `redirected to a blocked address (${fin.reason})` };
    }
    const vague = !contentType || /^text\/plain|^application\/octet-stream/i.test(contentType);
    if (!L.isHtmlContentType(contentType) && !vague) {
      res.body?.cancel().catch(() => {});
      return httpError ? { ok: false, ...base, error: httpError } : { ok: true, ...base };
    }
    const { bytes } = await L.readCapped(res, L.MAX_HTML_BYTES);
    if (vague && !L.looksLikeHtmlBytes(bytes)) {
      return httpError ? { ok: false, ...base, error: httpError } : { ok: true, ...base };
    }
    const text = L.decodeBytes(bytes, L.detectCharset(contentType, bytes));
    const { text: html } = L.truncateUtf8(text, L.MAX_HTML_BYTES);
    const out = { ok: !httpError, ...base, content_type: contentType || 'text/html', html };
    if (httpError) out.error = httpError;
    return out;
  } catch (e) {
    return { ok: false, error: ctrl.signal.aborted ? `timeout after ${timeoutMs} ms` : `network error: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------
// Tab render mode (JavaScript-built pages). One dedicated minimized window, reused; one tab per task.

let windowPromise = null;
let lastRenderAt = 0;

async function resolveRenderWindow() {
  const { renderWindowId } = await chrome.storage.session.get('renderWindowId');
  if (renderWindowId != null) {
    try {
      await chrome.windows.get(renderWindowId);
      return renderWindowId;
    } catch {
      /* the user closed it */
    }
  }
  let w;
  try {
    w = await chrome.windows.create({ url: 'about:blank', state: 'minimized', focused: false });
  } catch {
    w = await chrome.windows.create({ url: 'about:blank', focused: false });
    chrome.windows.update(w.id, { state: 'minimized' }).catch(() => {});
  }
  await chrome.storage.session.set({ renderWindowId: w.id });
  return w.id;
}

// Single flight: two parallel renders share one window.
function getRenderWindow() {
  if (!windowPromise) {
    windowPromise = resolveRenderWindow().finally(() => {
      windowPromise = null;
    });
  }
  return windowPromise;
}

async function closeRenderWindow() {
  const { renderWindowId } = await chrome.storage.session.get('renderWindowId');
  if (renderWindowId == null) return;
  await chrome.storage.session.remove('renderWindowId');
  await chrome.windows.remove(renderWindowId).catch(() => {});
}

function waitForComplete(tabId, untilMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (how) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      resolve(how);
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') finish('complete');
    };
    const onRemoved = (id) => {
      if (id === tabId) finish('removed');
    };
    const timer = setTimeout(() => finish('timeout'), Math.max(0, untilMs - Date.now()));
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.get(tabId).then((t) => t.status === 'complete' && finish('complete'), () => finish('removed'));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), Math.max(0, ms));
    }),
  ]).finally(() => clearTimeout(timer));
}

// Runs inside the rendered page (must be self-contained). Reads only that page.
function readRenderedPage(maxChars) {
  const nav = performance.getEntriesByType('navigation')[0];
  let html = document.documentElement ? document.documentElement.outerHTML : '';
  if (html.length > maxChars) html = html.slice(0, maxChars);
  return { html, url: location.href, contentType: document.contentType || null, status: (nav && nav.responseStatus) || null };
}

async function renderInTab(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const readMargin = 1_500;
  let tabId = null;
  try {
    const windowId = await getRenderWindow();
    const tab = await chrome.tabs.create({ windowId, url, active: false });
    tabId = tab.id;
    chrome.tabs.update(tabId, { muted: true }).catch(() => {});
    const how = await waitForComplete(tabId, deadline - readMargin);
    if (how === 'removed') return { ok: false, error: 'render tab was closed' };
    if (how === 'complete') await sleep(Math.min(L.TAB_SETTLE_MS, deadline - readMargin - Date.now()));
    const [inj] = await withTimeout(
      chrome.scripting.executeScript({ target: { tabId }, func: readRenderedPage, args: [L.MAX_HTML_BYTES] }),
      Math.max(500, deadline - Date.now()),
      `timeout after ${timeoutMs} ms`,
    );
    const r = inj && inj.result;
    if (!r) return { ok: false, error: 'could not read the rendered page' };
    const fin = L.checkTaskUrl(r.url);
    if (!fin.ok) return { ok: false, final_url: r.url, error: `redirected to a blocked address (${fin.reason})` };
    const { text: html } = L.truncateUtf8(r.html, L.MAX_HTML_BYTES);
    const status = r.status || null;
    const out = { ok: !(status && status >= 400), status_code: status, final_url: r.url, content_type: r.contentType || 'text/html', html };
    if (status && status >= 400) out.error = `HTTP ${status}`;
    if (how === 'timeout') out.error = `page still loading after ${timeoutMs} ms (partial)`;
    return out;
  } catch (e) {
    return { ok: false, error: `tab render failed: ${e.message}` };
  } finally {
    lastRenderAt = Date.now();
    await chrome.storage.session.set({ lastRenderAt });
    if (tabId != null) chrome.tabs.remove(tabId).catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------
// Tasks

async function sendResult(st, payload, deadline) {
  const timeout = Math.max(3_000, Math.min(10_000, deadline - Date.now()));
  try {
    await api(st.apiBase, st.token, '/ext/result', payload, timeout);
    await recordApiOk();
    return true;
  } catch (e) {
    if (e.status === 401) throw e;
    // one retry for transient failures
    try {
      await sleep(800);
      await api(st.apiBase, st.token, '/ext/result', payload, timeout);
      await recordApiOk();
      return true;
    } catch (e2) {
      if (e2.status === 401) throw e2;
      await recordError(e2.message);
      return false;
    }
  }
}

function resultPayload(task, r) {
  const p = { task_id: task.id, ok: !!r.ok };
  for (const k of ['status_code', 'final_url', 'content_type', 'html', 'error']) {
    if (r[k] !== undefined && r[k] !== null) p[k] = r[k];
  }
  return p;
}

async function processTask(st, task, deadline, carry) {
  const msLeft = () => deadline - Date.now() - L.RESULT_MARGIN_MS;
  const wantTab = task.render === 'tab';
  if (msLeft() < (wantTab ? L.MIN_TAB_MS : L.MIN_TASK_MS)) {
    carry.push(task); // not started; next tick, within the lease
    return 'carried';
  }
  const timeoutMax = Number(task.timeout_ms) || L.DEFAULT_TASK_TIMEOUT_MS;
  const safe = L.checkTaskUrl(task.url);
  let r;
  if (!safe.ok) {
    r = { ok: false, error: `blocked address (${safe.reason})` };
  } else if (wantTab) {
    r = await renderInTab(task.url, Math.min(timeoutMax, msLeft()));
  } else {
    r = await fetchPage(task.url, Math.min(timeoutMax, msLeft()));
    if (r.ok && r.html && L.looksLikeJsShell(r.html)) {
      if (msLeft() < L.MIN_TAB_MS) {
        carry.push({ ...task, render: 'tab' });
        return 'carried';
      }
      const t = await renderInTab(r.final_url || task.url, Math.min(timeoutMax, msLeft()));
      if (t.html) r = { ...t, status_code: r.status_code ?? t.status_code };
      // tab render failed: keep the shell HTML from the plain fetch
    }
  }
  const sent = await sendResult(st, resultPayload(task, r), deadline);
  await updateStats(({ stats, health }) => {
    // `errors` counts pages that failed; `lastError` stays for connection problems (shown in the popup)
    const next = { ...stats, pages: stats.pages + 1, errors: stats.errors + (r.ok ? 0 : 1) };
    // a page that does not load is a normal result for the server; only an offline browser counts as our failure
    const offline = !r.ok && self.navigator && navigator.onLine === false;
    return { stats: next, health: offline ? L.applyOutcome(health, false) : health };
  });
  return sent ? 'done' : 'unsent';
}

// ---------------------------------------------------------------------------------------------
// Tick

let ticking = false;

async function tick(reason = 'alarm') {
  if (ticking) return;
  ticking = true;
  const started = Date.now();
  const deadline = started + L.TICK_BUDGET_MS;
  let worked = false;
  // Extension API calls keep the service worker alive while pages load.
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 10_000);
  try {
    await updateBadge();
    let st = await getState();
    if (!st.token || st.paused) {
      await closeRenderWindow();
      return;
    }
    if (!(await hasSiteAccess())) return;
    if (reason === 'run_now') {
      await setState({ health: { ...st.health, consecutiveFailures: 0, backoffUntil: 0 } });
      st = await getState();
    } else if (L.isBackingOff(st.health)) {
      return;
    }

    // hello: on pair, on "Run now", and at most every 10 minutes
    if (reason === 'run_now' || started - st.lastHelloAt >= L.HELLO_EVERY_MS) {
      try {
        await setState(helloPatch(await hello(st.apiBase, st.token)));
        await recordApiOk();
        st = await getState();
      } catch (e) {
        if (e.status === 401) return markDisconnected('revoked');
        await recordError(e.message);
        return;
      }
    }
    if (st.serverPaused) return;
    worked = true;

    const { carry: carried = [] } = await chrome.storage.session.get('carry');
    const now = Date.now();
    const tasks = carried.filter((t) => L.leaseStillValid(t, now));
    const remaining = L.remainingToday(st.stats);
    const n = L.claimCount({ remaining, maxParallel: st.maxParallel, carried: tasks.length, msLeft: deadline - now });
    if (n > 0) {
      try {
        const r = await api(st.apiBase, st.token, '/ext/claim', { max: n });
        await recordApiOk();
        const leaseS = Number(r.lease_s) || 120;
        for (const t of (r.tasks || []).slice(0, n)) {
          if (t && t.id && t.url) tasks.push({ ...t, claimedAt: Date.now(), leaseS });
        }
      } catch (e) {
        if (e.status === 401) return markDisconnected('revoked');
        await recordError(e.message);
      }
    }
    if (tasks.length === 0) {
      await chrome.storage.session.remove('carry');
      return;
    }

    const nextCarry = [];
    const results = await L.runHostSerialized(tasks, {
      concurrency: st.maxParallel,
      keyOf: (t) => L.siteKey(t.url),
      run: (t) => processTask(st, t, deadline, nextCarry),
    });
    await chrome.storage.session.set({ carry: nextCarry });
    const revoked = results.find((x) => !x.ok && x.error && x.error.status === 401);
    if (revoked) return markDisconnected('revoked');
    for (const x of results) if (!x.ok) await recordError(String(x.error?.message || x.error));
  } catch (e) {
    await recordError(`internal: ${e.message}`);
  } finally {
    clearInterval(keepAlive);
    if (worked) await updateStats(({ stats, health }) => ({ stats: { ...stats, lastRunAt: Date.now() }, health }));
    await maybeCloseIdleWindow();
    ticking = false;
    await updateBadge();
  }
}

async function maybeCloseIdleWindow() {
  const { lastRenderAt: last = 0 } = await chrome.storage.session.get('lastRenderAt');
  if (Date.now() - Math.max(last, lastRenderAt) > L.RENDER_WINDOW_IDLE_MS) await closeRenderWindow();
}

// ---------------------------------------------------------------------------------------------
// Pairing and messages

async function pair({ token, apiBase }) {
  const t = typeof token === 'string' ? token.trim() : '';
  if (!L.isPlausibleToken(t)) return { ok: false, error: 'That does not look like a pairing code. Copy it again from the dashboard.' };
  const base = L.normalizeApiBase(apiBase && String(apiBase).trim() ? apiBase : L.DEFAULT_API_BASE);
  if (!base) return { ok: false, error: 'The API address must be https://….vacademy.io/… (or http://localhost for development).' };
  let h;
  try {
    h = await hello(base, t);
  } catch (e) {
    if (e.status === 401 || e.status === 403) return { ok: false, error: 'This pairing code is not valid or was revoked. Create a new one in the dashboard.' };
    return { ok: false, error: e.message };
  }
  await setState({
    token: t,
    apiBase: base,
    ...helloPatch(h),
    disconnected: null,
    health: { consecutiveFailures: 0, backoffUntil: 0, lastTickError: false },
  });
  await chrome.storage.session.remove('carry');
  await updateBadge();
  setTimeout(() => tick('paired'), 500);
  return { ok: true, institute_name: h.institute_name ?? null, user_name: h.user_name ?? null, needs_site_access: !(await hasSiteAccess()) };
}

function isExtensionPage(sender) {
  return !sender.tab && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

async function handleMessage(msg, sender) {
  const type = msg && msg.type;
  if (sender.tab) {
    // content script: only PAIR, only from the dashboard origin
    if (type !== 'PAIR') return { ok: false, error: 'not allowed' };
    const origin = sender.origin || (sender.url ? new URL(sender.url).origin : '');
    if (!L.isPairPageOrigin(origin)) return { ok: false, error: 'This page cannot connect the extension. Use the Vacademy dashboard.' };
    return pair(msg);
  }
  if (!isExtensionPage(sender)) return { ok: false, error: 'not allowed' };
  switch (type) {
    case 'PAIR':
      return pair(msg);
    case 'STATUS':
      return publicStatus();
    case 'PAUSE':
      await setState({ paused: true });
      await closeRenderWindow();
      await updateBadge();
      return publicStatus();
    case 'RESUME': {
      const s = await getState();
      await setState({ paused: false, health: { ...s.health, consecutiveFailures: 0, backoffUntil: 0 } });
      await updateBadge();
      setTimeout(() => tick('resume'), 200);
      return publicStatus();
    }
    case 'DISCONNECT':
      await setState({ token: null, workerId: null, instituteId: null, instituteName: null, userName: null, lastHelloAt: 0, serverPaused: false, disconnected: null });
      await chrome.storage.session.remove('carry');
      await closeRenderWindow();
      await updateBadge();
      return publicStatus();
    case 'RUN_NOW':
      setTimeout(() => tick('run_now'), 0);
      return { ...(await publicStatus()), running: true };
    default:
      return { ok: false, error: 'unknown message' };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handleMessage(msg, sender).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true; // async response
});

// ---------------------------------------------------------------------------------------------
// Lifecycle

async function ensureAlarm() {
  const a = await chrome.alarms.get('tick');
  if (!a) await chrome.alarms.create('tick', { periodInMinutes: 0.5, delayInMinutes: 0.5 });
}

async function lockDownStorage() {
  // Keep the token out of content scripts (they never need it).
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {
    /* older Chrome: content scripts could read it, ours never do */
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'tick') tick('alarm');
});
chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  updateBadge();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  updateBadge();
});
chrome.permissions.onAdded.addListener(() => {
  updateBadge();
  setTimeout(() => tick('permission'), 300);
});
chrome.permissions.onRemoved.addListener(() => updateBadge());
chrome.windows.onRemoved.addListener(async (id) => {
  const { renderWindowId } = await chrome.storage.session.get('renderWindowId');
  if (renderWindowId === id) await chrome.storage.session.remove('renderWindowId');
});

lockDownStorage();
ensureAlarm();
