import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../lib.js';

test('normalizeApiBase accepts vacademy https and localhost http only', () => {
  assert.equal(L.normalizeApiBase('https://backend-stage.vacademy.io/ai-service/'), 'https://backend-stage.vacademy.io/ai-service');
  assert.equal(L.normalizeApiBase('  https://vacademy.io/ai-service  '), 'https://vacademy.io/ai-service');
  assert.equal(L.normalizeApiBase('http://localhost:8077'), 'http://localhost:8077');
  assert.equal(L.normalizeApiBase('http://localhost/ai-service'), 'http://localhost/ai-service');
  for (const bad of [
    'http://backend-stage.vacademy.io/ai-service', // not https
    'https://evil.com/ai-service',
    'https://vacademy.io.evil.com/x',
    'https://evilvacademy.io/x',
    'https://user:pw@backend-stage.vacademy.io/x',
    'https://backend-stage.vacademy.io/x?y=1',
    'https://backend-stage.vacademy.io:8443/x',
    'https://localhost/x', // not covered by host_permissions
    'http://127.0.0.1:8077',
    'javascript:alert(1)',
    '',
    null,
    42,
  ]) {
    assert.equal(L.normalizeApiBase(bad), null, String(bad));
  }
});

test('isPairPageOrigin allows only the dashboard and localhost', () => {
  assert.ok(L.isPairPageOrigin('https://dash.vacademy.io'));
  assert.ok(L.isPairPageOrigin('http://localhost:5173'));
  assert.ok(!L.isPairPageOrigin('https://learner.vacademy.io'));
  assert.ok(!L.isPairPageOrigin('https://someinstitute.vacademy.io'));
  assert.ok(!L.isPairPageOrigin('http://dash.vacademy.io'));
  assert.ok(!L.isPairPageOrigin('https://dash.vacademy.io.evil.com'));
  assert.ok(!L.isPairPageOrigin('null'));
});

test('isPlausibleToken', () => {
  assert.ok(L.isPlausibleToken('Zk3_2-abcdefghijklmnopqrstuvwxyzABCDEFGHIJK'));
  assert.ok(!L.isPlausibleToken('short'));
  assert.ok(!L.isPlausibleToken('has space in it 1234567890'));
  assert.ok(!L.isPlausibleToken(undefined));
});

test('siteKey groups www and case', () => {
  assert.equal(L.siteKey('https://WWW.Example.com/a'), 'example.com');
  assert.equal(L.siteKey('http://example.com:8080/b'), 'example.com');
  assert.notEqual(L.siteKey('https://a.example.com'), L.siteKey('https://b.example.com'));
});

test('checkTaskUrl blocks local network and odd schemes', () => {
  assert.ok(L.checkTaskUrl('https://www.allen.ac.in/contact').ok);
  assert.ok(L.checkTaskUrl('http://8.8.8.8/').ok);
  for (const [url, reason] of [
    ['file:///etc/passwd', 'scheme'],
    ['chrome://settings', 'scheme'],
    ['http://localhost:3000', 'port'],
    ['http://localhost/', 'local_host'],
    ['http://intranet/', 'local_host'],
    ['http://printer.local/', 'local_host'],
    ['http://db.internal/', 'local_host'],
    ['http://192.168.1.1/', 'private_ip'],
    ['http://10.0.0.5/', 'private_ip'],
    ['http://172.20.1.1/', 'private_ip'],
    ['http://127.0.0.1/', 'private_ip'],
    ['http://0x7f.0.0.1/', 'private_ip'], // URL parser normalises to 127.0.0.1
    ['http://169.254.169.254/latest/meta-data', 'private_ip'],
    ['http://[::1]/', 'ipv6_literal'],
    ['https://user:pw@example.com/', 'credentials_in_url'],
    ['https://example.com:22/', 'port'],
    ['not a url', 'invalid_url'],
  ]) {
    assert.deepEqual(L.checkTaskUrl(url), { ok: false, reason }, url);
  }
});

