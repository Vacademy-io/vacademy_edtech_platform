// Drives background.js against a mocked chrome.* and a fake network. Not a substitute for loading the
// extension in Chrome, but it exercises the real message, tick, fetch, tab-render and result code paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const EXT_ID = 'testextensionid';
const API = 'https://backend-stage.vacademy.io/ai-service/lead-agent/v1';
const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCD';

function event() {
  const ls = [];
  return { addListener: (f) => ls.push(f), removeListener: (f) => ls.splice(ls.indexOf(f), 1), fire: (...a) => ls.map((f) => f(...a)), ls };
}

function storageArea() {
  let data = {};
  return {
    get: async (keys) => {
      const ks = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of ks) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    },
    set: async (obj) => {
      data = { ...data, ...structuredClone(obj) };
    },
    remove: async (k) => {
      for (const key of Array.isArray(k) ? k : [k]) delete data[key];
    },
    setAccessLevel: async () => {},
    _dump: () => data,
  };
}

const state = { siteAccess: true, badge: '', windows: new Set(), tabs: new Map(), nextId: 100, renderedHtml: null };
const ev = {
  onMessage: event(), onInstalled: event(), onStartup: event(), onAlarm: event(), onAdded: event(), onRemoved: event(),
  winRemoved: event(), tabUpdated: event(), tabRemoved: event(),
};

globalThis.self = globalThis;
globalThis.chrome = {
  runtime: {
    id: EXT_ID,
    getManifest: () => ({ version: '0.1.0' }),
    getURL: (p) => `chrome-extension://${EXT_ID}/${p}`,
    getPlatformInfo: async () => ({ os: 'mac' }),
    onMessage: ev.onMessage, onInstalled: ev.onInstalled, onStartup: ev.onStartup,
  },
  storage: { local: storageArea(), session: storageArea() },
  alarms: { get: async () => undefined, create: async () => {}, onAlarm: ev.onAlarm },
  action: { setBadgeText: async ({ text }) => { state.badge = text; }, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
  permissions: { contains: async () => state.siteAccess, onAdded: ev.onAdded, onRemoved: ev.onRemoved },
  windows: {
    get: async (id) => { if (!state.windows.has(id)) throw new Error('No window'); return { id }; },
    create: async (opts) => { assert.equal(opts.state, 'minimized'); assert.equal(opts.focused, false); const id = state.nextId++; state.windows.add(id); return { id }; },
    update: async () => {},
    remove: async (id) => { state.windows.delete(id); },
    onRemoved: ev.winRemoved,
  },
  tabs: {
    create: async ({ windowId, url, active }) => {
      assert.ok(state.windows.has(windowId), 'tab goes into the render window');
      assert.equal(active, false);
      const id = state.nextId++;
      state.tabs.set(id, { id, url, status: 'loading' });
      setTimeout(() => { state.tabs.get(id).status = 'complete'; ev.tabUpdated.fire(id, { status: 'complete' }); }, 20);
      return { id, status: 'loading' };
    },
    get: async (id) => { const t = state.tabs.get(id); if (!t) throw new Error('No tab'); return { id, status: t.status }; },
    update: async () => {},
    remove: async (id) => { state.tabs.delete(id); },
    onUpdated: ev.tabUpdated, onRemoved: ev.tabRemoved,
  },
  scripting: {
    executeScript: async ({ target }) => {
      const t = state.tabs.get(target.tabId);
      return [{ result: { html: state.renderedHtml, url: t.url, contentType: 'text/html', status: 200 } }];
    },
  },
};

// ---- fake network
const calls = [];
let claimQueue = [];
let revoke = false;
const sites = {
  'https://acme-classes.in/': { status: 200, ct: 'text/html; charset=utf-8', body: `<html><body><h1>Acme</h1><p>${'Admissions open for JEE 2027. '.repeat(30)}</p></body></html>` },
  'https://spa-coaching.com/': { status: 200, ct: 'text/html', body: '<html><head><title>x</title></head><body><div id="root"></div><script src="/a.js"></script></body></html>' },
  'https://files.example.org/brochure.pdf': { status: 200, ct: 'application/pdf', body: '%PDF-1.7 ....' },
  'https://gone.example.net/': { status: 404, ct: 'text/html', body: '<html><body>Not found</body></html>' },
};
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url, opts, body: opts.body ? JSON.parse(opts.body) : undefined });
  if (url.startsWith(API)) {
    assert.equal(opts.credentials, 'omit');
    if (revoke) return new Response('{"detail":"revoked"}', { status: 401 });
    assert.equal(opts.headers['X-Lead-Agent-Token'], TOKEN);
    const path = url.slice(API.length);
    if (path === '/ext/hello') return Response.json({ worker_id: 'w1', institute_id: 'i1', institute_name: 'Vacademy', user_name: 'Shreyash', poll_interval_s: 30, max_parallel: 2, paused: false });
    if (path === '/ext/claim') return Response.json({ tasks: claimQueue.splice(0, JSON.parse(opts.body).max), lease_s: 120 });
    if (path === '/ext/result') return Response.json({ accepted: true });
    return new Response('nope', { status: 404 });
  }
  assert.equal(opts.credentials, 'omit', 'site fetches never send cookies');
  const s = sites[url];
  if (!s) throw new TypeError('Failed to fetch');
  const r = new Response(s.body, { status: s.status, headers: { 'content-type': s.ct } });
  Object.defineProperty(r, 'url', { value: url });
  return r;
};

