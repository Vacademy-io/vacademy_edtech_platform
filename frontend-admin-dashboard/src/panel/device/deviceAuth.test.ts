/**
 * Paired-mode rules in lib/api.ts, lib/session.ts and the sync loop, against a fake
 * axios adapter. No network.
 */
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import Cookies from 'js-cookie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelRedeemedSession } from '@/classroom-shared/apiTypes';
import { getOpenedClassEnd, setOpenedClassEnd } from './activity';
import panelApi, {
    AMBIGUOUS_403_REFRESH_GAP_MS,
    getAccessToken,
    getInstituteIdForRequests,
    getRefreshToken,
    msUntilAccessExpiry,
    refreshAccessToken,
} from '../lib/api';
import {
    adoptRedeemedSession,
    canUseDeviceSettings,
    clearStrayCookies,
    endSessionLocally,
    isSignedIn,
    registerBeforeSignOut,
    signOut,
    subscribeSessionEnded,
} from '../lib/session';
import { readDevice, readPendingEnd, readSessionMeta, subscribeDeviceEvents } from './store';

const native = vi.hoisted(() => ({ closeMeeting: vi.fn(async () => undefined) }));
vi.mock('../lib/native', async (original) => ({
    ...(await original<typeof import('../lib/native')>()),
    closeMeeting: native.closeMeeting,
}));