test('truncateUtf8 keeps short text and cuts long text on a character boundary', () => {
  assert.deepEqual(L.truncateUtf8('hello', 100), { text: 'hello', truncated: false });
  const ascii = 'a'.repeat(5000);
  const r = L.truncateUtf8(ascii, 1000);
  assert.equal(r.text.length, 1000);
  assert.ok(r.truncated);

  // 3-byte characters: 1000 bytes fit 333 of them, never half of one
  const hindi = 'क'.repeat(1000);
  const h = L.truncateUtf8(hindi, 1000);
  assert.equal(h.text.length, 333);
  assert.ok(Buffer.byteLength(h.text, 'utf8') <= 1000);

  // surrogate pairs (emoji, 4 bytes) are not split
  const emoji = '😀'.repeat(400);
  const e = L.truncateUtf8(emoji, 1001);
  assert.equal(Buffer.byteLength(e.text, 'utf8'), 1000);
  assert.ok(!/[\uD800-\uDBFF]$/.test(e.text));

  // exactly at the limit is not truncated
  assert.deepEqual(L.truncateUtf8('ab'.repeat(500), 1000), { text: 'ab'.repeat(500), truncated: false });
});

test('truncateUtf8 default is 1.5 MB', () => {
  const big = 'x'.repeat(2_000_000);
  const r = L.truncateUtf8(big);
  assert.equal(Buffer.byteLength(r.text, 'utf8'), L.MAX_HTML_BYTES);
});

test('readCapped stops at the byte cap', async () => {
  const chunk = new Uint8Array(64 * 1024).fill(97);
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled++;
      if (pulled > 100) controller.close();
      else controller.enqueue(chunk);
    },
  });
  const { bytes, truncated } = await L.readCapped(new Response(stream), 200_000);
  assert.equal(bytes.length, 200_000);
  assert.ok(truncated);
  assert.ok(pulled < 10, `pulled ${pulled} chunks`);

  const small = await L.readCapped(new Response('<html>hi</html>'), 200_000);
  assert.equal(new TextDecoder().decode(small.bytes), '<html>hi</html>');
  assert.ok(!small.truncated);
});

test('charset detection and decoding', () => {
  const enc = new TextEncoder();
  assert.equal(L.detectCharset('text/html; charset=ISO-8859-1', new Uint8Array()), 'iso-8859-1');
  assert.equal(L.detectCharset('text/html', enc.encode('<html><head><meta charset="windows-1252">')), 'windows-1252');
  assert.equal(L.detectCharset('', enc.encode('<html>')), 'utf-8');
  assert.equal(L.decodeBytes(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), 'windows-1252'), 'café');
  assert.equal(L.decodeBytes(enc.encode('ok'), 'no-such-charset'), 'ok');
});

test('content type helpers', () => {
  const enc = new TextEncoder();
  assert.ok(L.isHtmlContentType('text/html; charset=utf-8'));
  assert.ok(L.isHtmlContentType('application/xhtml+xml'));
  assert.ok(!L.isHtmlContentType('application/pdf'));
  assert.ok(L.looksLikeHtmlBytes(enc.encode('\n  <!DOCTYPE html><html>')));
  assert.ok(L.looksLikeHtmlBytes(enc.encode('﻿<html>')));
  assert.ok(!L.looksLikeHtmlBytes(enc.encode('%PDF-1.7')));
});

const SHELL_NEXT = `<!DOCTYPE html><html><head><title>Acme Classes | Best IIT JEE coaching in Kota with a very long title</title>
<meta name="description" content="${'Acme '.repeat(200)}"><style>body{margin:0}</style></head>
<body><noscript>You need to enable JavaScript to run this app.</noscript><div id="__next"></div>
<script>${'var a=1;'.repeat(2000)}</script></body></html>`;

