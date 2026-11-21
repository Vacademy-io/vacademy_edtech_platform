import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PanelPublicError } from './publicApi';
import { createPairingFlow, type PairView } from './pairingFlow';
import { readDevice, readPairing } from './store';

const post = vi.hoisted(() => vi.fn());

vi.mock('./publicApi', async (original) => {
    const actual = await original<typeof import('./publicApi')>();
    return { ...actual, postPublic: post };
});
vi.mock('./activity', () => ({ isPanelDateWrong: () => false }));
vi.mock('./deviceInfo', () => ({ reportedDevice: () => ({ model: 'Panel' }) }));

const startBody = (n: number) => ({
    pair_secret: `secret-${n}`,
    code: `CODE000${n}`,
    match_code: 40 + n,
    qr_url: `https://host.example/classroom#pair=CODE000${n}`,
    expires_in_s: 900,
    poll_after_ms: 3000,
});
const claimed = (secret = 'device-secret') => ({
    state: 'CLAIMED',
    device_id: 'device-1',
    device_secret: secret,
    institute_id: 'inst-a',
    institute_name: 'Alpha School',
    theme_code: null,
    room: { id: 'r1', name: 'Room 7B' },
    claimed_by_name: 'Anita',
    poll_after_ms: 3000,
});

type Answer = object | Error;

function harness(answers: Partial<Record<string, () => Answer>> = {}) {
    const views: PairView[] = [];
    const paired = vi.fn();
    const confirmFailed = vi.fn();
    let started = 0;
    post.mockImplementation(async (path: string) => {
        const fixed = answers[path];
        let answer: Answer;
        if (fixed) answer = fixed();
        else if (path === '/pair/start') {
            started += 1;
            answer = startBody(started);
        } else if (path === '/pair/poll') answer = { state: 'PENDING', poll_after_ms: 3000 };
        else answer = { status: 'ACTIVE' };
        if (answer instanceof Error) throw answer;
        return answer;
    });
    const flow = createPairingFlow({
        onView: (view) => views.push(view),
        onPaired: paired,
        onConfirmFailed: confirmFailed,
    });
    return { flow, views, paired, confirmFailed, last: () => views[views.length - 1] };
}

