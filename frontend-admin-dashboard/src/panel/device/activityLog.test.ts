/**
 * The "what was shown" queue: seq and ack, the bounds, persistence across a restart,
 * coalescing, and what happens when the session changes or the server never acks.
 * Server time and performance.now() are faked; storage is the in-memory localStorage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clock = vi.hoisted(() => ({ server: 1_000_000, mono: 0, skew: 0 }));

// clock.server is the panel's wall clock; the server's runs clock.skew ahead of it.
vi.mock('./syncLoop', () => ({ getServerNow: () => clock.server + clock.skew }));

type ActivityModule = typeof import('./activityLog');

const SESSION = 'session-1';

function signIn(sessionId = SESSION): void {
    localStorage.setItem(
        'panel.sessionMeta',
        JSON.stringify({
            session_id: sessionId,
            user_id: 'u',
            started_at_ms: 1,
            last_refresh_wall_ms: 1,
        })
    );
}

async function load(): Promise<ActivityModule> {
    vi.resetModules();
    return import('./activityLog');
}

/** Moves both clocks: far enough apart that nothing coalesces by time. */
function later(ms = 60_000): void {
    clock.server += ms;
    clock.mono += ms;
}

function stored(): { session_id: string; next_seq: number; items: { seq: number }[] } | null {
    const raw = localStorage.getItem('panel.activity');
    return raw ? JSON.parse(raw) : null;
}

