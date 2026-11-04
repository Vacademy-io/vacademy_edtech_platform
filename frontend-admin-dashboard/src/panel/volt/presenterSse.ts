/**
 * Presenter SSE adapter (one connection per live session).
 *
 * Wire facts (readers[volt] §5-6, verified in community-service):
 *   GET {BASE}/community-service/engage/admin/{sessionId} (AdminSessionController
 *   .presenterStream) — a 3 h SseEmitter with 'presenter_heartbeat' every 30 s.
 *   Events: 'participants' (full list), 'session_state_presenter'
 *   ({sessionStatus, currentSlideIndex, totalSlides} on connect, {sessionStatus:
 *   'FINISHED'} on finish). The endpoint is permitAll: it sends NO auth, and the
 *   auth cookies are host-only on the dashboard host, so `withCredentials` does
 *   not carry a token (from https://localhost in the APK it carries nothing).
 *   CORS echoes any origin with credentials, so the APK origin is accepted.
 *
 * The backend keeps ONE presenter emitter per session: a second connection
 * completes the first (LiveSessionService.setPresenterEmitter). Callers must hold
 * exactly one adapter per session for both the waiting room and the live view.
 *
 * Kept behind this adapter so a token-in-query or fetch-stream reader can be
 * swapped in if engage/** stops being permitAll.
 */
import { PRESENTER_SSE_URL_BASE } from './voltApi';
import type { VoltParticipant, VoltPresenterState } from './types';

export type PresenterSseStatus = 'connecting' | 'connected' | 'reconnecting' | 'closed';

export interface PresenterSseHandlers {
    onParticipants?: (participants: VoltParticipant[]) => void;
    onState?: (state: VoltPresenterState) => void;
    onStatus?: (status: PresenterSseStatus) => void;
}

export interface PresenterSseConnection {
    readonly sessionId: string;
    getStatus(): PresenterSseStatus;
    /** Drop the current stream and connect again now. */
    reconnect(): void;
    close(): void;
}

/** No event at all (heartbeats are every 30 s) for this long = a dead stream. */
const STALE_MS = 75 * 1000;
const MAX_BACKOFF_MS = 30 * 1000;

function parseJson<T>(raw: unknown): T | null {
    if (typeof raw !== 'string') return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

export function openPresenterSse(
    sessionId: string,
    handlers: PresenterSseHandlers
): PresenterSseConnection {
    let source: EventSource | null = null;
    let status: PresenterSseStatus = 'connecting';
    let closed = false;
    let failures = 0;
    let retryTimer: number | undefined;
    let lastEventAt = Date.now();

    const setStatus = (next: PresenterSseStatus) => {
        if (status === next) return;
        status = next;
        handlers.onStatus?.(next);
    };

    const touch = () => {
        lastEventAt = Date.now();
    };

    const onParticipants = (event: MessageEvent) => {
        touch();
        const list = parseJson<unknown>(event.data);
        if (Array.isArray(list)) handlers.onParticipants?.(list as VoltParticipant[]);
    };

    const onState = (event: MessageEvent) => {
        touch();
        const state = parseJson<VoltPresenterState & { participants?: unknown }>(event.data);
        if (!state) return;
        // ActualPresentationDisplay.tsx:194 also accepts a participants list here.
        if (Array.isArray(state.participants)) {
            handlers.onParticipants?.(state.participants as VoltParticipant[]);
        }
        handlers.onState?.(state);
        if (state.sessionStatus === 'FINISHED') close();
    };

    const detach = () => {
        if (!source) return;
        source.removeEventListener('participants', onParticipants as EventListener);
        source.removeEventListener('session_state_presenter', onState as EventListener);
        source.removeEventListener('presenter_heartbeat', touch);
        source.onopen = null;
        source.onerror = null;
        source.close();
        source = null;
    };

    const scheduleRetry = () => {
        if (closed) return;
        window.clearTimeout(retryTimer);
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, Math.min(failures, 5)));
        retryTimer = window.setTimeout(connect, delay);
    };

    function connect() {
        if (closed) return;
        detach();
        setStatus(failures > 0 ? 'reconnecting' : 'connecting');
        touch();
        let next: EventSource;
        try {
            next = new EventSource(`${PRESENTER_SSE_URL_BASE}${encodeURIComponent(sessionId)}`, {
                withCredentials: true,
            });
        } catch (error) {
            console.error('[panel/volt] EventSource failed', error);
            failures += 1;
            scheduleRetry();
            return;
        }
        source = next;
        next.onopen = () => {
            touch();
            failures = 0;
            setStatus('connected');
        };
        next.addEventListener('participants', onParticipants as EventListener);
        next.addEventListener('session_state_presenter', onState as EventListener);
        next.addEventListener('presenter_heartbeat', touch);
        next.onerror = () => {
            if (closed || source !== next) return;
            failures += 1;
            if (next.readyState === EventSource.CLOSED) {
                // The browser gave up (HTTP error / bad content type): retry ourselves.
                setStatus('reconnecting');
                scheduleRetry();
            } else {
                // readyState CONNECTING: the browser is already retrying.
                setStatus('reconnecting');
            }
        };
    }

    // Half-open sockets on school Wi-Fi never fire onerror; the 30 s heartbeat
    // lets us notice and reconnect.
    const watchdog = window.setInterval(() => {
        if (closed) return;
        if (Date.now() - lastEventAt > STALE_MS) {
            failures += 1;
            connect();
        }
    }, 15 * 1000);

    function close() {
        if (closed) return;
        closed = true;
        window.clearTimeout(retryTimer);
        window.clearInterval(watchdog);
        detach();
        setStatus('closed');
    }

    connect();

    return {
        sessionId,
        getStatus: () => status,
        reconnect: () => {
            if (closed) return;
            failures = 0;
            connect();
        },
        close,
    };
}
