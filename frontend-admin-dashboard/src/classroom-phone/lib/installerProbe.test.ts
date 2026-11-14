/**
 * The installer probe runs for every account that pairs a panel, so no answer about the
 * account may sign the phone out. A refused sign-in does, as on any other Bearer call,
 * and "no answer at all" is an error the screen can retry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
    getAccessToken: vi.fn(() => 'jwt' as string | null),
    expireSignIn: vi.fn(),
    decodeClaims: vi.fn(() => null as { iat?: number } | null),
    looksExpired: vi.fn(() => false),
}));
vi.mock('./auth', () => auth);

import { installerProbe } from './api';
import { PhoneApiError } from './http';

const reply = (status: number, body: unknown) =>
    vi.fn(async () => new Response(body === null ? '' : JSON.stringify(body), { status }));

describe('installerProbe', () => {
    const realFetch = globalThis.fetch;

    beforeEach(() => {
        vi.clearAllMocks();
        auth.getAccessToken.mockReturnValue('jwt');
        auth.decodeClaims.mockReturnValue(null);
        auth.looksExpired.mockReturnValue(false);
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    it('returns the installer org and sends the Bearer token', async () => {
        const fetch = reply(200, { partner: { id: 'p1', name: 'Org' } });
        globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
        await expect(installerProbe()).resolves.toEqual({ id: 'p1', name: 'Org' });
        const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toContain('/auth-service/v1/panel/partner/me');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
    });

    it.each([
        ['not an installer', 403, { code: 'NOT_INSTALLER' }],
        ['feature off', 404, { code: 'FEATURE_OFF' }],
        ['a route the server does not have', 403, { error: 'ACCESS_DENIED', path: '/error' }],
        ['a route missing behind a proxy', 404, null],
        ['an empty success', 200, null],
    ])('answers null for %s and never signs out', async (_, status, body) => {
        globalThis.fetch = reply(status, body) as unknown as typeof globalThis.fetch;
        await expect(installerProbe()).resolves.toBeNull();
        expect(auth.expireSignIn).not.toHaveBeenCalled();
    });

    it('a route the server does not have never signs out, even with an old token', async () => {
        auth.decodeClaims.mockReturnValue({ iat: 1 });
        globalThis.fetch = reply(403, {
            error: 'ACCESS_DENIED',
            path: '/error',
        }) as unknown as typeof globalThis.fetch;
        await expect(installerProbe()).resolves.toBeNull();
        expect(auth.expireSignIn).not.toHaveBeenCalled();
    });

    it.each([
        [
            'a refused sign-in on this path',
            403,
            { error: 'ACCESS_DENIED', path: '/auth-service/v1/panel/partner/me' },
        ],
        ['an expired token', 510, 'Expired Token'],
        ['a bare 401', 401, null],
        ['an UNAUTHORIZED code', 401, { code: 'UNAUTHORIZED', message: 'x' }],
    ])('signs out on %s and rejects with kind sign-in', async (_, status, body) => {
        auth.decodeClaims.mockReturnValue({ iat: 1 });
        globalThis.fetch = reply(status, body) as unknown as typeof globalThis.fetch;
        await expect(installerProbe()).rejects.toMatchObject({ kind: 'sign-in', status });
        expect(auth.expireSignIn).toHaveBeenCalledTimes(1);
    });

    it('a bare refusal of a token issued moments ago is not taken for a refused sign-in', async () => {
        auth.decodeClaims.mockReturnValue({ iat: Math.floor(Date.now() / 1000) });
        globalThis.fetch = reply(401, null) as unknown as typeof globalThis.fetch;
        await expect(installerProbe()).resolves.toBeNull();
        expect(auth.expireSignIn).not.toHaveBeenCalled();
    });

    it('a 500 from a token that looks expired signs out', async () => {
        auth.looksExpired.mockReturnValue(true);
        globalThis.fetch = reply(500, null) as unknown as typeof globalThis.fetch;
        await expect(installerProbe()).rejects.toMatchObject({ kind: 'sign-in' });
        expect(auth.expireSignIn).toHaveBeenCalledTimes(1);
        auth.looksExpired.mockReturnValue(false);
    });

    it('asks nothing without a token', async () => {
        auth.getAccessToken.mockReturnValue(null);
        const fetch = reply(200, {});
        globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
        await expect(installerProbe()).resolves.toBeNull();
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
        ['busy', 429],
        ['busy', 503],
        ['api', 500],
    ])('throws %s for HTTP %i so the screen offers a retry', async (kind, status) => {
        globalThis.fetch = reply(status, { code: 'BUSY' }) as unknown as typeof globalThis.fetch;
        await expect(installerProbe()).rejects.toMatchObject({ kind });
    });

    it('throws network when nothing comes back', async () => {
        globalThis.fetch = vi.fn(async () => {
            throw new TypeError('offline');
        }) as unknown as typeof globalThis.fetch;
        const error = await installerProbe().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(PhoneApiError);
        expect(error).toMatchObject({ kind: 'network' });
    });
});
