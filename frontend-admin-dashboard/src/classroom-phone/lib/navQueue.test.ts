import { describe, expect, it, vi } from 'vitest';
import type { RemoteNavResponse } from '@/classroom-shared/apiTypes';
import { createNavQueue, nextSeq, NAV_MAX_QUEUE_AGE_MS, type NavQueueDeps } from './navQueue';

const OK: RemoteNavResponse = { accepted: true, status: 'ACTIVE' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(send: NavQueueDeps['send'], overrides: Partial<NavQueueDeps> = {}) {
    let seq = 0;
    const events: string[] = [];
    const deps: NavQueueDeps = {
        send,
        getSeq: () => seq,
        saveSeq: (value) => {
            seq = value;
        },
        isRetryable: () => true,
        onDelivered: () => events.push('delivered'),
        onNotDelivered: () => events.push('not-delivered'),
        onEnded: () => events.push('ended'),
        now: () => 1000,
        wait: () => Promise.resolve(),
        ...overrides,
    };
    return { queue: createNavQueue(deps), events };
}

describe('nextSeq', () => {
    it('is max(last + 1, now)', () => {
        expect(nextSeq(0, 500)).toBe(500);
        expect(nextSeq(500, 500)).toBe(501);
        expect(nextSeq(900, 500)).toBe(901);
    });
});

describe('createNavQueue', () => {
    it('sends two taps in the same millisecond in order, with one in flight', async () => {
        const calls: Array<[number, number]> = [];
        let inFlight = 0;
        let peak = 0;
        const { queue, events } = setup(async (delta, seq) => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            calls.push([delta, seq]);
            await tick();
            inFlight -= 1;
            return OK;
        });
        queue.press(1);
        queue.press(-1);
        await vi.waitFor(() => expect(events).toEqual(['delivered', 'delivered']));
        expect(calls).toEqual([
            [1, 1000],
            [-1, 1001],
        ]);
        expect(peak).toBe(1);
    });

    it('retries once with the same seq, and a duplicate counts as delivered', async () => {
        const seqs: number[] = [];
        const wait = vi.fn(() => Promise.resolve());
        const { queue, events } = setup(
            async (_delta, seq) => {
                seqs.push(seq);
                if (seqs.length === 1) throw new Error('lost');
                return { accepted: true, duplicate: true, status: 'ACTIVE' };
            },
            { wait }
        );
        queue.press(1);
        await vi.waitFor(() => expect(events).toEqual(['delivered']));
        expect(seqs).toEqual([1000, 1000]);
        expect(wait).toHaveBeenCalledWith(2000);
    });

    it('stops after one retry and drops the taps queued behind it', async () => {
        const send = vi.fn(async () => {
            throw new Error('offline');
        });
        const { queue, events } = setup(send);
        queue.press(1);
        queue.press(1);
        await vi.waitFor(() => expect(events).toEqual(['not-delivered']));
        expect(send).toHaveBeenCalledTimes(2);
        expect(queue.pending).toBe(0);
    });

    it('does not retry a refusal that is not a network failure', async () => {
        const send = vi.fn(async () => {
            throw new Error('400');
        });
        const { queue, events } = setup(send, { isRetryable: () => false });
        queue.press(1);
        await vi.waitFor(() => expect(events).toEqual(['not-delivered']));
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('reports a session that ended', async () => {
        const { queue, events } = setup(async () => ({ accepted: false, status: 'ENDED' }));
        queue.press(1);
        queue.press(1);
        await vi.waitFor(() => expect(events).toEqual(['ended']));
    });

    it('does not send a press that sat in the queue past the panel limit', async () => {
        let clock = 1000;
        let release: (() => void) | undefined;
        const seen: number[] = [];
        const { queue, events } = setup(
            async (delta) => {
                seen.push(delta);
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
                return OK;
            },
            { now: () => clock }
        );
        queue.press(1);
        queue.press(-1);
        await tick();
        clock += NAV_MAX_QUEUE_AGE_MS + 1;
        release?.();
        await vi.waitFor(() => expect(events).toEqual(['delivered', 'not-delivered']));
        expect(seen).toEqual([1]);
    });

    it('carries on from a stored seq above the clock', async () => {
        const seqs: number[] = [];
        const { queue, events } = setup(
            async (_delta, seq) => {
                seqs.push(seq);
                return OK;
            },
            { getSeq: () => 5000 }
        );
        queue.press(1);
        await vi.waitFor(() => expect(events).toEqual(['delivered']));
        expect(seqs).toEqual([5001]);
    });
});
