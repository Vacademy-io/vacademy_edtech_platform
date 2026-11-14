import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PanelPublicError } from './publicApi';
import { createSignInFlow, type SignInView } from './signInFlow';

const post = vi.hoisted(() => vi.fn());
const adopt = vi.hoisted(() => vi.fn());
const dateWrong = vi.hoisted(() => ({ value: false }));

vi.mock('./publicApi', async (original) => {
    const actual = await original<typeof import('./publicApi')>();
    return { ...actual, postPublic: post };
});
vi.mock('../lib/session', () => ({ adoptRedeemedSession: adopt }));
vi.mock('../lib/api', () => ({
    getRefreshToken: () => 'session-token',
    handleSessionEnded: vi.fn(),
}));
vi.mock('./activity', () => ({ isPanelDateWrong: () => dateWrong.value }));
vi.mock('./store', () => ({
    readActiveDevice: () => ({ device_id: 'd', device_secret: 's' }),
    deviceCredentials: (d: object) => d,
}));

const SECOND = 1000;
const challengeBody = (id: string) => ({
    challenge_id: id,
    qr_url: `https://host.example/classroom#c=${id}`,
    user_code: 'ABCD2345',
    match_code: 37,
    expires_in_s: 300,
    poll_after_ms: 2500,
});
const offline = () => new PanelPublicError('offline', null, null);
const pollCalls = () => post.mock.calls.filter(([path]) => path === '/challenge/poll').length;
const createCalls = () => post.mock.calls.filter(([path]) => path === '/challenge').length;

type PollAnswer = object | Error | (() => Promise<object>);

function harness(answers: { poll?: () => PollAnswer; create?: () => object | Error } = {}) {
    const views: SignInView[] = [];
    const done = vi.fn();
    const dead = vi.fn();
    let created = 0;
    post.mockImplementation(async (path: string) => {
        if (path === '/challenge') {
            created += 1;
            const answer = answers.create ? answers.create() : challengeBody(`c${created}`);
            if (answer instanceof Error) throw answer;
            return answer;
        }
        const answer = answers.poll ? answers.poll() : { state: 'PENDING', poll_after_ms: 2500 };
        if (answer instanceof Error) throw answer;
        if (typeof answer === 'function') return answer();
        return answer;
    });
    const flow = createSignInFlow({
        purpose: 'SIGN_IN',
        onView: (view) => views.push(view),
        onDone: done,
        onNumberDead: dead,
    });
    return { flow, views, done, dead, last: () => views[views.length - 1] };
}

