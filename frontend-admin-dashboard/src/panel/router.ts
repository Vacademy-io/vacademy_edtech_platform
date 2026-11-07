/**
 * Tiny hash router for the panel bundle: `#/<screen>?<query>`.
 *
 * Every navigation is a real history entry (or a replace), so the Android back
 * button / Capacitor's goBack walks it naturally. No @tanstack/react-router.
 */
import { useEffect, useState } from 'react';

export type PanelScreen =
    | 'diagnostics'
    | 'login'
    | 'institutes'
    | 'home'
    | 'whiteboard'
    | 'volt'
    | 'lessons';

export const PANEL_SCREENS: readonly PanelScreen[] = [
    'diagnostics',
    'login',
    'institutes',
    'home',
    'whiteboard',
    'volt',
    'lessons',
];

/** Screens that need a signed-in teacher; others work signed out. */
export const AUTH_REQUIRED_SCREENS: readonly PanelScreen[] = ['institutes', 'volt', 'lessons'];

export interface PanelRoute {
    screen: PanelScreen;
    params: Record<string, string>;
}

function isPanelScreen(value: string): value is PanelScreen {
    return (PANEL_SCREENS as readonly string[]).indexOf(value) >= 0;
}

export function parseHash(hash: string): PanelRoute {
    const raw = hash.replace(/^#\/?/, '');
    const qIndex = raw.indexOf('?');
    const path = (qIndex >= 0 ? raw.slice(0, qIndex) : raw).replace(/\/+$/, '');
    const query = qIndex >= 0 ? raw.slice(qIndex + 1) : '';
    const params: Record<string, string> = {};
    if (query) {
        query.split('&').forEach((pair) => {
            if (!pair) return;
            const eq = pair.indexOf('=');
            const key = decodeURIComponent(eq >= 0 ? pair.slice(0, eq) : pair);
            const value = eq >= 0 ? decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' ')) : '';
            params[key] = value;
        });
    }
    const first = path.split('/')[0] || '';
    return { screen: isPanelScreen(first) ? first : 'home', params };
}

export function buildHash(screen: PanelScreen, params?: Record<string, string>): string {
    const query = params
        ? Object.keys(params)
              .filter((key) => params[key] !== undefined && params[key] !== '')
              .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] ?? '')}`)
              .join('&')
        : '';
    return `#/${screen}${query ? `?${query}` : ''}`;
}

export function getCurrentRoute(): PanelRoute {
    return parseHash(window.location.hash);
}

/** Go to a screen. `replace` swaps the current history entry instead of pushing. */
export function navigate(
    screen: PanelScreen,
    params?: Record<string, string>,
    opts?: { replace?: boolean }
): void {
    const hash = buildHash(screen, params);
    if (window.location.hash === hash) return;
    if (opts?.replace) {
        const url = window.location.href.replace(/#.*$/, '') + hash;
        window.history.replaceState(window.history.state, '', url);
        // replaceState does not fire hashchange; tell the listeners ourselves.
        notifyListeners();
    } else {
        window.location.hash = hash;
    }
}

/** History back; falls back to Home when there is nothing to go back to. */
export function goBack(): void {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        navigate('home', undefined, { replace: true });
    }
}

const listeners = new Set<() => void>();

function notifyListeners(): void {
    listeners.forEach((listener) => listener());
}

let hashListenerInstalled = false;
function ensureHashListener(): void {
    if (hashListenerInstalled) return;
    hashListenerInstalled = true;
    window.addEventListener('hashchange', notifyListeners);
}

/** Subscribe to route changes outside React (returns an unsubscribe function). */
export function subscribeRoute(listener: () => void): () => void {
    ensureHashListener();
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The current screen + query params; re-renders on every hash change. */
export function usePanelRoute(): PanelRoute {
    const [hash, setHash] = useState(() => window.location.hash);
    useEffect(() => {
        const update = () => setHash(window.location.hash);
        const unsubscribe = subscribeRoute(update);
        update();
        return unsubscribe;
    }, []);
    return parseHash(hash);
}

/**
 * Login redirect for auth-required screens (replaces the current entry).
 * The original target comes back through `#/login?next=<screen>?<query>`.
 */
export function redirectToLogin(route: PanelRoute): void {
    const next = buildHash(route.screen, route.params).replace(/^#\//, '');
    navigate('login', { next }, { replace: true });
}

/** Resolve a `next` param written by redirectToLogin back into a route. */
export function routeFromNext(next: string | undefined): PanelRoute | null {
    if (!next) return null;
    const route = parseHash(`#/${next}`);
    return route.screen === 'login' ? null : route;
}
