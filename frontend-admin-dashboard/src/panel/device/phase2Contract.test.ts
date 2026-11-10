/**
 * The phase 2 contract on the panel side: what the sync loop sends and publishes, and
 * how a refused sign-in maps to a view. The queue and the update offer are faked here;
 * their own chunks test their insides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
const queue = vi.hoisted(() => ({
    drain: vi.fn(() => [] as unknown[]),
    ack: vi.fn(),
    unacked: vi.fn(),
}));
const offer = vi.hoisted(() => ({
    note: vi.fn(),
    channel: null as string | null,
}));

vi.mock('./publicApi', async (original) => {
    const actual = await original<typeof import('./publicApi')>();
    return { ...actual, postPublic: post };
});
vi.mock('../lib/api', () => ({
    getRefreshToken: () => 'session-token',
    msUntilAccessExpiry: () => 10 * 60 * 1000,
    msSinceLastRefresh: () => 0,
    noteSessionRemaining: vi.fn(),
    refreshAccessToken: vi.fn().mockResolvedValue('t'),
    subscribeSession: () => () => undefined,
}));
vi.mock('../lib/branding', () => ({ applyDeviceBranding: vi.fn() }));
vi.mock('../lib/session', () => ({ endSessionLocally: vi.fn() }));
vi.mock('../seams/remoteTarget', () => ({
    applyNavCounter: () => ({ outcome: 'NO_CHANGE', steps: 0 }),
    getRemoteTargetInfo: () => ({ hasTarget: false, state: null }),
    subscribeRemoteTarget: () => () => undefined,
}));
vi.mock('./deviceInfo', () => ({ getAppVersionCode: () => 3, getWebViewMajor: () => 66 }));
vi.mock('./activityLog', () => ({
    ACTIVITY_PER_SYNC: 20,
    ACTIVITY_PER_SESSION: 100,
    drainForSync: queue.drain,
    drainForEnd: () => [],
    ackActivity: queue.ack,
    noteActivityUnacked: queue.unacked,
    discardActivity: vi.fn(),
}));
vi.mock('./updateOffer', () => ({
    noteUpdateOffer: offer.note,
    getAppChannelForSync: () => offer.channel,
}));

const DEVICE = {
    device_id: 'device-1',
    device_secret: 'secret-1',
    institute_id: 'inst-a',
    institute_name: 'Alpha',
    room_name: 'Room 7B',
    approve_base_url: 'https://classroom.example',
    theme_code: null,
};

const body = (extra: object = {}, session?: object) => ({
    server_time_ms: 5000,
    device: {
        status: 'ACTIVE',
        room_name: 'Room 7B',
        institute_id: 'inst-a',
        institute_name: 'Alpha',
        theme_code: null,
        approve_base_url: 'https://classroom.example',
        password_login_allowed: false,
        approval_state: 'APPROVED',
    },
    ...(session ? { session } : {}),
    flags: { volt_live_enabled: false, bbb_in_app_min_webview: 9999 },
    policy: { idle_minutes: 30, session_hours: 4 },
    next_poll_ms: 60000,
    min_app_version_code: 1,
    ...extra,
});

const ACTIVE = {
    status: 'ACTIVE',
    expires_in_s: 14000,
    nav_counter: 0,
    nav_age_ms: null,
    phone_connected: false,
};

const EVENT = { seq: 4, kind: 'LESSON', ref_id: 's', parent_id: 'c', title: 'T', at_ms: 1 };

async function load() {
    vi.resetModules();
    return { ...(await import('./syncLoop')), ...(await import('./signInFlow')) };
}

const lastSync = () => post.mock.calls.filter(([p]) => p === '/sync').pop()?.[1];

describe('phase 2 sync contract', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        post.mockReset();
        queue.drain.mockReset();
        queue.drain.mockReturnValue([]);
        queue.ack.mockReset();
        queue.unacked.mockReset();
        offer.note.mockReset();
        offer.channel = null;
        localStorage.clear();
        localStorage.setItem('panel.device', JSON.stringify(DEVICE));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('a signed-in sync carries the session queue and acks it for that session', async () => {
        localStorage.setItem(
            'panel.sessionMeta',
            JSON.stringify({
                session_id: 'session-1',
                user_id: 'u',
                started_at_ms: 1,
                last_refresh_wall_ms: Date.now(),
            })
        );
        queue.drain.mockReturnValue([EVENT]);
        post.mockResolvedValue(body({ activity_acked_seq: 4 }, ACTIVE));
        const { startSyncLoop } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(queue.drain).toHaveBeenCalledWith('session-1');
        expect(lastSync()).toMatchObject({ session_id: 'session-1', activity: [EVENT] });
        expect(queue.ack).toHaveBeenCalledWith('session-1', 4);
    });

    it('no ack field, no ack: the queue keeps its events', async () => {
        localStorage.setItem(
            'panel.sessionMeta',
            JSON.stringify({
                session_id: 'session-1',
                user_id: 'u',
                started_at_ms: 1,
                last_refresh_wall_ms: Date.now(),
            })
        );
        queue.drain.mockReturnValue([EVENT]);
        post.mockResolvedValue(body({}, ACTIVE));
        const { startSyncLoop } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(queue.ack).not.toHaveBeenCalled();
        // An answer without an ack counts toward the no-ack backoff.
        expect(queue.unacked).toHaveBeenCalledWith('session-1');
    });

    it('a failed sync is neither an ack nor an answer without one', async () => {
        localStorage.setItem(
            'panel.sessionMeta',
            JSON.stringify({
                session_id: 'session-1',
                user_id: 'u',
                started_at_ms: 1,
                last_refresh_wall_ms: Date.now(),
            })
        );
        queue.drain.mockReturnValue([EVENT]);
        const { PanelPublicError } = await import('./publicApi');
        post.mockRejectedValue(new PanelPublicError('offline', null, null));
        const { startSyncLoop } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(lastSync()).toMatchObject({ activity: [EVENT] });
        expect(queue.ack).not.toHaveBeenCalled();
        expect(queue.unacked).not.toHaveBeenCalled();
    });

    it('signed out: no activity, the channel when known, and the blocks published', async () => {
        offer.channel = 'DIRECT';
        const licence = { state: 'UNLICENSED', enforced: true, ends_at: null, grace_ends_at: null };
        const update = {
            version_code: 4,
            version_name: '0.4.0',
            apk_url: 'https://cdn.example/a.apk',
            sha256: 'ab',
            size_bytes: 10,
            required: false,
        };
        post.mockResolvedValue(body({ licence, update }));
        const { startSyncLoop, getSyncSnapshot } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(queue.drain).not.toHaveBeenCalled();
        expect(lastSync()).not.toHaveProperty('activity');
        expect(lastSync()).toMatchObject({ app_channel: 'DIRECT' });
        expect(getSyncSnapshot()).toMatchObject({ licence, update, approvalState: 'APPROVED' });
        expect(offer.note).toHaveBeenCalledWith(update);
    });

    it('a phase 1 server publishes nulls and no channel is sent when unknown', async () => {
        const phase1 = body();
        delete (phase1.device as Record<string, unknown>).approval_state;
        post.mockResolvedValue(phase1);
        const { startSyncLoop, getSyncSnapshot } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(lastSync()).not.toHaveProperty('app_channel');
        expect(getSyncSnapshot()).toMatchObject({
            licence: null,
            update: null,
            approvalState: null,
        });
        expect(offer.note).toHaveBeenCalledWith(null);
    });

    it('maps the three new refusals to their views, and nothing else', async () => {
        const { refusalView } = await load();
        const { PanelPublicError } = await import('./publicApi');
        const refused = (code: string) =>
            new PanelPublicError('api', 403, { code: code as never, message: 'x' });
        expect(refusalView(refused('LICENCE_REQUIRED'))).toBe('licence');
        expect(refusalView(refused('AWAITING_APPROVAL'))).toBe('awaiting');
        expect(refusalView(refused('UPDATE_REQUIRED'))).toBe('updateRequired');
        expect(refusalView(refused('PANEL_DISABLED'))).toBeNull();
        expect(refusalView(new Error('x'))).toBeNull();
    });
});
