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

describe('the page structure: the token is gone before tracking, Sentry or any module runs', () => {
    it('the early script is the first script of the page, straight after the charset', () => {
        const { html, block } = page();
        const first = html.indexOf('<script');
        expect(html.indexOf(block)).toBe(first);
        expect(html.slice(0, first).trim()).toMatch(/<meta charset="UTF-8"\s*\/?>$/);
        expect(block).toContain(HELD_ORDER_LINK);
    });

    it('every other script (the entry module that starts Sentry and the router included) comes after it', () => {
        const { html, block } = page();
        const end = html.indexOf(block) + block.length;
        const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => ({ tag: m[0], at: m.index ?? 0 }));
        expect(scripts.length).toBeGreaterThan(1);
        for (const s of scripts.slice(1)) expect(s.at).toBeGreaterThanOrEqual(end);
        const entry = scripts.find((s) => s.tag.includes('/src/main.tsx'));
        expect(entry?.tag).toContain('type="module"');
        // No analytics loaded by the page itself: tracking is injected by the app, after the entry.
        expect(html).not.toMatch(/googletagmanager|fbevents|connect\.facebook|gtag\/js/);
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
