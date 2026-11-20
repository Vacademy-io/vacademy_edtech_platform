/**
 * Demo stage bridge.
 *
 * The public product demo (the "stage" page) shows this real app in an iframe,
 * signed in to the demo institute, and drives it: open a page, spotlight an
 * element, move a pointer, click a tab. The stage is on another origin, so it
 * cannot touch this DOM; it sends commands over postMessage and this file
 * carries them out.
 *
 * Safety rules this file keeps:
 * - Demo mode only exists inside the stage's named iframe (DEMO_FRAME_NAME).
 *   A normal tab, the native app and any other frame never enter it.
 * - Only the parent window on a stage origin (isAllowedStageOrigin) is obeyed.
 * - A sign-in handed over by the stage is accepted only on the demo app host
 *   (DEMO_APP_HOSTS), never on dash.vacademy.io or a customer's admin domain,
 *   so a demo can never replace a real admin's session.
 * - Requests that would change data are refused here (demoBlocksRequest). That
 *   is a courtesy for the visitor, not the security boundary: the demo user is
 *   also read-only on the server.
 */

import Cookies from 'js-cookie';

export const DEMO_MESSAGE_SOURCE = 'vx-demo';
export const DEMO_FRAME_NAME = 'vx-demo-stage';

/** Hosts this app is served on for the public demo. */
const DEMO_APP_HOSTS = ['demo-app.vacademy.io'];
/** Pages that may drive the demo. */
const STAGE_ORIGINS = ['https://vacademy.io', 'https://www.vacademy.io', 'https://demo.vacademy.io'];

const isLocalHost = (host: string) => host === 'localhost' || host === '127.0.0.1';

const isFramed = (): boolean => {
    try {
        return window.self !== window.top;
    } catch {
        return true;
    }
};

/** True when this window is the demo stage's iframe. */
export function isDemoStage(): boolean {
    if (typeof window === 'undefined' || !isFramed()) return false;
    try {
        return window.name === DEMO_FRAME_NAME;
    } catch {
        return false;
    }
}

export function isAllowedStageOrigin(origin: string, dev: boolean): boolean {
    let url: URL;
    try {
        url = new URL(origin);
    } catch {
        return false;
    }
    if (isLocalHost(url.hostname)) return dev;
    return STAGE_ORIGINS.includes(url.origin);
}

const acceptsHandedSignIn = (dev: boolean): boolean => {
    const host = window.location.hostname.toLowerCase();
    return DEMO_APP_HOSTS.includes(host) || (dev && isLocalHost(host));
};

// ── Read-only courtesy guard ────────────────────────────────────────────────

// Many list and search endpoints are POSTs. These path words mark a read.
const READ_PATH =
    /(\/|-|_)(get|list|search|filter|fetch|find|details?|paginated|page|query|report|reports|analytics|stats|summary|count|counts|overview|dashboard|export|preview|validate|check|lookup|options|init|all|capabilities|by-[a-z-]+|me)(\/|-|_|\?|$)/i;

/** True when demo mode should refuse this request because it would change data. */
export function demoBlocksRequest(method: string | undefined, url: string | undefined): boolean {
    if (!isDemoStage()) return false;
    const verb = (method || 'get').toLowerCase();
    if (verb === 'get' || verb === 'head' || verb === 'options') return false;
    let path = url || '';
    try {
        path = new URL(path, window.location.origin).pathname;
    } catch {
        // keep the raw value
    }
    if (verb === 'post' && READ_PATH.test(path)) return false;
    notifyBlocked(verb, path);
    return true;
}

// ── Talking to the stage ────────────────────────────────────────────────────

let parentOrigin: string | null = null;

const post = (payload: Record<string, unknown>) => {
    if (!parentOrigin) return;
    try {
        window.parent.postMessage({ source: DEMO_MESSAGE_SOURCE, ...payload }, parentOrigin);
    } catch {
        // noop
    }
};

let lastBlockedAt = 0;
function notifyBlocked(method: string, path: string) {
    post({ type: 'blocked', method, path });
    const now = Date.now();
    if (now - lastBlockedAt < 4000) return;
    lastBlockedAt = now;
    showToast('This is a live demo, so changes are not saved.');
}

// ── Finding elements ────────────────────────────────────────────────────────