await import('../background.js');

const popupSender = { id: EXT_ID, url: `chrome-extension://${EXT_ID}/popup.html` };
function send(msg, sender = popupSender) {
  return new Promise((resolve) => {
    const keep = ev.onMessage.ls[0](msg, sender, resolve);
    assert.equal(keep, true);
  });
}
const results = () => calls.filter((c) => c.url === `${API}/ext/result`).map((c) => c.body);
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timed out waiting');
}
const settle = () => new Promise((r) => setTimeout(r, 700)); // let the post-pair tick run

test('pairing from a non-dashboard page is refused', async () => {
  const res = await send({ type: 'PAIR', token: TOKEN }, { id: EXT_ID, tab: { id: 1 }, origin: 'https://learner.vacademy.io', url: 'https://learner.vacademy.io/x' });
  assert.equal(res.ok, false);
  assert.equal(calls.length, 0);
});

test('a content script may only send PAIR', async () => {
  const res = await send({ type: 'STATUS' }, { id: EXT_ID, tab: { id: 1 }, origin: 'https://dash.vacademy.io' });
  assert.deepEqual(res, { ok: false, error: 'not allowed' });
});

test('pair from the dashboard: hello, store, status has no token', async () => {
  const res = await send({ type: 'PAIR', token: TOKEN, apiBase: 'https://backend-stage.vacademy.io/ai-service/' }, { id: EXT_ID, tab: { id: 1 }, origin: 'https://dash.vacademy.io', url: 'https://dash.vacademy.io/lead-agent' });
  assert.equal(res.ok, true);
  assert.equal(res.institute_name, 'Vacademy');
  const hello = calls.find((c) => c.url === `${API}/ext/hello`);
  assert.equal(hello.body.version, '0.1.0');
  await settle();
  const st = await send({ type: 'STATUS' });
  assert.equal(st.connected, true);
  assert.equal(st.userName, 'Shreyash');
  assert.ok(!JSON.stringify(st).includes(TOKEN), 'status never exposes the token');
});

test('tick: claim, fetch, report HTML / non-HTML / 404', async () => {
  claimQueue = [
    { id: 't1', url: 'https://acme-classes.in/', page_type: 'home', timeout_ms: 20000, render: 'fetch' },
    { id: 't2', url: 'https://files.example.org/brochure.pdf', page_type: 'other', timeout_ms: 20000, render: 'fetch' },
  ];
  ev.onAlarm.fire({ name: 'tick' });
  await waitFor(() => results().length === 2);
  const claim = calls.find((c) => c.url === `${API}/ext/claim`);
  assert.deepEqual(claim.body, { max: 2 });
  const r1 = results().find((r) => r.task_id === 't1');
  assert.equal(r1.ok, true);
  assert.equal(r1.status_code, 200);
  assert.equal(r1.final_url, 'https://acme-classes.in/');
  assert.match(r1.html, /Admissions open/);
  const r2 = results().find((r) => r.task_id === 't2');
  assert.equal(r2.ok, true);
  assert.equal(r2.content_type, 'application/pdf');
  assert.equal(r2.html, undefined);

  claimQueue = [{ id: 't3', url: 'https://gone.example.net/', page_type: 'contact', timeout_ms: 20000, render: 'fetch' }];
  await new Promise((r) => setTimeout(r, 50));
  ev.onAlarm.fire({ name: 'tick' });
  await waitFor(() => results().length === 3);
  const r3 = results().find((r) => r.task_id === 't3');
  assert.equal(r3.ok, false);
  assert.equal(r3.status_code, 404);
  assert.equal(r3.error, 'HTTP 404');
  await waitFor(async () => (await send({ type: 'STATUS' })).stats.pages === 3);
  assert.equal(state.badge, '3');
});