function jwt(claims: object): string {
    const b64 = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '');
    return `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
}

const DEVICE = {
    device_id: 'device-1',
    device_secret: 'secret-1',
    institute_id: 'inst-a',
    institute_name: 'Alpha',
    room_name: 'Room 7B',
    approve_base_url: 'https://classroom.example',
    theme_code: null,
};

const session = (id = 'session-1', userId = 'user-1'): PanelRedeemedSession => ({
    access_token: jwt({
        user: userId,
        fullname: 'Riya',
        username: 'riya',
        authorities: { 'inst-a': { roles: ['TEACHER'], permissions: [] } },
        // Far in the past on purpose: nothing may compare this with Date.now().
        exp: 1000,
    }),
    session_token: `token-${id}`,
    session_id: id,
    expires_in_s: 900,
    session_expires_in_s: 14400,
    user: { id: userId, name: 'Riya' },
    institute_id: 'inst-a',
    server_time_ms: 1,
});

type Handler = (
    config: InternalAxiosRequestConfig
) => { status: number; data?: unknown } | 'network';

let publicCalls: { path: string; body: Record<string, unknown>; auth: unknown }[] = [];
let publicHandler: Handler = () => ({ status: 200, data: {} });

const adapter: AxiosAdapter = async (config) => {
    const result = publicHandler(config);
    const response = (status: number, data: unknown) => ({
        status,
        statusText: '',
        data,
        headers: {},
        config,
    });
    if (result === 'network') throw new AxiosError('Network Error', 'ERR_NETWORK', config);
    if (result.status >= 400) {
        throw new AxiosError(
            `HTTP ${result.status}`,
            'ERR_BAD',
            config,
            null,
            response(result.status, result.data)
        );
    }
    return response(result.status, result.data);
};

const REFRESH_OK = (token = 'fresh') => ({
    status: 200,
    data: {
        access_token: jwt({
            user: 'user-1',
            fullname: 'Riya',
            username: 'riya',
            exp: 1000,
            t: token,
        }),
        expires_in_s: 900,
        session_expires_in_s: 14000,
        server_time_ms: 2,
    },
});

function route(table: Record<string, Handler>): void {
    publicHandler = (config) => {
        const url = config.url ?? '';
        const path = url.replace(/^.*\/public\/v1\/panel/, '');
        if (url.indexOf('/public/v1/panel') >= 0) {
            publicCalls.push({
                path,
                body: JSON.parse(String(config.data ?? '{}')),
                auth: config.headers?.Authorization,
            });
        }
        const handler = table[path] ?? table.api;
        return handler ? handler(config) : { status: 200, data: {} };
    };
}

/** Moves the monotonic timer past the gap in which an ambiguous 403 does not refresh. */
function pastAmbiguousRefreshGap(): void {
    const real = performance.now.bind(performance);
    vi.spyOn(performance, 'now').mockImplementation(() => real() + AMBIGUOUS_403_REFRESH_GAP_MS + 1_000);
}

describe('paired device auth', () => {
    beforeEach(() => {
        axios.defaults.adapter = adapter;
        panelApi.defaults.adapter = adapter;
        publicCalls = [];
        publicHandler = () => ({ status: 200, data: {} });
        localStorage.clear();
        Cookies.remove('accessToken');
        Cookies.remove('refreshToken');
        localStorage.setItem('panel.device', JSON.stringify(DEVICE));
    });
    afterEach(async () => {
        vi.restoreAllMocks();
    });

    it('signed in means session token and meta, never JWT exp against the local clock', async () => {
        expect(isSignedIn()).toBe(false);
        await adoptRedeemedSession(session());
        // exp in the JWT is 1970 and this still counts as signed in.
        expect(isSignedIn()).toBe(true);
        expect(readSessionMeta()?.session_id).toBe('session-1');
    });

    it('public calls carry no Authorization header', async () => {
        await adoptRedeemedSession(session());
        route({ '/session/refresh': () => REFRESH_OK() });
        await refreshAccessToken();
        expect(publicCalls[0]?.path).toBe('/session/refresh');
        expect(publicCalls[0]?.auth).toBeUndefined();
        expect(publicCalls[0]?.body).toMatchObject({
            device_id: 'device-1',
            device_secret: 'secret-1',
            session_token: 'token-session-1',
        });
    });

    it('uses the monotonic timer: no refresh with plenty left, even with a JWT exp in 1970', async () => {
        await adoptRedeemedSession(session());
        route({ api: () => ({ status: 200, data: 'ok' }) });
        await panelApi.get('https://api.example/thing');
        expect(publicCalls.filter((call) => call.path === '/session/refresh')).toHaveLength(0);
        expect(msUntilAccessExpiry()).toBeGreaterThan(5 * 60 * 1000);
    });

    it('refreshes when under 5 minutes are left, and the session keeps its token', async () => {
        await adoptRedeemedSession({ ...session(), expires_in_s: 200 });
        route({ '/session/refresh': () => REFRESH_OK(), api: () => ({ status: 200, data: 'ok' }) });
        await panelApi.get('https://api.example/thing');
        expect(publicCalls.filter((call) => call.path === '/session/refresh')).toHaveLength(1);
        expect(getRefreshToken()).toBe('token-session-1');
    });

    it('concurrent callers share one refresh', async () => {
        await adoptRedeemedSession({ ...session(), expires_in_s: 200 });
        route({ '/session/refresh': () => REFRESH_OK(), api: () => ({ status: 200, data: 'ok' }) });
        await Promise.all([
            panelApi.get('https://api.example/a'),
            panelApi.get('https://api.example/b'),
        ]);
        expect(publicCalls.filter((call) => call.path === '/session/refresh')).toHaveLength(1);
    });

    it.each([
        ['network failure', 'network' as const],
        ['a 500', { status: 500, data: {} }],
        ['503 BUSY', { status: 503, data: { code: 'BUSY', retry_after_ms: 2000 } }],
        ['429', { status: 429, data: { code: 'RATE_LIMITED', retry_after_ms: 2000 } }],
    ])('%s on refresh keeps the session', async (_name, result) => {
        await adoptRedeemedSession({ ...session(), expires_in_s: 200 });
        const ended = vi.fn();
        const off = subscribeSessionEnded(ended);
        route({ '/session/refresh': () => result, api: () => ({ status: 200, data: 'ok' }) });
        await panelApi.get('https://api.example/thing');
        expect(isSignedIn()).toBe(true);
        expect(ended).not.toHaveBeenCalled();
        off();
    });

    it('401 SESSION_ENDED from refresh ends the session with the reason', async () => {
        await adoptRedeemedSession({ ...session(), expires_in_s: 200 });
        const ended = vi.fn();
        const off = subscribeSessionEnded(ended);
        route({
            '/session/refresh': () => ({
                status: 401,
                data: { code: 'SESSION_ENDED', reason: 'SUPERSEDED' },
            }),
        });
        await expect(refreshAccessToken()).rejects.toBeTruthy();
        await vi.waitFor(() => expect(ended).toHaveBeenCalledWith({ reason: 'SUPERSEDED' }));
        expect(isSignedIn()).toBe(false);
        expect(getAccessToken()).toBeNull();
        off();
    });

    it('a 401 on a normal call refreshes once and retries once', async () => {
        await adoptRedeemedSession(session());
        let calls = 0;
        route({
            '/session/refresh': () => REFRESH_OK(),
            api: () => {
                calls += 1;
                return calls === 1 ? { status: 401, data: {} } : { status: 200, data: 'ok' };
            },
        });
        const response = await panelApi.get('https://api.example/thing');
        expect(response.data).toBe('ok');
        expect(calls).toBe(2);
        expect(isSignedIn()).toBe(true);
    });

    it('a second 401 after the retry ends the session', async () => {
        await adoptRedeemedSession(session());
        const ended = vi.fn();
        const off = subscribeSessionEnded(ended);
        route({
            '/session/refresh': () => REFRESH_OK(),
            '/session/end': () => ({ status: 200, data: { ended: true } }),
            api: () => ({ status: 401, data: {} }),
        });
        await expect(panelApi.get('https://api.example/thing')).rejects.toBeTruthy();
        await vi.waitFor(() => expect(ended).toHaveBeenCalled());
        expect(isSignedIn()).toBe(false);
        off();
    });

    it('a 401 while offline keeps the session', async () => {
        await adoptRedeemedSession(session());
        route({ '/session/refresh': () => 'network', api: () => ({ status: 401, data: {} }) });
        await expect(panelApi.get('https://api.example/thing')).rejects.toBeTruthy();
        expect(isSignedIn()).toBe(true);
    });

    it("treats the filter's expired-token answers like a 401", async () => {
        await adoptRedeemedSession(session());
        let calls = 0;
        route({
            '/session/refresh': () => REFRESH_OK(),
            api: () => {
                calls += 1;
                return calls === 1
                    ? { status: 510, data: { ex: 'Expired Token' } }
                    : { status: 200, data: 'ok' };
            },
        });
        expect((await panelApi.get('https://api.example/thing')).data).toBe('ok');
    });

    it('a 403 from the error dispatch counts as expired; a plain refusal does not', async () => {
        await adoptRedeemedSession(session());
        pastAmbiguousRefreshGap();
        let calls = 0;
        route({
            '/session/refresh': () => REFRESH_OK(),
            api: () => {
                calls += 1;
                return calls === 1
                    ? { status: 403, data: { error: 'ACCESS_DENIED', path: '/error' } }
                    : { status: 200, data: 'ok' };
            },
        });
        expect((await panelApi.get('https://api.example/thing')).data).toBe('ok');
        expect(calls).toBe(2);

        calls = 0;
        route({
            api: () => {
                calls += 1;
                return { status: 403, data: { error: 'ACCESS_DENIED', path: '/thing' } };
            },
        });
        await expect(panelApi.get('https://api.example/thing')).rejects.toBeTruthy();
        expect(calls).toBe(1);
        expect(isSignedIn()).toBe(true);
    });

    /** Long enough for a session end to have run, if one was started. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

    it('a 403 from the error dispatch that repeats with a new token keeps the session', async () => {
        await adoptRedeemedSession(session());
        pastAmbiguousRefreshGap();
        const sent: string[] = [];
        route({
            '/session/refresh': () => REFRESH_OK(),
            api: (config) => {
                sent.push(String(config.headers?.Authorization));
                return { status: 403, data: { error: 'ACCESS_DENIED', path: '/error' } };
            },
        });
        await expect(panelApi.get('https://api.example/thing')).rejects.toMatchObject({
            response: { status: 403 },
        });
        await settle();
        expect(new Set(sent).size).toBe(2);
        expect(isSignedIn()).toBe(true);
        expect(readPendingEnd()).toBeNull();
    });

    it('a 403 from the error dispatch refreshes at most once per gap', async () => {
        await adoptRedeemedSession(session());
        let refreshes = 0;
        let calls = 0;
        route({
            '/session/refresh': () => {
                refreshes += 1;
                return REFRESH_OK(`r${refreshes}`);
            },
            api: () => {
                calls += 1;
                return { status: 403, data: { error: 'ACCESS_DENIED', path: '/error' } };
            },
        });
        // Just signed in: the token cannot have expired, so a missing route fails alone.
        for (let i = 0; i < 3; i++) {
            await expect(panelApi.get('https://api.example/missing')).rejects.toMatchObject({
                response: { status: 403 },
            });
        }
        expect(refreshes).toBe(0);
        expect(calls).toBe(3);

        // Past the gap it refreshes and retries once; the calls after that do not refresh again.
        pastAmbiguousRefreshGap();
        for (let i = 0; i < 3; i++) {
            await expect(panelApi.get('https://api.example/missing')).rejects.toBeTruthy();
        }
        expect(refreshes).toBe(1);
        expect(calls).toBe(7);
        expect(isSignedIn()).toBe(true);
    });

    it('a 511 that repeats with a new token keeps the session', async () => {
        await adoptRedeemedSession(session());
        route({
            '/session/refresh': () => REFRESH_OK(),
            api: () => ({ status: 511, data: { ex: 'boom' } }),
        });
        await expect(panelApi.get('https://api.example/thing')).rejects.toBeTruthy();
        await settle();
        expect(isSignedIn()).toBe(true);
    });

    it('ACCESS_REVOKED after the retry still ends the session', async () => {
        await adoptRedeemedSession(session());
        route({
            '/session/refresh': () => REFRESH_OK(),
            api: () => ({ status: 403, data: { error: 'ACCESS_REVOKED', path: '/thing' } }),
        });
        await expect(panelApi.get('https://api.example/thing')).rejects.toBeTruthy();
        await vi.waitFor(() => expect(isSignedIn()).toBe(false));
    });

    it('a 403 that arrives after another call refreshed retries with the new token', async () => {
        await adoptRedeemedSession(session());
        pastAmbiguousRefreshGap();
        const oldBearer = `Bearer ${getAccessToken()}`;
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const slowAdapter: AxiosAdapter = async (config) => {
            const ok = (data: unknown) => ({
                status: 200,
                statusText: '',
                data,
                headers: {},
                config,
            });
            if ((config.url ?? '').indexOf('/session/refresh') >= 0) {
                return ok(REFRESH_OK().data);
            }
            const auth = String(config.headers?.Authorization);
            if (auth !== oldBearer) return ok('ok');
            if ((config.url ?? '').indexOf('/slow') >= 0) await gate;
            throw new AxiosError('HTTP 403', 'ERR_BAD', config, null, {
                ...ok({ error: 'ACCESS_DENIED', path: '/error' }),
                status: 403,
            });
        };
        axios.defaults.adapter = slowAdapter;
        panelApi.defaults.adapter = slowAdapter;
        const slow = panelApi.get('https://api.example/slow');
        expect((await panelApi.get('https://api.example/fast')).data).toBe('ok');
        release();
        // A rejection carries the adapter function, which a failure report cannot clone.
        const outcome = await slow.then(
            (response) => response.data,
            (error: AxiosError) => `rejected ${error.response?.status}`
        );
        expect(outcome).toBe('ok');
        expect(isSignedIn()).toBe(true);
    });

    it('sign-out does not wait without limit for live work', async () => {
        await adoptRedeemedSession(session());
        route({ '/session/end': () => ({ status: 200, data: { ended: true } }) });
        const off = registerBeforeSignOut(() => new Promise<void>(() => undefined));
        vi.useFakeTimers();
        try {
            const done = signOut();
            await vi.advanceTimersByTimeAsync(6000);
            vi.useRealTimers();
            await done;
            expect(isSignedIn()).toBe(false);
        } finally {
            vi.useRealTimers();
            off();
        }
    }, 2000);

    it('the end of a class does not carry over to the next teacher', async () => {
        await adoptRedeemedSession(session());
        route({ '/session/end': () => ({ status: 200, data: { ended: true } }) });
        setOpenedClassEnd(12345);
        await signOut();
        expect(getOpenedClassEnd()).toBeNull();

        await adoptRedeemedSession(session('session-a', 'user-a'));
        setOpenedClassEnd(12345);
        await adoptRedeemedSession(session('session-a2', 'user-a'));
        expect(getOpenedClassEnd()).toBe(12345);
        await adoptRedeemedSession(session('session-b', 'user-b'));
        expect(getOpenedClassEnd()).toBeNull();
    });

    it('a session that ends closes the meeting screen', async () => {
        await adoptRedeemedSession(session());
        route({ '/session/end': () => ({ status: 200, data: { ended: true } }) });
        native.closeMeeting.mockClear();
        await signOut();
        expect(native.closeMeeting).toHaveBeenCalledTimes(1);

        await adoptRedeemedSession(session());
        native.closeMeeting.mockClear();
        await endSessionLocally('ADMIN');
        expect(native.closeMeeting).toHaveBeenCalledTimes(1);
    });

    it('an end before anyone is listening reaches the first listener, once', async () => {
        await adoptRedeemedSession(session());
        await endSessionLocally('DEAD_MAN');
        const first = vi.fn();
        const offFirst = subscribeSessionEnded(first);
        await vi.waitFor(() => expect(first).toHaveBeenCalledWith({ reason: 'DEAD_MAN' }));
        offFirst();
        const second = vi.fn();
        const offSecond = subscribeSessionEnded(second);
        await settle();
        expect(second).not.toHaveBeenCalled();
        offSecond();
    });

    it('an ordinary 403 and 500 do not touch the session', async () => {
        await adoptRedeemedSession(session());
        route({ api: () => ({ status: 403, data: { error: 'nope' } }) });
        await expect(panelApi.get('https://api.example/thing')).rejects.toBeTruthy();
        route({ api: () => ({ status: 500, data: {} }) });
        await expect(panelApi.get('https://api.example/thing')).rejects.toBeTruthy();
        expect(isSignedIn()).toBe(true);
    });

    it('460 ends the session', async () => {
        await adoptRedeemedSession(session());
        route({ api: () => ({ status: 460, data: {} }) });
        await expect(panelApi.get('https://api.example/thing')).rejects.toBeTruthy();
        await vi.waitFor(() => expect(isSignedIn()).toBe(false));
    });

    it('clientId is the device institute, whatever is in selectedInstituteId', async () => {
        localStorage.setItem('selectedInstituteId', 'other');
        await adoptRedeemedSession(session());
        expect(getInstituteIdForRequests()).toBe('inst-a');
        let clientId: unknown;
        route({
            api: (config) => {
                clientId = config.headers?.clientId;
                return { status: 200, data: 'ok' };
            },
        });
        await panelApi.get('https://api.example/thing');
        expect(clientId).toBe('inst-a');
    });

    it('sign-out tells the server and clears the cookies', async () => {
        await adoptRedeemedSession(session());
        route({ '/session/end': () => ({ status: 200, data: { ended: true } }) });
        await signOut();
        const end = publicCalls.find((call) => call.path === '/session/end');
        expect(end?.body).toMatchObject({ session_token: 'token-session-1', reason: 'SIGN_OUT' });
        expect(isSignedIn()).toBe(false);
        expect(readPendingEnd()).toBeNull();
    });

    it('sign-out with no network writes panel.pendingEnd and still clears', async () => {
        await adoptRedeemedSession(session());
        route({ '/session/end': () => 'network' });
        await signOut('IDLE');
        expect(readPendingEnd()).toEqual({ session_token: 'token-session-1', reason: 'IDLE' });
        expect(isSignedIn()).toBe(false);
    });

    it('a late refresh cannot sign a signed-out teacher back in', async () => {
        await adoptRedeemedSession({ ...session(), expires_in_s: 200 });
        let finish: (value: { status: number; data: unknown }) => void = () => undefined;
        const original = axios.defaults.adapter;
        axios.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
            if ((config.url ?? '').indexOf('/session/refresh') >= 0) {
                const result = await new Promise<{ status: number; data: unknown }>((resolve) => {
                    finish = resolve;
                });
                return { ...result, statusText: '', headers: {}, config };
            }
            return { status: 200, data: { ended: true }, statusText: '', headers: {}, config };
        }) as AxiosAdapter;
        const refresh = refreshAccessToken();
        await signOut();
        finish(REFRESH_OK());
        await expect(refresh).rejects.toBeTruthy();
        expect(getAccessToken()).toBeNull();
        axios.defaults.adapter = original;
    });

    it('another teacher scanning replaces the tokens; the same teacher reports sameUser', async () => {
        await adoptRedeemedSession(session('s1', 'user-1'));
        expect((await adoptRedeemedSession(session('s2', 'user-1'))).sameUser).toBe(true);
        expect((await adoptRedeemedSession(session('s3', 'user-2'))).sameUser).toBe(false);
        expect(readSessionMeta()?.session_id).toBe('s3');
        expect(getRefreshToken()).toBe('token-s3');
    });

    it('only the exact DEVICE_REVOKED code revokes; the session ends and credentials stay', async () => {
        await adoptRedeemedSession({ ...session(), expires_in_s: 200 });
        const events = vi.fn();
        const off = subscribeDeviceEvents(events);

        route({ '/session/refresh': () => ({ status: 401, data: { code: 'SOMETHING_ELSE' } }) });
        await expect(refreshAccessToken()).rejects.toBeTruthy();
        expect(readDevice()?.revoked_at ?? null).toBeNull();

        route({ '/session/refresh': () => ({ status: 403, data: { code: 'DEVICE_REVOKED' } }) });
        await expect(refreshAccessToken()).rejects.toBeTruthy();
        expect(readDevice()?.revoked_at ?? null).toBeNull();

        route({ '/session/refresh': () => ({ status: 401, data: { code: 'DEVICE_REVOKED' } }) });
        await expect(refreshAccessToken()).rejects.toBeTruthy();
        expect(readDevice()?.revoked_at).toBeTruthy();
        expect(readDevice()?.device_secret).toBe('secret-1');
        expect(events).toHaveBeenCalledWith({ type: 'REVOKED', institute_id: 'inst-a' });
        await vi.waitFor(() => expect(getRefreshToken()).toBeNull());
        off();
    });

    it('stray cookies with no session behind them are cleared at boot', () => {
        Cookies.set('accessToken', 'old-long-lived');
        Cookies.set('refreshToken', 'old-refresh');
        clearStrayCookies();
        expect(getAccessToken()).toBeNull();
        expect(getRefreshToken()).toBeNull();
    });

    it('settings: open before pairing, admin-only once paired', async () => {
        localStorage.removeItem('panel.device');
        expect(canUseDeviceSettings()).toBe(true);
        localStorage.setItem('panel.device', JSON.stringify(DEVICE));
        expect(canUseDeviceSettings()).toBe(false);
        await adoptRedeemedSession(session());
        expect(canUseDeviceSettings()).toBe(false);
        const admin = session('s2');
        admin.access_token = jwt({
            user: 'user-1',
            authorities: { 'inst-a': { roles: ['ADMIN'], permissions: [] } },
            exp: 1000,
        });
        await adoptRedeemedSession(admin);
        expect(canUseDeviceSettings()).toBe(true);
    });
});