export interface DemoTarget {
    /** CSS selector. */
    sel: string;
    /** Keep only elements whose text contains this (case-insensitive). */
    text?: string;
    /** Which match to take when several fit (default 0). */
    nth?: number;
    /** After matching, step out to the nearest ancestor that fits this selector (a card, a row). */
    closest?: string;
}

const visible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
};

function find(target: DemoTarget | string): HTMLElement | null {
    const t: DemoTarget = typeof target === 'string' ? { sel: target } : target;
    let nodes: Element[];
    try {
        nodes = Array.from(document.querySelectorAll(t.sel));
    } catch {
        return null;
    }
    nodes = nodes.filter(visible);
    if (t.text) {
        const want = t.text.toLowerCase();
        nodes = nodes.filter((n) => (n.textContent || '').toLowerCase().includes(want));
        // Prefer the innermost match: a wrapper also "contains" the text.
        nodes = nodes.filter((n) => !nodes.some((other) => other !== n && n.contains(other)));
    }
    const hit = (nodes[t.nth ?? 0] as HTMLElement | undefined) ?? null;
    if (!hit || !t.closest) return hit;
    try {
        return (hit.closest(t.closest) as HTMLElement | null) ?? hit;
    } catch {
        return hit;
    }
}

function waitFor(target: DemoTarget | string, timeoutMs: number): Promise<HTMLElement | null> {
    return new Promise((resolve) => {
        const started = Date.now();
        const tick = () => {
            const el = find(target);
            if (el) return resolve(el);
            if (Date.now() - started > timeoutMs) return resolve(null);
            window.setTimeout(tick, 120);
        };
        tick();
    });
}

/** Resolves when the element has stopped moving (page settled, animation done). */
function settle(el: HTMLElement, maxMs = 1500): Promise<void> {
    return new Promise((resolve) => {
        const started = Date.now();
        let last = el.getBoundingClientRect();
        let still = 0;
        const tick = () => {
            const now = el.getBoundingClientRect();
            const moved = Math.abs(now.top - last.top) + Math.abs(now.left - last.left) > 1;
            still = moved ? 0 : still + 1;
            last = now;
            if (still >= 4 || Date.now() - started > maxMs) return resolve();
            window.setTimeout(tick, 60);
        };
        tick();
    });
}

// ── Overlay: spotlight ring, caption, pointer, toast ────────────────────────

const Z = 2147483000;
let root: HTMLDivElement | null = null;
let ring: HTMLDivElement | null = null;
let caption: HTMLDivElement | null = null;
let pointer: HTMLDivElement | null = null;
let toast: HTMLDivElement | null = null;
let spotEl: HTMLElement | null = null;
let spotPad = 8;
let raf = 0;
let pointerAt = { x: 0, y: 0 };

function ensureOverlay() {
    if (root) return;
    root = document.createElement('div');
    root.setAttribute('data-demo-overlay', '');
    root.style.cssText = `position:fixed;inset:0;pointer-events:none;z-index:${Z};font-family:inherit;`;

    ring = document.createElement('div');
    ring.style.cssText =
        'position:fixed;display:none;border-radius:10px;box-shadow:0 0 0 3px hsl(var(--primary-500)),0 0 0 9999px rgba(15,23,42,.45);transition:top .35s ease,left .35s ease,width .35s ease,height .35s ease;';

    caption = document.createElement('div');
    caption.style.cssText =
        'position:fixed;display:none;max-width:320px;background:hsl(var(--background));color:hsl(var(--foreground));border-radius:12px;padding:12px 14px;box-shadow:0 12px 32px rgba(15,23,42,.25);font-size:14px;line-height:1.45;transition:top .35s ease,left .35s ease;';

    pointer = document.createElement('div');
    pointer.style.cssText =
        'position:fixed;display:none;left:0;top:0;width:26px;height:26px;transition:transform .7s cubic-bezier(.22,.8,.3,1);will-change:transform;';
    pointer.innerHTML =
        '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 2l16 9-7 2-3 7z" fill="hsl(var(--foreground))" stroke="hsl(var(--background))" stroke-width="1.6" stroke-linejoin="round"/></svg>';

    toast = document.createElement('div');
    toast.style.cssText =
        'position:fixed;display:none;left:50%;bottom:24px;transform:translateX(-50%);background:hsl(var(--foreground));color:hsl(var(--background));border-radius:999px;padding:10px 18px;font-size:13px;box-shadow:0 8px 24px rgba(15,23,42,.3);';

    root.append(ring, caption, pointer, toast);
    document.body.appendChild(root);
}

