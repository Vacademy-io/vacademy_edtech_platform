/**
 * The early script in index.html that takes an order link token ("/order#l=<token>", contract
 * WP-33 §4.4) out of the address before any other script runs: run as written, in a sandbox,
 * for the shapes it acts on and every shape it must leave alone; and the page structure that
 * makes it run before Sentry, analytics and every module (the entry module is deferred, and
 * catalogue tracking is injected later still, from a React effect).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { HELD_ORDER_LINK, takeHeldOrderLink } from '../logic/checkout';

const TOKEN = 'l1.b3JkZXItMXwxNzAwMDAwMDAwfDB8U0g.c2lnbmF0dXJlLXNpZ24';

const page = () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const match = html.match(/<script>\s*\/\/ Sign-in hand-off[\s\S]*?<\/script>/);
    if (!match) throw new Error('no early script in index.html');
    return { html, block: match[0], script: match[0].replace(/<\/?script>/g, '') };
};

type Run = { writes: unknown[][]; window: Record<string, unknown>; stored: Map<string, string> };

const runEarly = (address: string, overrides: Record<string, unknown> = {}): Run => {
    const url = new URL(address, 'https://shop.example.com');
    const writes: unknown[][] = [];
    const window: Record<string, unknown> = {};
    const stored = new Map<string, string>();
    const storage = { setItem: (k: string, v: string) => void stored.set(k, v), getItem: (k: string) => stored.get(k) ?? null };
    runInNewContext(page().script, {
        window,
        Date,
        JSON,
        sessionStorage: storage,
        localStorage: storage,
        location: { search: url.search, pathname: url.pathname, hash: url.hash },
        history: { state: { __TSR_index: 2 }, replaceState: (...args: unknown[]) => writes.push(args) },
        URLSearchParams,
        Object,
        ...overrides,
    });
    return { writes, window, stored };
};

describe('the early order-link script in index.html', () => {
    it('takes a well-formed link token out of the address and keeps it in memory only', () => {
        const { writes, window, stored } = runEarly(`/shop/order?lang=en#l=${TOKEN}`);
        expect(writes).toHaveLength(1);
        // History state kept, query kept, fragment gone.
        expect(writes[0]![0]).toEqual({ __TSR_index: 2 });
        expect(writes[0]![2]).toBe('/shop/order?lang=en');
        expect(String(writes[0]![2])).not.toContain(TOKEN);
        expect(window[HELD_ORDER_LINK]).toBe(TOKEN);
        // Not enumerable: a script that walks window's keys does not see it.
        expect(Object.keys(window)).not.toContain(HELD_ORDER_LINK);
        // Never in storage.
        expect(stored.size).toBe(0);
    });

    it('works on a custom domain (the order page at /order) and with a trailing slash', () => {
        expect(runEarly(`/order#l=${TOKEN}`).writes[0]![2]).toBe('/order');
        expect(runEarly(`/my-shop/order/#l=${TOKEN}`).writes[0]![2]).toBe('/my-shop/order/');
    });

    it.each([
        ['an address without a fragment', '/shop/order'],
        ['an ordinary anchor', '/shop/order#details'],
        ['another page', `/shop/checkout#l=${TOKEN}`],
        ['a page whose name only ends in "order"', `/shop/reorder#l=${TOKEN}`],
        ['a non-shop page', `/dashboard#l=${TOKEN}`],
        ['a token of another kind', '/shop/order#l=v1.abc.def'],
        ['a token of the wrong shape', '/shop/order#l=l1.abc'],
        ['characters a token never has', '/shop/order#l=l1.a%3Cb.c'],
        ['a fragment with more than the link', `/shop/order#l=${TOKEN}&x=1`],
        ['a link after an order token', `/shop/order#t=v1.a.b&l=${TOKEN}`],
        ['a token longer than 200 characters', `/shop/order#l=l1.${'a'.repeat(200)}.b`],
        ['sign-in tokens in the query', '/login?accessToken=A1#a'],
    ])('leaves %s alone', (_label, address) => {
        const { writes, window } = runEarly(address);
        expect(writes.filter((w) => String(w[2]).includes('order'))).toHaveLength(0);
        expect(window[HELD_ORDER_LINK]).toBeUndefined();
    });

    it('never throws when the address cannot be written', () => {
        expect(() =>
            runEarly(`/shop/order#l=${TOKEN}`, {
                history: {
                    state: null,
                    replaceState: () => {
                        throw new Error('SecurityError');
                    },
                },
            })
        ).not.toThrow();
    });

    it('is plain ES5, like the rest of the early script', () => {
        const code = page().script.replace(/\/\/.*$/gm, '');
        expect(code).not.toMatch(/=>|`|\b(let|const|class)\b|\.\.\./);
    });
});

/** Every <script> of the page in order, with its tag, its inline body and where it starts. */
const scriptsOf = (html: string) =>
    [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({ attrs: m[1] ?? '', body: m[2] ?? '', at: m.index ?? 0 }));

