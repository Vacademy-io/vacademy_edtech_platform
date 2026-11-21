import { useCallback, useEffect, useRef, useState } from 'react';
import { LIVE_ACTIVITY_STREAM } from '@/constants/urls';
import {
    fetchLiveActivityEvents,
    fetchStreamToken,
    type LiveActivityCategory,
    type LiveActivityEvent,
} from '../-services/live-activity-service';

const CATEGORY_EVENT_NAMES: LiveActivityCategory[] = [
    'INVITE_FORM',
    'LEAD_FORM',
    'CALL',
    'PAYMENT',
    'COUNSELLOR',
];

const MAX_EVENTS = 500;
const MAX_RECONNECT_DELAY_MS = 30_000;
const BASE_RECONNECT_DELAY_MS = 1_000;

export type StreamStatus = 'connecting' | 'live' | 'reconnecting' | 'error';

interface UseLiveActivityStreamOptions {
    instituteId: string;
    /** Buffer instead of prepending, so the list cannot reorder under the pointer. */
    paused: boolean;
}

interface UseLiveActivityStreamResult {
    events: LiveActivityEvent[];
    /** Held back while paused. Releasing flushes them in one go. */
    bufferedCount: number;
    status: StreamStatus;
    allowedCategories: LiveActivityCategory[];
    releaseBuffer: () => void;
    seed: (events: LiveActivityEvent[]) => void;
}

/**
 * Subscribes to the institute's live activity stream.
 *
 * <p>Modelled on `useAgent`, which listens per named event type rather than through a single
 * `onmessage` -- the server names each frame after its category, so a five-category feed can
 * discriminate without parsing first. Reconnect backoff follows `useChatStream`.
 *
 * <p>Three things this hook has to get right:
 * <ul>
 *   <li><b>Token, not header.</b> EventSource cannot set Authorization, so it mints a
 *       short-lived token first and puts it in the query string. Tokens expire in ~60s, so a
 *       reconnect always mints a fresh one rather than replaying the old.</li>
 *   <li><b>No `withCredentials`.</b> The stream is a permitAll path; adding credentials
 *       triggers a CORS preflight EventSource cannot satisfy.</li>
 *   <li><b>Replay on reconnect, not resume.</b> Postgres LISTEN is at-most-once, so anything
 *       published while the socket was down never arrives. On reconnect the hook refetches
 *       rows newer than the last event it saw and merges by id.</li>
 * </ul>
 */
export function useLiveActivityStream({
    instituteId,
    paused,
}: UseLiveActivityStreamOptions): UseLiveActivityStreamResult {
    const [events, setEvents] = useState<LiveActivityEvent[]>([]);
    const [buffered, setBuffered] = useState<LiveActivityEvent[]>([]);
    const [status, setStatus] = useState<StreamStatus>('connecting');
    const [allowedCategories, setAllowedCategories] = useState<LiveActivityCategory[]>([]);

    const sourceRef = useRef<EventSource | null>(null);
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const attemptRef = useRef(0);
    const closedRef = useRef(false);
    const seenIdsRef = useRef<Set<string>>(new Set());
    const lastEventAtRef = useRef<number>(0);
    // `paused` is read inside the SSE callback, which closes over its first value. A ref
    // keeps the callback reading the live value without tearing down the connection on
    // every toggle.
    const pausedRef = useRef(paused);

    useEffect(() => {
        pausedRef.current = paused;
    }, [paused]);

    const ingest = useCallback((event: LiveActivityEvent) => {
        if (!event?.eventId || seenIdsRef.current.has(event.eventId)) {
            return;
        }
        seenIdsRef.current.add(event.eventId);
        if (event.occurredAtEpochMillis > lastEventAtRef.current) {
            lastEventAtRef.current = event.occurredAtEpochMillis;
        }

        if (pausedRef.current) {
            setBuffered((prev) => [event, ...prev].slice(0, MAX_EVENTS));
            return;
        }
        setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
    }, []);

    /** Seed from the initial backfill, before the stream attaches. */
    const seed = useCallback((initial: LiveActivityEvent[]) => {
        initial.forEach((event) => {
            seenIdsRef.current.add(event.eventId);
            if (event.occurredAtEpochMillis > lastEventAtRef.current) {
                lastEventAtRef.current = event.occurredAtEpochMillis;
            }
        });
        setEvents(initial.slice(0, MAX_EVENTS));
    }, []);

    const releaseBuffer = useCallback(() => {
        setBuffered((pending) => {
            if (pending.length > 0) {
                setEvents((prev) => [...pending, ...prev].slice(0, MAX_EVENTS));
            }
            return [];
        });
    }, []);

    /**
     * Pull anything published while the socket was down. Without this a dropped connection
     * leaves a permanent hole, because LISTEN never redelivers.
     */
    const replayMissed = useCallback(async () => {
        if (!lastEventAtRef.current) {
            return;
        }
        try {
            const page = await fetchLiveActivityEvents(instituteId, {
                from: lastEventAtRef.current + 1,
                size: 200,
            });
            // Oldest first so the newest still ends up at the head of the list.
            [...page.content].reverse().forEach(ingest);
        } catch {
            // A failed replay is not fatal -- the next backfill or refresh will catch up.
        }
    }, [instituteId, ingest]);

    const connect = useCallback(async () => {
        if (closedRef.current || !instituteId) {
            return;
        }
        try {
            const { token, allowedCategories: allowed } = await fetchStreamToken(instituteId);
            if (closedRef.current) {
                return;
            }
            setAllowedCategories(allowed ?? []);

            const source = new EventSource(LIVE_ACTIVITY_STREAM(token));
            sourceRef.current = source;

            source.onopen = () => {
                attemptRef.current = 0;
                setStatus('live');
                void replayMissed();
            };

            CATEGORY_EVENT_NAMES.forEach((category) => {
                source.addEventListener(category, (message) => {
                    try {
                        ingest(JSON.parse((message as MessageEvent).data));
                    } catch {
                        // A malformed frame must not kill the stream.
                    }
                });
            });

            source.onerror = () => {
                source.close();
                sourceRef.current = null;
                if (closedRef.current) {
                    return;
                }
                setStatus('reconnecting');
                const delay = Math.min(
                    BASE_RECONNECT_DELAY_MS * 2 ** attemptRef.current,
                    MAX_RECONNECT_DELAY_MS
                );
                attemptRef.current += 1;
                reconnectTimerRef.current = setTimeout(() => void connect(), delay);
            };
        } catch {
            if (closedRef.current) {
                return;
            }
            setStatus('error');
            const delay = Math.min(
                BASE_RECONNECT_DELAY_MS * 2 ** attemptRef.current,
                MAX_RECONNECT_DELAY_MS
            );
            attemptRef.current += 1;
            reconnectTimerRef.current = setTimeout(() => void connect(), delay);
        }
    }, [instituteId, ingest, replayMissed]);

    useEffect(() => {
        closedRef.current = false;
        void connect();
        return () => {
            closedRef.current = true;
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
            }
            sourceRef.current?.close();
            sourceRef.current = null;
        };
    }, [connect]);

    return {
        events,
        bufferedCount: buffered.length,
        status,
        allowedCategories,
        releaseBuffer,
        seed,
    };
}