test('looksLikeJsShell detects empty framework shells', () => {
  assert.ok(L.looksLikeJsShell(SHELL_NEXT));
  assert.ok(L.looksLikeJsShell('<html><body><div id="root"></div><script src="/main.js"></script></body></html>'));
  assert.ok(L.looksLikeJsShell("<html><body><div id='app'>Loading…</div></body></html>"));
  assert.ok(L.looksLikeJsShell('<html><body><div id=root></div></body></html>'));
});

test('looksLikeJsShell leaves real pages alone', () => {
  const text = 'We are a coaching institute in Indore with 20 years of results. '.repeat(10);
  // server-rendered Next.js page: mount node present but full of text
  assert.ok(!L.looksLikeJsShell(`<html><body><div id="__next"><main><p>${text}</p></main></div></body></html>`));
  // little text but no mount node (a genuinely small page)
  assert.ok(!L.looksLikeJsShell('<html><body><p>Under construction</p></body></html>'));
  // an id that merely starts with "root"
  assert.ok(!L.looksLikeJsShell('<html><body><div id="rooted"></div></body></html>'));
  assert.ok(!L.looksLikeJsShell(''));
});

test('visibleText ignores head, scripts, styles and comments', () => {
  const t = L.visibleText('<html><head><title>T</title></head><body><!-- c --><script>x()</script><style>.a{}</style><p>Hello&nbsp;<b>world</b></p></body></html>');
  assert.equal(t, 'Hello world');
});

test('daily cap resets on a new local day', () => {
  const d1 = new Date(2026, 9, 25, 23, 59);
  const d2 = new Date(2026, 9, 26, 0, 1);
  const s = { ...L.emptyStats(d1), pages: 300, errors: 4, lastError: 'x', lastRunAt: 1 };
  assert.equal(L.localDay(d1), '2026-10-25');
  assert.equal(L.remainingToday(s, 300, d1), 0);
  const rolled = L.rollDay(s, d2);
  assert.equal(rolled.day, '2026-10-26');
  assert.equal(rolled.pages, 0);
  assert.equal(rolled.errors, 0);
  assert.equal(rolled.lastError, 'x');
  assert.equal(L.remainingToday(s, 300, d2), 300);
  assert.equal(L.remainingToday({ ...L.emptyStats(d1), pages: 299 }, 300, d1), 1);
  assert.equal(L.rollDay(undefined, d1).pages, 0);
});

test('claimCount respects parallel limit, cap, carry-over and time left', () => {
  assert.equal(L.claimCount({ remaining: 300, maxParallel: 2 }), 2);
  assert.equal(L.claimCount({ remaining: 1, maxParallel: 2 }), 1);
  assert.equal(L.claimCount({ remaining: 0, maxParallel: 2 }), 0);
  assert.equal(L.claimCount({ remaining: 300, maxParallel: 2, carried: 1 }), 1);
  assert.equal(L.claimCount({ remaining: 300, maxParallel: 2, carried: 2 }), 0);
  assert.equal(L.claimCount({ remaining: 1, maxParallel: 2, carried: 1 }), 0);
  assert.equal(L.claimCount({ remaining: 300, maxParallel: 2, msLeft: 2000 }), 0);
  assert.equal(L.claimCount({ remaining: 300, maxParallel: 2, msLeft: 20000 }), 2);
  assert.equal(L.clampParallel(4), 2);
  assert.equal(L.clampParallel(0), 1);
  assert.equal(L.clampParallel(undefined), 2);
});

test('backoff after 5 consecutive failures, for 10 minutes; success resets', () => {
  let h = { consecutiveFailures: 0, backoffUntil: 0 };
  const now = 1_000_000;
  for (let i = 0; i < 4; i++) h = L.applyOutcome(h, false, now);
  assert.equal(h.consecutiveFailures, 4);
  assert.ok(!L.isBackingOff(h, now));
  h = L.applyOutcome(h, true, now);
  assert.equal(h.consecutiveFailures, 0);
  for (let i = 0; i < 5; i++) h = L.applyOutcome(h, false, now);
  assert.ok(L.isBackingOff(h, now));
  assert.equal(h.backoffUntil, now + L.BACKOFF_MS);
  assert.ok(!L.isBackingOff(h, now + L.BACKOFF_MS + 1));
});

