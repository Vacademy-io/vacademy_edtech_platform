/**
 * What this page load is for, read from the URL fragment:
 *   #c=<t>                  approve a panel's QR
 *   #pair=<code>            pair a new panel
 *   #s=<scheduleId>&i=<id>  start a class
 *   (empty)                 the remote if a token is stored, else code entry
 *
 * The fragment can hold a one-time code, so it is moved to sessionStorage for
 * 10 minutes and taken off the URL before any request goes out. That also lets a
 * teacher who detours through /login come back to the same step in the same tab.
 */
import { useSyncExternalStore } from 'react';
import { readSessionJson, removeSession, writeSessionJson } from './storage';

const STASH_KEY = 'classroom.route';
const STASH_TTL_MS = 10 * 60 * 1000;

export type PhoneRoute =
    | {
          kind: 'approve';
          t?: string;
          userCode?: string;
          /** The number this phone already tapped, for a reload after a lost response. */
          tapped?: number;
          /** The user id that tapped it. The tap is repeated only for that account. */
          tappedBy?: string;
      }
    | { kind: 'pair'; code: string }
    | { kind: 'start'; scheduleId: string; instituteId: string };

interface Stash {
    route: PhoneRoute;
    at: number;
}

const MAX_VALUE_LENGTH = 128;
const clean = (value: string | null): string | null => {
    const trimmed = (value ?? '').trim();
    return trimmed && trimmed.length <= MAX_VALUE_LENGTH ? trimmed : null;
};

export function parseFragment(hash: string): PhoneRoute | null {
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const t = clean(params.get('c'));
    if (t) return { kind: 'approve', t };
    const code = clean(params.get('pair'));
    if (code) return { kind: 'pair', code };
    const scheduleId = clean(params.get('s'));
    const instituteId = clean(params.get('i'));
    if (scheduleId && instituteId) return { kind: 'start', scheduleId, instituteId };
    return null;
}

function readStash(nowMs: number): PhoneRoute | null {
    const stash = readSessionJson<Stash>(STASH_KEY);
    if (!stash?.route || typeof stash.at !== 'number') return null;
    if (nowMs - stash.at > STASH_TTL_MS || nowMs < stash.at) {
        removeSession(STASH_KEY);
        return null;
    }
    return stash.route;
}

/** Takes a fragment off the URL if there is one, and returns the route to use. */
export function consumeLocation(nowMs = Date.now()): PhoneRoute | null {
    const fromHash = window.location.hash ? parseFragment(window.location.hash) : null;
    if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    if (fromHash) {
        writeSessionJson(STASH_KEY, { route: fromHash, at: nowMs } satisfies Stash);
        return fromHash;
    }
    return readStash(nowMs);
}

// ---------------------------------------------------------------- store ---

let current: PhoneRoute | null = null;
/** Bumps on every new route, so the same QR scanned twice still restarts its screen. */
let revision = 0;
const listeners = new Set<() => void>();

function publish(route: PhoneRoute | null): void {
    current = route;
    revision += 1;
    listeners.forEach((listener) => listener());
}

export function initRoute(): void {
    current = consumeLocation();
    // Opening another QR in this tab only changes the fragment, with no page load.
    window.addEventListener('hashchange', () => {
        const next = consumeLocation();
        if (next) publish(next);
    });
}

export function setRoute(route: PhoneRoute | null): void {
    if (route) writeSessionJson(STASH_KEY, { route, at: Date.now() } satisfies Stash);
    else removeSession(STASH_KEY);
    publish(route);
}

export function clearRoute(): void {
    setRoute(null);
}

/** Records the tap, and who made it, without restarting the screen. */
export function rememberTap(matchCode: number, userId: string | null): void {
    if (current?.kind !== 'approve') return;
    current = { ...current, tapped: matchCode, tappedBy: userId ?? undefined };
    writeSessionJson(STASH_KEY, { route: current, at: Date.now() } satisfies Stash);
}

type ApproveRoute = Extract<PhoneRoute, { kind: 'approve' }>;

function withoutTap(route: ApproveRoute): ApproveRoute {
    const next = { ...route };
    delete next.tapped;
    delete next.tappedBy;
    return next;
}

/** Sign-out: the step stays for the next account, the tap does not. */
export function forgetTap(): void {
    if (current?.kind === 'approve') current = withoutTap(current);
    const stash = readSessionJson<Stash>(STASH_KEY);
    if (stash?.route?.kind === 'approve' && stash.route.tapped !== undefined) {
        writeSessionJson(STASH_KEY, {
            route: withoutTap(stash.route),
            at: stash.at,
        } satisfies Stash);
    }
}

/** The code is spent. The screen stays, and a reload no longer comes back to it. */
export function forgetStash(): void {
    removeSession(STASH_KEY);
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function useRoute(): { route: PhoneRoute | null; revision: number } {
    const rev = useSyncExternalStore(subscribe, () => revision);
    return { route: current, revision: rev };
}
