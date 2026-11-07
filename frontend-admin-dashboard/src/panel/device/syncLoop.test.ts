/**
 * The sync loop, with the network, the session and the seam faked. It keeps module
 * state (one loop for the app), so each test gets fresh modules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
const endLocally = vi.hoisted(() => vi.fn());
const applyNav = vi.hoisted(() => vi.fn());
const target = vi.hoisted(() => ({
    info: { hasTarget: false, state: null } as {
        hasTarget: boolean;
        state: { index: number; total: number; title: string } | null;
    },
    listeners: [] as (() => void)[],
}));
const expiry = vi.hoisted(() => ({ ms: (10 * 60 * 1000) as number | null }));
const token = vi.hoisted(() => ({ value: 'session-token' as string | null }));

vi.mock('./publicApi', async (original) => {
    const actual = await original<typeof import('./publicApi')>();
    return { ...actual, postPublic: post };
});
vi.mock('../lib/api', () => ({
    getRefreshToken: () => token.value,
    msUntilAccessExpiry: () => expiry.ms,
    // The timer has seen no time pass since the refresh; only the wall clock moves.
    msSinceLastRefresh: () => (expiry.ms === null ? null : 0),
    noteSessionRemaining: vi.fn(),
    refreshAccessToken: refresh,
    subscribeSession: () => () => undefined,
}));
vi.mock('../lib/branding', () => ({ applyDeviceBranding: vi.fn() }));
vi.mock('../lib/session', () => ({ endSessionLocally: endLocally }));
vi.mock('../seams/remoteTarget', () => ({
    applyNavCounter: applyNav,
    getRemoteTargetInfo: () => target.info,
    subscribeRemoteTarget: (listener: () => void) => {
        target.listeners.push(listener);
        return () => undefined;
    },
}));
vi.mock('./deviceInfo', () => ({
    getAppVersionCode: () => 2,
    getWebViewMajor: () => 66,
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
const META = {
    session_id: 'session-1',
    user_id: 'u',
    started_at_ms: 1,
    last_refresh_wall_ms: 1,
};

const okBody = (session?: object, nextPollMs = 60000) => ({
    server_time_ms: 5000,
    device: {
        status: 'ACTIVE',
        room_name: 'Room 7B',
        institute_id: 'inst-a',
        institute_name: 'Alpha',
        theme_code: null,
        approve_base_url: 'https://classroom.example',
        password_login_allowed: false,
    },
    ...(session ? { session } : {}),
    flags: { volt_live_enabled: true, bbb_in_app_min_webview: 98 },
    policy: { idle_minutes: 20, session_hours: 4 },
    next_poll_ms: nextPollMs,
    min_app_version_code: 1,
});
const activeSession = (extra: object = {}) => ({
    status: 'ACTIVE',
    expires_in_s: 14000,
    nav_counter: 0,
    nav_age_ms: null,
    phone_connected: false,
    ...extra,
});

async function load() {
    vi.resetModules();
    const { PanelPublicError } = await import('./publicApi');
    return { ...(await import('./syncLoop')), ...(await import('./store')), PanelPublicError };
}

describe('sync loop', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        post.mockReset();
        refresh.mockReset();
        refresh.mockResolvedValue('t');
        endLocally.mockReset();
        applyNav.mockReset();
        applyNav.mockReturnValue({ outcome: 'NO_CHANGE', steps: 0 });
        target.info = { hasTarget: false, state: null };
        target.listeners = [];
        expiry.ms = 10 * 60 * 1000;
        token.value = 'session-token';
        localStorage.clear();
        localStorage.setItem('panel.device', JSON.stringify(DEVICE));
        localStorage.setItem(
            'panel.sessionMeta',
            JSON.stringify({ ...META, last_refresh_wall_ms: Date.now() })
        );
    });
    afterEach(() => {
        vi.useRealTimers();
    });
    const lastBody = () => post.mock.calls.filter(([p]) => p === '/sync').pop()?.[1];
    const syncs = () => post.mock.calls.filter(([p]) => p === '/sync').length;

    it('sends the session and follows next_poll_ms', async () => {
        post.mockResolvedValue(okBody(activeSession(), 5000));
        const { startSyncLoop, getPanelFlags, getPanelPolicy } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(lastBody()).toMatchObject({
            device_id: 'device-1',
            session_id: 'session-1',
            session_token: 'session-token',
            presenting: false,
            webview_major: 66,
        });
        expect(getPanelFlags().bbb_in_app_min_webview).toBe(98);
        expect(getPanelPolicy().idle_minutes).toBe(20);
        await vi.advanceTimersByTimeAsync(4900);
        expect(syncs()).toBe(1);
        await vi.advanceTimersByTimeAsync(200);
        expect(syncs()).toBe(2);
    });

    it('passes session_id, nav_counter and nav_age_ms to the seam', async () => {
        post.mockResolvedValue(okBody(activeSession({ nav_counter: 4, nav_age_ms: 700 })));
        const { startSyncLoop } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(applyNav).toHaveBeenCalledWith({
            session_id: 'session-1',
            nav_counter: 4,
            nav_age_ms: 700,
        });
    });

    it('sends presenting and state from the seam, and reports a new target soon', async () => {
        post.mockResolvedValue(okBody(activeSession()));
        const { startSyncLoop } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        target.info = { hasTarget: true, state: { index: 2, total: 9, title: 'Deck' } };
        target.listeners.forEach((listener) => listener());
        await vi.advanceTimersByTimeAsync(1100);
        expect(syncs()).toBe(2);
        expect(lastBody()).toMatchObject({
            presenting: true,
            state: { index: 2, total: 9, title: 'Deck' },
        });
    });

    it('says when a meeting screen is open, and only with a session', async () => {
        post.mockResolvedValue(okBody(activeSession()));
        const { startSyncLoop, syncNow } = await load();
        const { setMeetingOpen } = await import('./activity');
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(lastBody()).toMatchObject({ in_meeting: false });
        setMeetingOpen(true);
        syncNow();
        await vi.advanceTimersByTimeAsync(1100);
        expect(syncs()).toBe(2);
        expect(lastBody()).toMatchObject({ in_meeting: true });
        localStorage.removeItem('panel.sessionMeta');
        syncNow();
        await vi.advanceTimersByTimeAsync(1100);
        expect(lastBody()).toMatchObject({ in_meeting: false });
        setMeetingOpen(false);
    });

    it('refreshes proactively under 5 minutes, which keeps the dead-man quiet', async () => {
        expiry.ms = 4 * 60 * 1000;
        post.mockResolvedValue(okBody(activeSession()));
        const { startSyncLoop } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('refreshes when the wall clock says more time has passed than the timer', async () => {
        localStorage.setItem(
            'panel.sessionMeta',
            JSON.stringify({ ...META, last_refresh_wall_ms: Date.now() - 31 * 60 * 1000 })
        );
        post.mockResolvedValue(okBody(activeSession()));
        const { startSyncLoop } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('a recent refresh, or a clock gone backwards, adds no refresh', async () => {
        localStorage.setItem(
            'panel.sessionMeta',
            JSON.stringify({ ...META, last_refresh_wall_ms: Date.now() + 60 * 60 * 1000 })
        );
        post.mockResolvedValue(okBody(activeSession()));
        const { startSyncLoop } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(refresh).not.toHaveBeenCalled();
    });

    it('refreshes at cold boot, when the timer is unknown', async () => {
        expiry.ms = null;
        post.mockResolvedValue(okBody(activeSession()));
        const { startSyncLoop } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('ENDED from the server ends the session with its reason', async () => {
        post.mockResolvedValue(
            okBody({ ...activeSession(), status: 'ENDED', end_reason: 'SUPERSEDED' })
        );
        const { startSyncLoop } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(endLocally).toHaveBeenCalledWith('SUPERSEDED');
    });

    it('ignores an answer about a session replaced while the request was out', async () => {
        let answer: (value: object) => void = () => undefined;
        post.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                })
        );
        post.mockResolvedValue(okBody(activeSession()));
        const { startSyncLoop } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        localStorage.setItem(
            'panel.sessionMeta',
            JSON.stringify({ ...META, session_id: 'session-2' })
        );
        answer(okBody({ ...activeSession(), status: 'ENDED', end_reason: 'REPLACED' }));
        await vi.advanceTimersByTimeAsync(0);
        expect(endLocally).not.toHaveBeenCalled();
    });

    it.each([
        ['network', () => ({ kind: 'offline', status: null, body: null })],
        ['BUSY', () => ({ kind: 'offline', status: 429, body: { code: 'BUSY' } })],
        ['500', () => ({ kind: 'offline', status: 500, body: null })],
    ])('%s never touches the session, and retries', async (_name, make) => {
        const { startSyncLoop, PanelPublicError, readDevice } = await load();
        const spec = make();
        post.mockRejectedValue(
            new PanelPublicError(
                spec.kind as 'offline',
                spec.status,
                spec.body as { code: 'BUSY' } | null
            )
        );
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(endLocally).not.toHaveBeenCalled();
        expect(readDevice()?.revoked_at ?? null).toBeNull();
        await vi.advanceTimersByTimeAsync(20000);
        expect(syncs()).toBe(2);
    });

    it('DEVICE_REVOKED then OK: rechecks every 5 min and restores itself (T62)', async () => {
        const mod = await load();
        const { startSyncLoop, PanelPublicError, readDevice, markDeviceRevoked } = mod;
        let revoked = true;
        post.mockImplementation(async () => {
            if (revoked) {
                markDeviceRevoked('device-1', 'secret-1');
                throw new PanelPublicError('revoked', 401, { code: 'DEVICE_REVOKED' });
            }
            return okBody();
        });
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(readDevice()?.revoked_at).toBeTruthy();
        expect(readDevice()?.device_secret).toBe('secret-1');
        await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
        expect(syncs()).toBe(1);
        revoked = false;
        await vi.advanceTimersByTimeAsync(61 * 1000);
        expect(syncs()).toBe(2);
        // A revoked panel sends no session along with the recheck.
        expect(lastBody().session_token).toBeUndefined();
        expect(readDevice()?.revoked_at ?? null).toBeNull();
    });

    it('forgets the credentials 24 h after DEVICE_REVOKED', async () => {
        localStorage.setItem(
            'panel.device',
            JSON.stringify({ ...DEVICE, revoked_at: Date.now() - 25 * 60 * 60 * 1000 })
        );
        const { startSyncLoop, readDevice } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(readDevice()).toBeNull();
        expect(post).not.toHaveBeenCalled();
    });

    it('retries panel.pendingEnd until it is delivered', async () => {
        localStorage.setItem(
            'panel.pendingEnd',
            JSON.stringify({ session_token: 'old', reason: 'IDLE' })
        );
        token.value = null;
        localStorage.removeItem('panel.sessionMeta');
        const { startSyncLoop, PanelPublicError, readPendingEnd } = await load();
        let endFails = true;
        post.mockImplementation(async (path: string) => {
            if (path === '/session/end') {
                if (endFails) throw new PanelPublicError('offline', null, null);
                return { ended: true };
            }
            return okBody(undefined, 300000);
        });
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(0);
        expect(readPendingEnd()).not.toBeNull();
        endFails = false;
        await vi.advanceTimersByTimeAsync(61 * 1000);
        const ends = post.mock.calls.filter(([p]) => p === '/session/end');
        expect(ends[ends.length - 1]?.[1]).toMatchObject({ session_token: 'old', reason: 'IDLE' });
        expect(readPendingEnd()).toBeNull();
    });

    it('does nothing with no device, and starts when one appears', async () => {
        localStorage.removeItem('panel.device');
        post.mockResolvedValue(okBody());
        const { startSyncLoop, savePairedDevice } = await load();
        startSyncLoop();
        await vi.advanceTimersByTimeAsync(5000);
        expect(post).not.toHaveBeenCalled();
        savePairedDevice({
            state: 'CLAIMED',
            device_id: 'device-2',
            device_secret: 'secret-2',
            institute_id: 'inst-a',
            institute_name: 'Alpha',
            theme_code: null,
            room: { id: 'r', name: 'Room' },
            claimed_by_name: 'A',
        });
        await vi.advanceTimersByTimeAsync(1100);
        expect(syncs()).toBe(1);
        expect(lastBody().device_id).toBe('device-2');
    });
});
