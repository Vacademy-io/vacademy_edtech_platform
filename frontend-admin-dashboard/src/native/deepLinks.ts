import { App, type URLOpenListenerEvent } from '@capacitor/app';
import { isNative } from './platform';
import { getFlavor } from './flavor';

// Accepted deep-link shapes:
//   vimotion://open?path=/vim/dashboard?tab=recent
//   vimotion://video/<id>                  → /vim/dashboard?videoId=<id>
//   https://vimotion.app/v/<id>            → /vim/dashboard?videoId=<id>  (Universal Link)
//   https://<flavor deepLinkHost>/<path>   → /<path>  (App Link, e.g. evalezy.vacademy.io/evalezy/<id>)
export type DeepLinkPayload = { path: string; replace?: boolean };

type DeepLinkListener = (payload: DeepLinkPayload) => void;

// Single-listener queue. Two problems this solves:
//   1. Cold-start race — `App.getLaunchUrl()` resolves asynchronously, often
//      BEFORE the vim shell has rendered. With a raw window event we'd lose
//      the payload. The queue buffers payloads until a listener attaches.
//   2. Triple-mount transition — `useVimotionNativeShell` mounts in three
//      vim screens, so on a login → dashboard navigation there's a frame where
//      the previous listener has been removed and the new one hasn't attached.
//      Any payload arriving during that window goes to the queue and is
//      drained the moment the next listener subscribes.
const pending: DeepLinkPayload[] = [];
let activeListener: DeepLinkListener | null = null;

function deliver(payload: DeepLinkPayload): void {
    if (activeListener) {
        activeListener(payload);
    } else {
        pending.push(payload);
    }
}

export function setDeepLinkListener(listener: DeepLinkListener | null): void {
    activeListener = listener;
    if (!listener) return;
    // Drain anything that arrived before this listener attached.
    while (pending.length > 0) {
        const next = pending.shift();
        if (next) listener(next);
    }
}

function parseUrl(raw: string): DeepLinkPayload | null {
    try {
        const u = new URL(raw);
        // Custom-scheme: vimotion://video/abc123 → host="video", pathname="/abc123"
        if (u.protocol === 'vimotion:') {
            if (u.host === 'open') {
                const path = u.searchParams.get('path');
                return path ? { path } : null;
            }
            if (u.host === 'video') {
                const id = u.pathname.replace(/^\//, '');
                return id ? { path: `/vim/dashboard?videoId=${encodeURIComponent(id)}` } : null;
            }
            return null;
        }
        // App Links / Universal Links on this flavor's own host: the web URL and the
        // in-app route are the same path (the route guard keeps Evalezy in its shell).
        const ownHost = getFlavor().deepLinkHost;
        if (u.protocol === 'https:' && ownHost && u.host.toLowerCase() === ownHost) {
            return { path: (u.pathname || '/') + u.search };
        }
        // Universal links — share the same path mapping.
        if (u.host === 'vimotion.app' || u.host.endsWith('.vimotion.app')) {
            if (u.pathname.startsWith('/v/')) {
                const id = u.pathname.slice(3);
                return id ? { path: `/vim/dashboard?videoId=${encodeURIComponent(id)}` } : null;
            }
            if (u.pathname.startsWith('/vim')) {
                return { path: u.pathname + u.search };
            }
        }
        return null;
    } catch {
        return null;
    }
}

export function initDeepLinks(): void {
    if (!isNative()) return;

    App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
        const payload = parseUrl(event.url);
        if (payload) deliver(payload);
    }).catch(() => {});

    // Cold-start deep link: getLaunchUrl returns the URL that launched the app
    // (once). It typically resolves before React has mounted, so the queue is
    // the only thing keeping the payload alive until the vim shell subscribes.
    App.getLaunchUrl()
        .then((res) => {
            if (!res?.url) return;
            const payload = parseUrl(res.url);
            if (payload) deliver({ ...payload, replace: true });
        })
        .catch(() => {});
}