describe('activity queue', () => {
    let log: ActivityModule;

    beforeEach(async () => {
        localStorage.clear();
        clock.server = 1_000_000;
        clock.mono = 0;
        clock.skew = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => clock.mono);
        vi.spyOn(Date, 'now').mockImplementation(() => clock.server);
        signIn();
        log = await load();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does nothing without a session', () => {
        localStorage.removeItem('panel.sessionMeta');
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-1' });
        expect(stored()).toBeNull();
        expect(log.drainForSync(SESSION)).toEqual([]);
    });

    it('numbers events from 1, stamps server time, and drains oldest first without removing', async () => {
        clock.skew = 500;
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-1', parent_id: 'ch-1', title: 'Cells' });
        later();
        log.logActivity({ kind: 'DECK', ref_id: 'deck-1', title: 'Quiz' });
        // The server clock is reached through a dynamic import.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const batch = log.drainForSync(SESSION);
        expect(batch).toEqual([
            {
                seq: 1,
                kind: 'LESSON',
                ref_id: 'slide-1',
                parent_id: 'ch-1',
                title: 'Cells',
                at_ms: 1_000_500,
            },
            {
                seq: 2,
                kind: 'DECK',
                ref_id: 'deck-1',
                parent_id: null,
                title: 'Quiz',
                at_ms: 1_060_500,
            },
        ]);
        expect(log.drainForSync(SESSION)).toHaveLength(2);
    });

    it('an ack drops everything up to its seq, and only for its own session', () => {
        for (let i = 1; i <= 3; i += 1) {
            log.logActivity({ kind: 'LESSON', ref_id: `slide-${i}` });
            later();
        }
        log.ackActivity('another-session', 3);
        expect(log.drainForSync(SESSION).map((event) => event.seq)).toEqual([1, 2, 3]);
        log.ackActivity(SESSION, 2);
        expect(log.drainForSync(SESSION).map((event) => event.seq)).toEqual([3]);
        log.ackActivity(SESSION, 3);
        expect(log.drainForSync(SESSION)).toEqual([]);
        // seq keeps growing after an ack.
        log.logActivity({ kind: 'WHITEBOARD' });
        expect(log.drainForSync(SESSION)[0]?.seq).toBe(4);
    });

    it('a sync carries at most ACTIVITY_PER_SYNC events', () => {
        for (let i = 0; i < 30; i += 1) {
            log.logActivity({ kind: 'LESSON', ref_id: `slide-${i}` });
            later();
        }
        const batch = log.drainForSync(SESSION);
        expect(batch).toHaveLength(log.ACTIVITY_PER_SYNC);
        expect(batch[0]?.seq).toBe(1);
        log.ackActivity(SESSION, batch[batch.length - 1]?.seq ?? 0);
        expect(log.drainForSync(SESSION).map((event) => event.seq)[0]).toBe(21);
    });

    it('survives a restart: the queue and its seq come back from storage', async () => {
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-1' });
        later();
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-2' });
        log = await load();
        expect(log.drainForSync(SESSION).map((event) => event.seq)).toEqual([1, 2]);
        later();
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-3' });
        expect(stored()?.next_seq).toBe(4);
    });

    it('keeps at most ACTIVITY_PER_SESSION events and counts the rest as dropped', () => {
        for (let i = 0; i < 150; i += 1) {
            log.logActivity({ kind: 'LESSON', ref_id: `slide-${i}` });
            later();
        }
        const stats = log.getActivityStats();
        expect(stats.queued).toBe(log.ACTIVITY_PER_SESSION);
        expect(stats.dropped).toBe(50);
        expect(stored()?.next_seq).toBe(log.ACTIVITY_PER_SESSION + 1);
    });

    it('offline for days: storage stops growing once the bound is reached', () => {
        const sizes: number[] = [];
        // Ten days of a slide every minute with no answer from the server.
        for (let i = 0; i < 10 * 24 * 60; i += 1) {
            log.logActivity({ kind: 'LESSON', ref_id: `slide-${i % 500}`, title: 'x'.repeat(300) });
            log.drainForSync(SESSION);
            later();
            if (i % 1440 === 1439) sizes.push(localStorage.getItem('panel.activity')?.length ?? 0);
        }
        expect(log.getActivityStats().queued).toBe(log.ACTIVITY_PER_SESSION);
        // Only the dropped counter and the last key's digits still change.
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(20);
        // Titles are cut to 200 characters, so the whole queue stays small.
        expect(sizes[0]).toBeLessThan(40_000);
    });

    it('the same thing twice in a row is one event', () => {
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-1', parent_id: 'ch-1' });
        later();
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-1', parent_id: 'ch-1', title: 'renamed' });
        expect(log.drainForSync(SESSION)).toHaveLength(1);
    });

    it('an unsent event replaced within a few seconds is overwritten in place', () => {
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-1' });
        later(1000);
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-2' });
        later(1000);
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-3' });
        expect(log.drainForSync(SESSION)).toEqual([
            expect.objectContaining({ seq: 1, ref_id: 'slide-3' }),
        ]);
    });

    it('never overwrites an event already handed to a request', () => {
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-1' });
        log.drainForSync(SESSION);
        later(1000);
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-2' });
        expect(log.drainForSync(SESSION).map((event) => [event.seq, event.ref_id])).toEqual([
            [1, 'slide-1'],
            [2, 'slide-2'],
        ]);
    });

    it('HOME is kept only when it closes something', () => {
        log.logActivity({ kind: 'HOME' });
        expect(log.drainForSync(SESSION)).toEqual([]);
        log.logActivity({ kind: 'WHITEBOARD' });
        later();
        log.logActivity({ kind: 'HOME' });
        later();
        log.logActivity({ kind: 'HOME' });
        expect(log.drainForSync(SESSION).map((event) => event.kind)).toEqual([
            'WHITEBOARD',
            'HOME',
        ]);
    });

    it('cleans ids and titles: control characters out, long ids dropped, titles cut', () => {
        log.logActivity({
            kind: 'LESSON',
            ref_id: 'slide\n-1',
            parent_id: 'p'.repeat(65),
            title: `  A\ttitle${'y'.repeat(300)}`,
        });
        const [event] = log.drainForSync(SESSION);
        expect(event?.ref_id).toBe('slide-1');
        expect(event?.parent_id).toBeNull();
        expect(event?.title?.length).toBe(200);
        expect(event?.title?.startsWith('A title')).toBe(true);
    });

    it('a new session starts over at seq 1 and the old queue is gone', () => {
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-1' });
        signIn('session-2');
        later();
        log.logActivity({ kind: 'DECK', ref_id: 'deck-1' });
        expect(log.drainForSync('session-2')).toEqual([
            expect.objectContaining({ seq: 1, kind: 'DECK' }),
        ]);
    });

    it('a drain for another session drops the stored queue (it had its try at session end)', () => {
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-1' });
        expect(log.drainForSync('session-2')).toEqual([]);
        expect(stored()).toBeNull();
    });

    it('answers without acks: the queue is re-offered only every few minutes', () => {
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-1' });
        for (let i = 0; i < log.ACTIVITY_UNACKED_SENDS; i += 1) {
            expect(log.drainForSync(SESSION)).toHaveLength(1);
            log.noteActivityUnacked(SESSION);
            clock.mono += 1000;
        }
        expect(log.drainForSync(SESSION)).toEqual([]);
        clock.mono += log.ACTIVITY_UNACKED_RETRY_MS;
        expect(log.drainForSync(SESSION)).toHaveLength(1);
        log.ackActivity(SESSION, 0);
        clock.mono += 1000;
        expect(log.drainForSync(SESSION)).toHaveLength(1);
    });

    it('failed requests are not answers: after three of them the next sync still offers', () => {
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-1' });
        // Three syncs that threw: drained, never answered.
        for (let i = 0; i < 3; i += 1) {
            expect(log.drainForSync(SESSION)).toHaveLength(1);
            clock.mono += 15_000;
        }
        expect(log.drainForSync(SESSION)).toHaveLength(1);
    });

    it('an answer about another session does not count', () => {
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-1' });
        for (let i = 0; i < 5; i += 1) log.noteActivityUnacked('session-old');
        expect(log.drainForSync(SESSION)).toHaveLength(1);
    });

    it('the end drain ignores the no-ack backoff and never drops another session', () => {
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-1' });
        for (let i = 0; i < log.ACTIVITY_UNACKED_SENDS; i += 1) {
            log.drainForSync(SESSION);
            log.noteActivityUnacked(SESSION);
        }
        expect(log.drainForSync(SESSION)).toEqual([]);
        expect(log.drainForEnd(SESSION)).toHaveLength(1);
        expect(log.drainForEnd('session-2')).toEqual([]);
        // Unlike drainForSync, a mismatch leaves the queue alone.
        expect(stored()?.items).toHaveLength(1);
    });

    it('the end drain goes 20 at a time, oldest first, as each batch is acked', () => {
        for (let i = 0; i < 45; i += 1) {
            log.logActivity({ kind: 'LESSON', ref_id: `slide-${i}` });
            later();
        }
        const seqs: number[][] = [];
        for (let batch = log.drainForEnd(SESSION); batch.length > 0; ) {
            seqs.push(batch.map((event) => event.seq));
            log.ackActivity(SESSION, batch[batch.length - 1]?.seq ?? 0);
            batch = log.drainForEnd(SESSION);
        }
        expect(seqs.map((batch) => batch.length)).toEqual([20, 20, 5]);
        expect(seqs[2]?.[4]).toBe(45);
    });

    it('discard forgets only its own session queue', () => {
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-1' });
        log.discardActivity('session-2');
        expect(stored()).not.toBeNull();
        log.discardActivity(SESSION);
        expect(stored()).toBeNull();
    });

    it('after a restart, an event never takes the seq of a restored one', async () => {
        log.logActivity({ kind: 'LESSON', ref_id: 'slide-x' });
        // Sent, but the app restarted before the answer came.
        log.drainForSync(SESSION);
        log = await load();
        later(1000);
        log.logActivity({ kind: 'HOME' });
        expect(log.drainForSync(SESSION).map((event) => [event.seq, event.kind])).toEqual([
            [1, 'LESSON'],
            [2, 'HOME'],
        ]);
    });

    it('a full storage keeps the seq counter, so a restart never reuses a seq', async () => {
        const realSetItem = localStorage.setItem.bind(localStorage);
        const setItem = vi
            .spyOn(localStorage, 'setItem')
            .mockImplementation((key: string, value: string) => {
                // Room for a small record, not for a queue of long titles.
                if (key === 'panel.activity' && value.length > 400) throw new Error('full');
                realSetItem(key, value);
            });
        let largest = 0;
        for (let i = 0; i < 6; i += 1) {
            log.logActivity({ kind: 'LESSON', ref_id: `slide-${i}`, title: 'y'.repeat(150) });
            later();
            for (const event of log.drainForSync(SESSION)) largest = Math.max(largest, event.seq);
        }
        expect(largest).toBe(6);
        setItem.mockRestore();
        log = await load();
        expect(stored()?.next_seq ?? 0).toBeGreaterThan(largest);
        later();
        log.logActivity({ kind: 'DECK', ref_id: 'deck-1' });
        expect(log.drainForSync(SESSION).map((event) => event.seq)).toEqual([largest + 1]);
    });

    it('a broken stored value is ignored, and a failing storage never throws', async () => {
        localStorage.setItem('panel.activity', '{not json');
        log = await load();
        expect(() => log.logActivity({ kind: 'LESSON', ref_id: 'slide-1' })).not.toThrow();
        const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
            throw new Error('full');
        });
        later();
        expect(() => log.logActivity({ kind: 'LESSON', ref_id: 'slide-2' })).not.toThrow();
        expect(log.drainForSync(SESSION).map((event) => event.ref_id)).toEqual([
            'slide-1',
            'slide-2',
        ]);
        setItem.mockRestore();
    });
});
