/**
 * Sign-out on a paired panel and what it sends: the queued activity of the session goes
 * with /session/end, 20 events per call, whatever the no-ack backoff says, and what
 * cannot be sent in time goes to panel.pendingEnd with its session. Also how a password
 * sign-in reads the refusals that are about the panel rather than the teacher.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelRedeemedSession } from '@/classroom-shared/apiTypes';

const post = vi.hoisted(() => vi.fn());
const clock = vi.hoisted(() => ({ now: 1_000_000 }));

vi.mock('./publicApi', async (original) => {
    const actual = await original<typeof import('./publicApi')>();
    return { ...actual, postPublic: post };
});
vi.mock('../lib/native', async (original) => ({
    ...(await original<typeof import('../lib/native')>()),
    closeMeeting: vi.fn(async () => undefined),
}));
vi.mock('./syncLoop', () => ({ getServerNow: () => clock.now }));

const DEVICE = {
    device_id: 'device-1',
    device_secret: 'secret-1',
    institute_id: 'inst-a',
    institute_name: 'Alpha',
    room_name: 'Room 7B',
    approve_base_url: 'https://classroom.example',
    theme_code: null,
    password_login_allowed: true,
};

function jwt(claims: object): string {
    const b64 = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '');
    return `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
}

const SESSION: PanelRedeemedSession = {
    access_token: jwt({ user: 'user-1', fullname: 'Riya', exp: 1000 }),
    session_token: 'token-session-1',
    session_id: 'session-1',
    expires_in_s: 900,
    session_expires_in_s: 14400,
    user: { id: 'user-1', name: 'Riya' },
    institute_id: 'inst-a',
    server_time_ms: 1,
};

type Modules = typeof import('../lib/session') &
    typeof import('./activityLog') &
    typeof import('./store') & {
        PanelPublicError: typeof import('./publicApi').PanelPublicError;
    };

// One module graph for the file: lib/session is large, and reloading it per test is slow.
let session: Modules;

async function loadOnce(): Promise<Modules> {
    return {
        ...(await import('../lib/session')),
        ...(await import('./activityLog')),
        ...(await import('./store')),
        PanelPublicError: (await import('./publicApi')).PanelPublicError,
    };
}

/** Queues `count` events for the signed-in session, far enough apart not to coalesce. */
function queue(count: number): void {
    for (let i = 0; i < count; i += 1) {
        clock.now += 10_000;
        session.logActivity({ kind: 'LESSON', ref_id: `slide-${i + 1}` });
    }
}

beforeAll(async () => {
    session = await loadOnce();
}, 120_000);

const ends = () =>
    post.mock.calls
        .filter(([path]) => path === '/session/end')
        .map(([, body]) => body as { activity?: { seq: number }[]; session_token: string });

describe('sign-out and the activity queue', () => {
    beforeEach(() => {
        post.mockReset();
        post.mockResolvedValue({ ended: true });
        localStorage.clear();
        localStorage.setItem('panel.device', JSON.stringify(DEVICE));
        clock.now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
        // The queue of the session before (each test signs in as session-1).
        session.discardActivity('session-1');
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('45 queued events go out in three /session/end calls, and the queue is gone', async () => {
        await session.adoptRedeemedSession(SESSION);
        queue(45);
        await session.signOut();
        expect(ends().map((body) => (body.activity ?? []).length)).toEqual([20, 20, 5]);
        expect(ends().every((body) => body.session_token === 'token-session-1')).toBe(true);
        expect(ends()[2]?.activity?.[4]?.seq).toBe(45);
        expect(session.readPendingEnd()).toBeNull();
        expect(localStorage.getItem('panel.activity')).toBeNull();
    });

    it('a sign-out inside the no-ack backoff still sends the queue', async () => {
        await session.adoptRedeemedSession(SESSION);
        queue(2);
        for (let i = 0; i < session.ACTIVITY_UNACKED_SENDS; i += 1) {
            session.drainForSync('session-1');
            session.noteActivityUnacked('session-1');
        }
        expect(session.drainForSync('session-1')).toEqual([]);
        await session.signOut('IDLE');
        expect(ends()[0]?.activity?.map((event) => event.seq)).toEqual([1, 2]);
    });

    it('offline: panel.pendingEnd names the session and its queue stays for the sync loop', async () => {
        await session.adoptRedeemedSession(SESSION);
        queue(30);
        post.mockRejectedValue(new session.PanelPublicError('offline', null, null));
        await session.signOut();
        expect(session.readPendingEnd()).toEqual({
            session_token: 'token-session-1',
            reason: 'SIGN_OUT',
            session_id: 'session-1',
        });
        expect(session.getActivityStats()).toMatchObject({ sessionId: 'session-1', queued: 30 });
        expect(session.isSignedIn()).toBe(false);
    });

    it('a slow server: what does not fit the time limit is left to the sync loop', async () => {
        await session.adoptRedeemedSession(SESSION);
        queue(50);
        post.mockImplementation(async () => {
            clock.now += 2600;
            return { ended: true };
        });
        await session.signOut();
        expect(ends()).toHaveLength(2);
        expect(session.readPendingEnd()).toMatchObject({ session_id: 'session-1' });
        expect(session.getActivityStats().queued).toBe(10);
    });

    it('a session the server ended still hands its unsent events to the sync loop', async () => {
        await session.adoptRedeemedSession(SESSION);
        queue(3);
        await session.endSessionLocally('ADMIN');
        expect(session.readPendingEnd()).toMatchObject({
            session_token: 'token-session-1',
            session_id: 'session-1',
        });
        expect(post).not.toHaveBeenCalled();
    });

    it('a session the server ended with nothing queued writes no pending end', async () => {
        await session.adoptRedeemedSession(SESSION);
        await session.endSessionLocally('ADMIN');
        expect(session.readPendingEnd()).toBeNull();
    });

    it('an old pending end record without session_id still reads', async () => {
        localStorage.setItem(
            'panel.pendingEnd',
            JSON.stringify({ session_token: 'old', reason: 'IDLE' })
        );
        expect(session.readPendingEnd()).toEqual({ session_token: 'old', reason: 'IDLE' });
    });
});

describe('password sign-in refusals about the panel', () => {
    beforeEach(() => {
        post.mockReset();
        localStorage.clear();
        localStorage.setItem('panel.device', JSON.stringify(DEVICE));
    });

    it.each(['LICENCE_REQUIRED', 'AWAITING_APPROVAL', 'UPDATE_REQUIRED', 'PANEL_DISABLED'])(
        '403 %s keeps its own code, not SERVER',
        async (code) => {
            post.mockRejectedValue(
                new session.PanelPublicError('api', 403, { code: code as never, message: 'x' })
            );
            const error = await session
                .loginWithDevicePassword('riya', 'secret')
                .catch((caught: unknown) => caught);
            expect(error).toBeInstanceOf(session.DevicePasswordError);
            expect((error as { code: string }).code).toBe(code);
        }
    );

    it('anything else from the server is still SERVER', async () => {
        post.mockRejectedValue(
            new session.PanelPublicError('api', 500, { code: 'ERROR', message: 'x' })
        );
        const error = await session
            .loginWithDevicePassword('riya', 'secret')
            .catch((caught: unknown) => caught);
        expect((error as { code: string }).code).toBe('SERVER');
    });
});