let toastTimer: number | undefined;
function showToast(text: string) {
    ensureOverlay();
    if (!toast) return;
    toast.textContent = text;
    toast.style.display = 'block';
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
        if (toast) toast.style.display = 'none';
    }, 3200);
}

function place() {
    raf = 0;
    if (!spotEl || !ring || !caption) return;
    if (!spotEl.isConnected) {
        clearSpot();
        return;
    }
    const r = spotEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top = Math.max(4, r.top - spotPad);
    const left = Math.max(4, r.left - spotPad);
    const width = Math.min(vw - left - 4, r.width + spotPad * 2);
    const height = Math.min(vh - top - 4, r.height + spotPad * 2);
    ring.style.top = `${top}px`;
    ring.style.left = `${left}px`;
    ring.style.width = `${width}px`;
    ring.style.height = `${height}px`;

    if (caption.style.display !== 'none') {
        const c = caption.getBoundingClientRect();
        // Below the target when it fits, otherwise above, otherwise beside.
        let cTop = top + height + 12;
        let cLeft = left;
        if (cTop + c.height > vh - 8) cTop = top - c.height - 12;
        if (cTop < 8) {
            cTop = Math.max(8, Math.min(vh - c.height - 8, top));
            cLeft = left + width + 12;
            if (cLeft + c.width > vw - 8) cLeft = left - c.width - 12;
        }
        cLeft = Math.max(8, Math.min(vw - c.width - 8, cLeft));
        caption.style.top = `${cTop}px`;
        caption.style.left = `${cLeft}px`;
    }
    raf = window.requestAnimationFrame(place);
}

function clearSpot() {
    spotEl = null;
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    if (ring) ring.style.display = 'none';
    if (caption) caption.style.display = 'none';
}

function clearAll() {
    clearSpot();
    if (pointer) pointer.style.display = 'none';
}

async function spotlight(el: HTMLElement, opts: { title?: string; text?: string; pad?: number }) {
    ensureOverlay();
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    await settle(el);
    spotEl = el;
    spotPad = opts.pad ?? 8;
    if (ring) ring.style.display = 'block';
    if (caption) {
        if (opts.title || opts.text) {
            caption.replaceChildren();
            if (opts.title) {
                const h = document.createElement('div');
                h.style.cssText = 'font-weight:600;margin-bottom:4px;';
                h.textContent = opts.title;
                caption.appendChild(h);
            }
            if (opts.text) {
                const p = document.createElement('div');
                p.textContent = opts.text;
                caption.appendChild(p);
            }
            caption.style.display = 'block';
        } else {
            caption.style.display = 'none';
        }
    }
    if (!raf) raf = window.requestAnimationFrame(place);
}

function movePointer(el: HTMLElement): Promise<void> {
    ensureOverlay();
    return new Promise((resolve) => {
        if (!pointer) return resolve();
        const r = el.getBoundingClientRect();
        const x = r.left + Math.min(r.width / 2, 120);
        const y = r.top + r.height / 2;
        if (pointer.style.display === 'none') {
            // First appearance: start from the middle of the screen.
            pointerAt = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
            pointer.style.transition = 'none';
            pointer.style.transform = `translate(${pointerAt.x}px,${pointerAt.y}px)`;
            pointer.style.display = 'block';
            void pointer.offsetWidth;
            pointer.style.transition = 'transform .7s cubic-bezier(.22,.8,.3,1)';
        }
        pointerAt = { x, y };
        pointer.style.transform = `translate(${x}px,${y}px)`;
        window.setTimeout(resolve, 760);
    });
}

function pulse(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    const dot = document.createElement('div');
    dot.style.cssText = `position:fixed;left:${pointerAt.x - 14}px;top:${pointerAt.y - 14}px;width:28px;height:28px;border-radius:50%;background:rgba(237,116,36,.45);transform:scale(.3);transition:transform .4s ease,opacity .4s ease;`;
    root?.appendChild(dot);
    void dot.offsetWidth;
    dot.style.transform = 'scale(1.6)';
    dot.style.opacity = '0';
    window.setTimeout(() => dot.remove(), 450);
    void r;
}

// ── Commands ────────────────────────────────────────────────────────────────

interface StageRouter {
    navigate: (opts: { href: string; replace?: boolean }) => Promise<unknown> | unknown;
    subscribe: (event: 'onResolved', fn: () => void) => () => void;
}