describe('sign-in flow', () => {
    let clock = 0;
    beforeEach(() => {
        vi.useFakeTimers();
        post.mockReset();
        adopt.mockReset();
        adopt.mockResolvedValue({ sameUser: false });
        dateWrong.value = false;
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

    it('shows the QR with no number in it, then the number only after a scan', async () => {
        let answer: object = { state: 'PENDING', poll_after_ms: 2500 };
        const h = harness({ poll: () => answer });
        h.flow.start();
        await advance(SECOND);
        expect(h.last()).toEqual({
            view: 'qr',
            qrUrl: 'https://host.example/classroom#c=c1',
            userCode: 'ABCD2345',
        });
        expect(JSON.stringify(h.last())).not.toContain('37');
        answer = { state: 'SCANNED', scanned_by_name: 'Riya', poll_after_ms: 2500 };
        await advance(3 * SECOND);
        expect(h.last()).toEqual({ view: 'scanned', name: 'Riya', matchCode: 37 });
        h.flow.stop();
    });

    it('renews 30 s before expiry, but never while scanned (T54)', async () => {
        let answer: object = { state: 'PENDING', poll_after_ms: 2500 };
        const h = harness({ poll: () => answer });
        h.flow.start();
        await advance(260 * SECOND);
        expect(createCalls()).toBe(1);
        await advance(20 * SECOND);
        expect(createCalls()).toBe(2);
        answer = { state: 'SCANNED', scanned_by_name: 'Riya', poll_after_ms: 2500 };
        await advance(5 * SECOND);
        const before = createCalls();
        await advance(300 * SECOND);
        expect(createCalls()).toBe(before);
        expect(h.last()).toMatchObject({ view: 'scanned' });
        h.flow.stop();
    });

    it('resumes polling on APPROVED_PENDING and redeems, with no fresh QR (T53)', async () => {
        let approved = false;
        const redeemed = {
            state: 'REDEEMED',
            access_token: 'a',
            session_token: 's',
            session_id: 'sid',
            expires_in_s: 900,
            session_expires_in_s: 14400,
            user: { id: 'u', name: 'Riya' },
            institute_id: 'i',
            server_time_ms: 1,
        };
        const pendingError = new PanelPublicError('api', 409, {
            code: 'APPROVED_PENDING',
            challenge_id: 'held',
        });
        let created = 0;
        const h = harness({
            create: () => {
                created += 1;
                if (created === 1) return challengeBody('c1');
                approved = true;
                return pendingError;
            },
            poll: () => (approved ? redeemed : { state: 'PENDING', poll_after_ms: 2500 }),
        });
        h.flow.start();
        await advance(275 * SECOND);
        expect(adopt).toHaveBeenCalledTimes(1);
        expect(post.mock.calls.some(([, body]) => body?.challenge_id === 'held')).toBe(true);
        expect(h.done).toHaveBeenCalledWith({ kind: 'signedIn', sameUser: false });
        expect(h.views.filter((view) => view.view === 'qr')).toHaveLength(1);
    });

    it('toasts and shows a new QR when a scanned number goes dead (T15)', async () => {
        let answer: object = { state: 'SCANNED', scanned_by_name: 'Riya', poll_after_ms: 2500 };
        const h = harness({ poll: () => answer });
        h.flow.start();
        await advance(3 * SECOND);
        expect(h.last()).toMatchObject({ view: 'scanned' });
        answer = { state: 'DEAD', poll_after_ms: 2500 };
        await advance(3 * SECOND);
        expect(h.dead).toHaveBeenCalledTimes(1);
        expect(createCalls()).toBe(2);
        expect(h.last()).toMatchObject({ view: 'qr' });
        h.flow.stop();
    });

    it('does not toast when an unscanned challenge goes dead', async () => {
        const h = harness({ poll: () => ({ state: 'DEAD', poll_after_ms: 2500 }) });
        h.flow.start();
        await advance(3 * SECOND);
        expect(h.dead).not.toHaveBeenCalled();
        h.flow.stop();
    });

    it('dims after 10 minutes and stops polling; input brings a fresh QR', async () => {
        const h = harness();
        h.flow.start();
        await advance(601 * SECOND);
        expect(h.last()).toEqual({ view: 'dimmed' });
        const polls = pollCalls();
        const creates = createCalls();
        await advance(120 * SECOND);
        expect(pollCalls()).toBe(polls);
        expect(createCalls()).toBe(creates);
        h.flow.noteInput();
        await advance(SECOND);
        expect(h.last()).toMatchObject({ view: 'qr' });
        h.flow.stop();
    });

    it('input during the window pushes the dim back', async () => {
        const h = harness();
        h.flow.start();
        await advance(500 * SECOND);
        h.flow.noteInput();
        await advance(500 * SECOND);
        expect(h.last()).toMatchObject({ view: 'qr' });
        h.flow.stop();
    });

    it('stays on while scanned past the window', async () => {
        const h = harness({
            poll: () => ({ state: 'SCANNED', scanned_by_name: 'Riya', poll_after_ms: 2500 }),
        });
        h.flow.start();
        await advance(700 * SECOND);
        expect(h.last()).toMatchObject({ view: 'scanned' });
        h.flow.stop();
    });

    it('one failure retries quietly; a second shows offline and retries every 15 s', async () => {
        let down = true;
        const h = harness({
            poll: () => (down ? offline() : { state: 'PENDING', poll_after_ms: 2500 }),
        });
        h.flow.start();
        await advance(3 * SECOND);
        expect(h.last()).toMatchObject({ view: 'qr' });
        await advance(4 * SECOND);
        expect(h.last()).toEqual({ view: 'offline' });
        const polls = pollCalls();
        await advance(15 * SECOND);
        expect(pollCalls()).toBe(polls + 1);
        down = false;
        await advance(16 * SECOND);
        expect(pollCalls()).toBeGreaterThan(polls + 1);
        expect(h.last()).toMatchObject({ view: 'qr' });
        h.flow.stop();
    });

    it('waits out retry_after_ms on BUSY', async () => {
        const busy = new PanelPublicError('offline', 429, { code: 'BUSY', retry_after_ms: 20000 });
        const h = harness({ poll: () => busy });
        h.flow.start();
        await advance(3 * SECOND);
        const polls = pollCalls();
        await advance(19 * SECOND);
        expect(pollCalls()).toBe(polls);
        await advance(2 * SECOND);
        expect(pollCalls()).toBe(polls + 1);
        h.flow.stop();
    });

    it('PANEL_DISABLED shows unavailable, not offline', async () => {
        const h = harness({
            create: () => new PanelPublicError('api', 503, { code: 'PANEL_DISABLED' }),
        });
        h.flow.start();
        await advance(SECOND);
        expect(h.last()).toEqual({ view: 'unavailable' });
        h.flow.stop();
    });

    it('shows wrong date and asks nothing of the server', async () => {
        dateWrong.value = true;
        const h = harness();
        h.flow.start();
        await advance(SECOND);
        expect(h.last()).toEqual({ view: 'wrongDate' });
        expect(post).not.toHaveBeenCalled();
        h.flow.stop();
    });

    it('drops a late answer from a poll abandoned by stop', async () => {
        let resolve: (value: object) => void = () => undefined;
        const h = harness({
            poll: () => () =>
                new Promise<object>((r) => {
                    resolve = r;
                }),
        });
        h.flow.start();
        await advance(3 * SECOND);
        h.flow.stop();
        resolve({
            state: 'REDEEMED',
            access_token: 'late',
            session_token: 'late',
            session_id: 'late',
            expires_in_s: 900,
            session_expires_in_s: 100,
            user: { id: 'u', name: 'n' },
            institute_id: 'i',
            server_time_ms: 1,
        });
        await advance(SECOND);
        expect(adopt).not.toHaveBeenCalled();
    });

    it('keeps only one poll in flight', async () => {
        let inFlight = 0;
        let most = 0;
        const h = harness({
            poll: () => async () => {
                inFlight += 1;
                most = Math.max(most, inFlight);
                await new Promise((r) => setTimeout(r, 6000));
                inFlight -= 1;
                return { state: 'PENDING', poll_after_ms: 2500 };
            },
        });
        h.flow.start();
        await advance(40 * SECOND);
        expect(most).toBe(1);
        h.flow.stop();
    });

    it('reports ATTACHED for a phone attach', async () => {
        const h = harness({ poll: () => ({ state: 'ATTACHED' }) });
        h.flow.start();
        await advance(3 * SECOND);
        expect(h.done).toHaveBeenCalledWith({ kind: 'attached' });
        expect(adopt).not.toHaveBeenCalled();
    });
});