test('a JS shell falls back to a tab render in the minimized window, and the tab is closed', async () => {
  state.renderedHtml = `<html><body><div id="root"><h1>SPA Coaching</h1><p>${'Call 98xxxx for NEET batches. '.repeat(20)}</p></div></body></html>`;
  claimQueue = [{ id: 't4', url: 'https://spa-coaching.com/', page_type: 'home', timeout_ms: 20000, render: 'fetch' }];
  await new Promise((r) => setTimeout(r, 50));
  ev.onAlarm.fire({ name: 'tick' });
  await waitFor(() => results().some((r) => r.task_id === 't4'), 6000);
  const r4 = results().find((r) => r.task_id === 't4');
  assert.equal(r4.ok, true);
  assert.match(r4.html, /NEET batches/);
  assert.equal(state.windows.size, 1);
  await waitFor(() => state.tabs.size === 0);
});

test('blocked addresses are never fetched', async () => {
  claimQueue = [{ id: 't5', url: 'http://192.168.1.1/', page_type: 'home', timeout_ms: 20000, render: 'fetch' }];
  await new Promise((r) => setTimeout(r, 50));
  ev.onAlarm.fire({ name: 'tick' });
  await waitFor(() => results().some((r) => r.task_id === 't5'));
  assert.ok(!calls.some((c) => c.url.startsWith('http://192.168')));
  assert.match(results().find((r) => r.task_id === 't5').error, /private_ip/);
});

test('no site access: nothing is claimed', async () => {
  state.siteAccess = false;
  const before = calls.length;
  ev.onAlarm.fire({ name: 'tick' });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(calls.length, before);
  assert.equal(state.badge, '!');
  state.siteAccess = true;
});

test('pause stops claiming and shows II', async () => {
  await send({ type: 'PAUSE' });
  const before = calls.length;
  ev.onAlarm.fire({ name: 'tick' });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(calls.length, before);
  assert.equal(state.badge, 'II');
  assert.equal(state.windows.size, 0, 'render window closed on pause');
  await send({ type: 'RESUME' });
  await settle();
});

test('daily cap: no claim once 300 pages are done today', async () => {
  const s = await chrome.storage.local.get('stats');
  await chrome.storage.local.set({ stats: { ...s.stats, pages: 300 } });
  const before = calls.filter((c) => c.url.endsWith('/ext/claim')).length;
  ev.onAlarm.fire({ name: 'tick' });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(calls.filter((c) => c.url.endsWith('/ext/claim')).length, before);
  assert.equal((await send({ type: 'STATUS' })).capReached, true);
  await chrome.storage.local.set({ stats: { ...s.stats, pages: 3 } });
});

test('401 from the API disconnects and the popup sees why', async () => {
  revoke = true;
  claimQueue = [];
  await send({ type: 'RUN_NOW' });
  await waitFor(async () => !(await send({ type: 'STATUS' })).connected);
  const st = await send({ type: 'STATUS' });
  assert.equal(st.disconnected.reason, 'revoked');
  assert.equal(st.disconnected.instituteName, 'Vacademy');
  assert.equal(state.badge, '!');
  assert.equal((await chrome.storage.local.get('token')).token, null);
});

test('a bad code does not replace a working pairing', async () => {
  revoke = false;
  assert.equal((await send({ type: 'PAIR', token: TOKEN })).ok, true);
  await settle();
  revoke = true;
  const res = await send({ type: 'PAIR', token: 'another_token_abcdefghijklmnopqrstuvwxyz' });
  assert.equal(res.ok, false);
  assert.match(res.error, /not valid/);
  assert.equal((await chrome.storage.local.get('token')).token, TOKEN);
  revoke = false;
});

test('apiBase outside vacademy.io / localhost is refused', async () => {
  const res = await send({ type: 'PAIR', token: TOKEN, apiBase: 'https://evil.example.com/ai-service' });
  assert.equal(res.ok, false);
});