/**
 * A click as a mouse makes it. Tabs, menus and selects built on Radix act on
 * pointerdown/mousedown, so a bare el.click() leaves them unchanged.
 */
function pressLikeAMouse(el: HTMLElement): void {
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...at, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mousedown', at));
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', { ...at, pointerType: 'mouse', isPrimary: true }));
    el.dispatchEvent(new MouseEvent('mouseup', at));
    el.click();
}

type Command =
    | { type: 'ping' }
    | { type: 'auth'; accessToken: string; refreshToken: string; instituteId?: string; to?: string }
    | { type: 'go'; to: string }
    | {
          type: 'spot';
          target: DemoTarget | string;
          title?: string;
          text?: string;
          pad?: number;
          timeout?: number;
      }
    | { type: 'point'; target: DemoTarget | string; click?: boolean; timeout?: number }
    | { type: 'wait'; target: DemoTarget | string; timeout?: number }
    | { type: 'clear' };

let installed = false;

/** Wire the demo iframe to its stage. No-op outside demo mode. */
export function installDemoBridge(router: StageRouter, dev: boolean): void {
    if (installed || !isDemoStage()) return;
    installed = true;
    document.documentElement.setAttribute('data-demo-stage', '');

    const run = async (cmd: Command): Promise<{ ok: boolean; error?: string }> => {
        switch (cmd.type) {
            case 'ping':
                return { ok: true };
            case 'auth': {
                if (!acceptsHandedSignIn(dev)) return { ok: false, error: 'host_not_demo' };
                const secure = window.location.protocol === 'https:';
                // Session cookies: the demo sign-in ends with the browser session.
                Cookies.set('accessToken', cmd.accessToken, { sameSite: 'lax', secure });
                Cookies.set('refreshToken', cmd.refreshToken, { sameSite: 'lax', secure });
                if (cmd.instituteId) {
                    try {
                        localStorage.setItem('selectedInstituteId', cmd.instituteId);
                    } catch {
                        // noop
                    }
                }
                await router.navigate({ href: cmd.to || '/dashboard', replace: true });
                return { ok: true };
            }
            case 'go': {
                if (!cmd.to.startsWith('/')) return { ok: false, error: 'bad_route' };
                clearAll();
                await router.navigate({ href: cmd.to });
                return { ok: true };
            }
            case 'wait': {
                const el = await waitFor(cmd.target, cmd.timeout ?? 8000);
                return el ? { ok: true } : { ok: false, error: 'not_found' };
            }
            case 'spot': {
                const el = await waitFor(cmd.target, cmd.timeout ?? 8000);
                if (!el) return { ok: false, error: 'not_found' };
                await spotlight(el, cmd);
                return { ok: true };
            }
            case 'point': {
                const el = await waitFor(cmd.target, cmd.timeout ?? 8000);
                if (!el) return { ok: false, error: 'not_found' };
                el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
                await settle(el);
                await movePointer(el);
                if (cmd.click) {
                    pulse(el);
                    clearSpot();
                    pressLikeAMouse(el);
                }
                return { ok: true };
            }
            case 'clear':
                clearAll();
                return { ok: true };
            default:
                return { ok: false, error: 'unknown_command' };
        }
    };

    window.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as ({ source?: string; id?: string } & Command) | null;
        if (!data || data.source !== DEMO_MESSAGE_SOURCE) return;
        if (event.source !== window.parent) return;
        if (!isAllowedStageOrigin(event.origin, dev)) return;
        parentOrigin = event.origin;
        void run(data)
            .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : 'failed' }))
            .then((result) => post({ type: 'result', id: data.id, cmd: data.type, ...result }));
    });

    router.subscribe('onResolved', () => {
        post({ type: 'route', path: window.location.pathname + window.location.search });
    });

    // The stage does not know our origin's readiness; announce to the page that
    // framed us. Only an allowed origin gets it, and only its reply is obeyed.
    let referrer: string | null = null;
    try {
        referrer = document.referrer ? new URL(document.referrer).origin : null;
    } catch {
        referrer = null;
    }
    if (referrer && isAllowedStageOrigin(referrer, dev)) {
        parentOrigin = referrer;
        post({
            type: 'ready',
            path: window.location.pathname,
            signedIn: !!Cookies.get('accessToken'),
        });
    }
}