/** The inline scripts that run before the early order-link script. */
const scriptsBefore = () => {
    const { html, block } = page();
    const at = html.indexOf(block);
    return scriptsOf(html).filter((s) => s.at < at);
};

const TRACKING = /gtag|googletagmanager|\bgtm\b|GTM-|dataLayer|\bfbq\b|fbevents|connect\.facebook|Sentry|sentry|amplitude|clarity|hotjar|posthog|mixpanel|segment\.(io|com)/;
// Reading the whole address, or any channel that can carry data off the page.
const WHOLE_ADDRESS = /location\.href|document\.URL|documentURI|document\.location|location\.toString|String\(\s*(window\.)?location\s*\)|(window\.)?location\s*\+/;
const SENDS = /fetch\s*\(|sendBeacon|XMLHttpRequest|new\s+Image|WebSocket|EventSource|document\.write|\.src\s*=|import\s*\(|importScripts|localStorage|sessionStorage|document\.cookie/;

/**
 * A page sandbox with a live address: history.replaceState moves it, as in a browser.
 * `framed` runs it as the in-app class frame (self !== top).
 */
const pageSandbox = (address: string, framed = false) => {
    const url = new URL(address, 'https://shop.example.com');
    const location = { search: url.search, pathname: url.pathname, hash: url.hash };
    const posted: unknown[] = [];
    const writes: unknown[][] = [];
    const stored = new Map<string, string>();
    const storage = { setItem: (k: string, v: string) => void stored.set(k, v), getItem: (k: string) => stored.get(k) ?? null };
    let stopped = false;
    const ctx: Record<string, unknown> = {
        Date,
        JSON,
        Object,
        URLSearchParams,
        location,
        sessionStorage: storage,
        localStorage: storage,
        document: { documentElement: { innerHTML: '<head></head>' } },
        history: {
            state: { __TSR_index: 1 },
            replaceState: (...args: unknown[]) => {
                writes.push(args);
                const next = new URL(String(args[2]), url);
                Object.assign(location, { search: next.search, pathname: next.pathname, hash: next.hash });
            },
        },
        stop: () => {
            stopped = true;
        },
    };
    ctx.window = ctx;
    ctx.self = ctx;
    ctx.top = framed ? {} : ctx;
    ctx.parent = framed ? { postMessage: (message: unknown) => posted.push(message) } : ctx;
    ctx.postMessage = (message: unknown) => posted.push(message);
    const run = (code: string) => runInNewContext(code, ctx);
    return { ctx, location, posted, writes, stored, run, stopped: () => stopped };
};

describe('the page structure: the token is gone before tracking, Sentry or any module runs', () => {
    it('the early script comes before every external script and every module (the entry that starts Sentry and the router included)', () => {
        const { html, block } = page();
        expect(block).toContain(HELD_ORDER_LINK);
        const end = html.indexOf(block) + block.length;
        const scripts = scriptsOf(html);
        const loaded = scripts.filter((s) => /\bsrc\s*=/.test(s.attrs) || /type\s*=\s*["']?module/.test(s.attrs));
        expect(loaded.length).toBeGreaterThan(0);
        for (const s of loaded) expect(s.at).toBeGreaterThanOrEqual(end);
        const entry = scripts.find((s) => s.attrs.includes('/src/main.tsx'));
        expect(entry?.attrs).toContain('type="module"');
        expect(entry!.at).toBeGreaterThan(end);
        // Nothing but the charset and inline scripts ahead of it: no preloads, no other tags that fetch.
        const head = html.slice(0, html.indexOf(block)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
        expect(head.slice(head.indexOf('<head>') + '<head>'.length).trim()).toMatch(/^<meta charset="UTF-8"\s*\/?>$/);
        // No analytics loaded by the page itself: tracking is injected by the app, after the entry.
        expect(html).not.toMatch(/googletagmanager|fbevents|connect\.facebook|gtag\/js/);
    });

    it('inline scripts allowed before it carry no tracking, never read the whole address and send nothing off the page', () => {
        for (const s of scriptsBefore()) {
            expect(s.attrs.trim()).toBe(''); // inline, classic
            const code = s.body.replace(/\/\/.*$/gm, '');
            expect(code).not.toMatch(TRACKING);
            expect(code).not.toMatch(WHOLE_ADDRESS);
            expect(code).not.toMatch(SENDS);
            // The fragment may only be handed back to the address it came from.
            const withoutReplace = code.replace(/history\.replaceState\([^;]*\);/g, '');
            expect(withoutReplace).not.toMatch(/\.hash\b/);
        }
    });

    it.each([
        ['an order link', `/shop/order?lang=en#l=${TOKEN}`],
        ['an order link that also carries the live-class exit marker', `/shop/order?vxBbbExit=1&lang=en#l=${TOKEN}`],
    ])('run in order on %s, the earlier scripts never send the token and leave it for the order-link script', (_label, address) => {
        for (const framed of [false, true]) {
            const sandbox = pageSandbox(address, framed);
            for (const s of scriptsBefore()) sandbox.run(s.body);
            // Nothing that left the page (a frame message) holds the fragment or the token.
            for (const message of sandbox.posted) expect(JSON.stringify(message)).not.toContain(TOKEN);
            expect(sandbox.stored.size).toBe(0);
            if (sandbox.stopped()) {
                // The class frame stops the page here; the token stays in that frame's own address.
                expect(framed).toBe(true);
                continue;
            }
            // The fragment is still in the address, so the order-link script still takes it.
            expect(sandbox.location.hash).toBe(`#l=${TOKEN}`);
            sandbox.run(page().script);
            expect(sandbox.ctx[HELD_ORDER_LINK]).toBe(TOKEN);
            expect(sandbox.location.hash).toBe('');
            expect(`${sandbox.location.pathname}${sandbox.location.search}`).toBe('/shop/order?lang=en');
        }
    });
});

describe('takeHeldOrderLink', () => {
    it('reads the held token once and removes the holder', () => {
        const { window } = runEarly(`/shop/order#l=${TOKEN}`);
        // Rebuilt with the same property shape: the sandbox object belongs to another realm.
        const win = {} as Record<string, unknown>;
        Object.defineProperty(win, HELD_ORDER_LINK, { configurable: true, writable: true, value: window[HELD_ORDER_LINK] });
        expect(takeHeldOrderLink(win as unknown as Window)).toBe(TOKEN);
        expect(HELD_ORDER_LINK in win).toBe(false);
        expect(takeHeldOrderLink(win as unknown as Window)).toBeNull();
    });

    it('drops a held value that is not shaped like a link token, and removes it too', () => {
        const win = { [HELD_ORDER_LINK]: 'l1.a<b.c' } as Record<string, unknown>;
        expect(takeHeldOrderLink(win as unknown as Window)).toBeNull();
        expect(HELD_ORDER_LINK in win).toBe(false);
        expect(takeHeldOrderLink({ [HELD_ORDER_LINK]: 42 } as unknown as Window)).toBeNull();
        expect(takeHeldOrderLink({} as Window)).toBeNull();
        expect(takeHeldOrderLink(undefined)).toBeNull();
    });
});