describe('pairing flow', () => {
    let clock = 0;
    beforeEach(() => {
        vi.useFakeTimers();
        post.mockReset();
        localStorage.clear();
        clock = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });
    const advance = async (ms: number) => {
        const step = 500;
        for (let t = 0; t < ms; t += step) {
            clock += step;
            await vi.advanceTimersByTimeAsync(step);
        }
    };

    it('shows code and number, then the claim, and saves only after Confirm (T1)', async () => {
        let poll: object = { state: 'PENDING', poll_after_ms: 3000 };
        const h = harness({ '/pair/poll': () => poll });
        h.flow.start();
        await advance(1000);
        expect(h.last()).toMatchObject({ view: 'code', code: 'CODE0001', matchCode: 41 });
        expect(readPairing()).toEqual({ pair_secret: 'secret-1' });
        poll = claimed();
        await advance(4000);
        expect(h.last()).toMatchObject({ view: 'claimed' });
        expect(readDevice()).toBeNull();
        await h.flow.confirm(true);
        expect(h.paired).toHaveBeenCalledTimes(1);
        expect(readDevice()).toMatchObject({
            device_id: 'device-1',
            device_secret: 'device-secret',
            room_name: 'Room 7B',
        });
        expect(readPairing()).toBeNull();
    });

    it('a dropped CLAIMED answer recovers on the retry with the newest secret (T3)', async () => {
        let polls = 0;
        const h = harness({
            '/pair/poll': () => {
                polls += 1;
                if (polls === 1) return { state: 'PENDING', poll_after_ms: 3000 };
                if (polls === 2) return new PanelPublicError('offline', null, null);
                return claimed('newest-secret');
            },
        });
        h.flow.start();
        await advance(12000);
        expect(h.last()).toMatchObject({ view: 'claimed' });
        await h.flow.confirm(true);
        expect(readDevice()?.device_secret).toBe('newest-secret');
        const confirm = post.mock.calls.find(([path]) => path === '/pair/confirm');
        expect(confirm?.[1]).toMatchObject({ device_secret: 'newest-secret', accept: true });
    });

    it('Cancel declines and shows a new code (T4)', async () => {
        const h = harness({
            '/pair/poll': () => claimed(),
            '/pair/confirm': () => ({ status: 'CANCELLED' }),
        });
        h.flow.start();
        await advance(4000);
        expect(h.last()).toMatchObject({ view: 'claimed' });
        await h.flow.confirm(false);
        await advance(500);
        expect(readDevice()).toBeNull();
        expect(h.last()).toMatchObject({ view: 'code', code: 'CODE0002' });
        h.flow.stop();
    });

    it('a claim survives a restart and asks again', async () => {
        const first = harness({ '/pair/poll': () => claimed() });
        first.flow.start();
        await advance(4000);
        first.flow.stop();
        const second = harness();
        second.flow.start();
        expect(second.last()).toMatchObject({ view: 'claimed' });
        expect(post.mock.calls.filter(([path]) => path === '/pair/start')).toHaveLength(1);
    });

    it('wrong number at the phone cancels the pairing: new code on the panel', async () => {
        let poll: object = { state: 'PENDING', poll_after_ms: 3000 };
        const h = harness({ '/pair/poll': () => poll });
        h.flow.start();
        await advance(1000);
        poll = { state: 'CANCELLED', poll_after_ms: 3000 };
        await advance(4000);
        expect(h.last()).toMatchObject({ view: 'code', code: 'CODE0002' });
        h.flow.stop();
    });

    it('dims after 60 minutes with no polling, and input restarts', async () => {
        const h = harness();
        h.flow.start();
        await advance(3601 * 1000);
        expect(h.last()).toEqual({ view: 'dimmed' });
        const polls = post.mock.calls.length;
        await advance(60000);
        expect(post.mock.calls.length).toBe(polls);
        h.flow.noteInput();
        await advance(1000);
        expect(h.last()).not.toEqual({ view: 'dimmed' });
        h.flow.stop();
    });

    it('503 PANEL_DISABLED shows disabled', async () => {
        const h = harness({
            '/pair/start': () => new PanelPublicError('api', 503, { code: 'PANEL_DISABLED' }),
        });
        h.flow.start();
        await advance(500);
        expect(h.last()).toEqual({ view: 'disabled' });
        h.flow.stop();
    });

    it('offline after a second failure', async () => {
        const h = harness({ '/pair/start': () => new PanelPublicError('offline', null, null) });
        h.flow.start();
        await advance(4000);
        expect(h.last()).toEqual({ view: 'offline' });
        h.flow.stop();
    });

    it('back online with the code still good: shows the code again', async () => {
        let down = false;
        const h = harness({
            '/pair/poll': () =>
                down
                    ? new PanelPublicError('offline', null, null)
                    : { state: 'PENDING', poll_after_ms: 3000 },
        });
        h.flow.start();
        await advance(1000);
        down = true;
        await advance(8000);
        expect(h.last()).toEqual({ view: 'offline' });
        down = false;
        h.flow.retry();
        await advance(500);
        expect(h.last()).toMatchObject({ view: 'code', code: 'CODE0001' });
        h.flow.stop();
    });

    it('a confirm that cannot reach the server stays on the question', async () => {
        const h = harness({
            '/pair/poll': () => claimed(),
            '/pair/confirm': () => new PanelPublicError('offline', null, null),
        });
        h.flow.start();
        await advance(4000);
        await h.flow.confirm(true);
        expect(h.confirmFailed).toHaveBeenCalled();
        expect(readDevice()).toBeNull();
        expect(h.last()).toMatchObject({ view: 'claimed' });
    });

    it('a claim revoked while the question was up starts over', async () => {
        const h = harness({
            '/pair/poll': () => claimed(),
            '/pair/confirm': () => new PanelPublicError('revoked', 401, { code: 'DEVICE_REVOKED' }),
        });
        h.flow.start();
        await advance(4000);
        await h.flow.confirm(true);
        await advance(500);
        expect(readDevice()).toBeNull();
        expect(readPairing()?.claim ?? null).toBeNull();
    });
});
