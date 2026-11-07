/**
 * Delivers remote presses: one request in flight, later taps queued in order. A
 * retry reuses the same client_seq, which the server answers with duplicate:true,
 * so a lost response cannot move the slide twice.
 */
import type { RemoteNavResponse } from '@/classroom-shared/apiTypes';

export const NAV_RETRY_DELAY_MS = 2000;
/** The panel drops a press older than this anyway, so do not bother sending it. */
export const NAV_MAX_QUEUE_AGE_MS = 8000;

export interface NavQueueDeps {
    send: (delta: 1 | -1, seq: number) => Promise<RemoteNavResponse>;
    getSeq: () => number;
    saveSeq: (seq: number) => void;
    onDelivered: () => void;
    /** The press could not be confirmed after the retry. The teacher is told to tap again. */
    onNotDelivered: () => void;
    onEnded: () => void;
    /** A retry is safe for network failures only. */
    isRetryable: (error: unknown) => boolean;
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
}

export interface NavQueue {
    press: (delta: 1 | -1) => void;
    stop: () => void;
    readonly pending: number;
}

export function nextSeq(last: number, nowMs: number): number {
    return Math.max(last + 1, nowMs);
}

export function createNavQueue(deps: NavQueueDeps): NavQueue {
    const now = deps.now ?? Date.now;
    const wait =
        deps.wait ??
        ((ms: number) =>
            new Promise<void>((resolve) => {
                setTimeout(resolve, ms);
            }));
    const queue: Array<{ delta: 1 | -1; at: number }> = [];
    let running = false;
    let stopped = false;

    const settle = (response: RemoteNavResponse): 'delivered' | 'ended' | 'not-delivered' => {
        if (response.accepted) return 'delivered';
        return response.status === 'ENDED' ? 'ended' : 'not-delivered';
    };

    async function deliver(delta: 1 | -1, seq: number) {
        try {
            return settle(await deps.send(delta, seq));
        } catch (error) {
            if (!deps.isRetryable(error)) return 'not-delivered' as const;
        }
        await wait(NAV_RETRY_DELAY_MS);
        if (stopped) return 'not-delivered' as const;
        try {
            return settle(await deps.send(delta, seq));
        } catch {
            return 'not-delivered' as const;
        }
    }

    async function drain() {
        if (running) return;
        running = true;
        while (queue.length > 0 && !stopped) {
            const press = queue.shift()!;
            if (now() - press.at > NAV_MAX_QUEUE_AGE_MS) {
                deps.onNotDelivered();
                continue;
            }
            const seq = nextSeq(deps.getSeq(), now());
            deps.saveSeq(seq);
            const outcome = await deliver(press.delta, seq);
            if (stopped) break;
            if (outcome === 'delivered') {
                deps.onDelivered();
            } else if (outcome === 'ended') {
                queue.length = 0;
                deps.onEnded();
            } else {
                // Taps behind a failed press are stale by now. The teacher decides again.
                queue.length = 0;
                deps.onNotDelivered();
            }
        }
        running = false;
    }

    return {
        press(delta) {
            if (stopped) return;
            queue.push({ delta, at: now() });
            void drain();
        },
        stop() {
            stopped = true;
            queue.length = 0;
        },
        get pending() {
            return queue.length;
        },
    };
}