test('leaseStillValid', () => {
  const now = 1_000_000;
  assert.ok(L.leaseStillValid({ claimedAt: now - 30_000, leaseS: 120, timeout_ms: 20000 }, now));
  assert.ok(!L.leaseStillValid({ claimedAt: now - 100_000, leaseS: 120, timeout_ms: 20000 }, now));
});

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

test('runHostSerialized: never two tasks for one host at once, at most N in flight', async () => {
  const tasks = [
    { id: 1, url: 'https://a.com/1' },
    { id: 2, url: 'https://www.a.com/2' },
    { id: 3, url: 'https://b.com/1' },
    { id: 4, url: 'https://c.com/1' },
    { id: 5, url: 'https://A.com/3' },
  ];
  const activeHosts = new Map();
  let inFlight = 0;
  let maxInFlight = 0;
  const order = [];
  const results = await L.runHostSerialized(tasks, {
    concurrency: 2,
    keyOf: (t) => L.siteKey(t.url),
    run: async (t) => {
      const k = L.siteKey(t.url);
      assert.ok(!activeHosts.get(k), `two tasks for ${k} at once`);
      activeHosts.set(k, true);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(t.id);
      await delay(10 + (t.id % 3) * 5);
      inFlight--;
      activeHosts.set(k, false);
      return t.id * 10;
    },
  });
  assert.equal(maxInFlight, 2);
  assert.deepEqual(results.map((r) => r.value), [10, 20, 30, 40, 50]);
  assert.equal(order.length, 5);
  // the second a.com task must not start before the first finished: b.com goes in parallel with task 1
  assert.deepEqual(order.slice(0, 2), [1, 3]);
});

test('runHostSerialized: errors are captured, empty input resolves', async () => {
  assert.deepEqual(await L.runHostSerialized([], { keyOf: () => 'x', run: async () => 1 }), []);
  const r = await L.runHostSerialized([1, 2], {
    concurrency: 2,
    keyOf: (x) => String(x),
    run: async (x) => {
      if (x === 2) throw new Error('boom');
      return x;
    },
  });
  assert.deepEqual(r[0], { ok: true, value: 1 });
  assert.equal(r[1].ok, false);
  assert.equal(r[1].error.message, 'boom');
});

test('runHostSerialized: same host runs strictly one after another', async () => {
  const log = [];
  await L.runHostSerialized(['https://x.com/1', 'https://x.com/2', 'https://x.com/3'], {
    concurrency: 2,
    keyOf: L.siteKey,
    run: async (u) => {
      log.push(`start ${u}`);
      await delay(5);
      log.push(`end ${u}`);
    },
  });
  assert.deepEqual(log, [
    'start https://x.com/1',
    'end https://x.com/1',
    'start https://x.com/2',
    'end https://x.com/2',
    'start https://x.com/3',
    'end https://x.com/3',
  ]);
});

test('badgeFor', () => {
  assert.equal(L.badgeFor({ connected: false }).text, '');
  assert.equal(L.badgeFor({ connected: false, disconnected: { reason: 'revoked' } }).text, '!');
  assert.equal(L.badgeFor({ connected: true, paused: true, siteAccess: true }).text, 'II');
  assert.equal(L.badgeFor({ connected: true, siteAccess: false }).text, '!');
  assert.equal(L.badgeFor({ connected: true, siteAccess: true, backingOff: true }).text, '!');
  assert.equal(L.badgeFor({ connected: true, siteAccess: true, lastTickError: true }).text, '!');
  assert.equal(L.badgeFor({ connected: true, siteAccess: true, pagesToday: 0 }).text, '');
  assert.equal(L.badgeFor({ connected: true, siteAccess: true, pagesToday: 42 }).text, '42');
});
