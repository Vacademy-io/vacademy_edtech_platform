import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import { TokenKey } from '@/constants/auth/tokens';

const cookies = new Map<string, string>();
const removeCookiesAndLogout = vi.fn(() => cookies.clear());
const refreshTokens = vi.fn();

vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenFromCookie: (key: string) => cookies.get(key) ?? null,
    isTokenExpired: () => false,
    refreshTokens,
    removeCookiesAndLogout,
    debugTokenStatus: vi.fn(),
}));
vi.mock('@sentry/react', () => ({
    getClient: () => undefined,
    captureMessage: vi.fn(),
    captureException: vi.fn(),
    withScope: vi.fn(),
}));
vi.mock('@/lib/perf/network-health', () => ({ recordApiSample: vi.fn() }));
vi.mock('@/lib/formatters', () => ({ getActiveLocale: () => 'en' }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

const URL = 'https://backend.example.com/admin-core-service/v1/something';
const tokenInvalid = { error: 'TOKEN_INVALID', message: 'The sign-in token is not valid.', path: '/x' };

/** Drives the REAL interceptors; the backend accepts only the tokens in `accepted`. */
const setUp = async (accepted: Set<string>, refusal: unknown = tokenInvalid) => {
    const { default: instance } = await import('@/lib/auth/axiosInstance');
    const seen: string[] = [];
    instance.defaults.adapter = async (config) => {
        const auth = String((config.headers as Record<string, unknown>).Authorization ?? '');
        seen.push(auth);
        if (accepted.has(auth.replace('Bearer ', ''))) {
            return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
        }
        throw new AxiosError(
            'Request failed with status code 403',
            '403',
            config as InternalAxiosRequestConfig,
            {},
            {
                status: 403,
                statusText: '',
                headers: AxiosHeaders.from({}),
                config: config as InternalAxiosRequestConfig,
                data: refusal,
            }
        );
    };
    return { instance, seen };
};

describe('403 TOKEN_INVALID recovery', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        cookies.clear();
        cookies.set(TokenKey.accessToken, 'old-token');
        cookies.set(TokenKey.refreshToken, 'refresh-1');
    });

    it('refreshes once and retries the request with the new token', async () => {
        refreshTokens.mockImplementation(async () => {
            cookies.set(TokenKey.accessToken, 'new-token');
        });
        const { instance, seen } = await setUp(new Set(['new-token']));

        const res = await instance.get(URL);

        expect(res.data).toEqual({ ok: true });
        expect(refreshTokens).toHaveBeenCalledTimes(1);
        expect(refreshTokens).toHaveBeenCalledWith('refresh-1');
        expect(seen).toEqual(['Bearer old-token', 'Bearer new-token']);
        expect(removeCookiesAndLogout).not.toHaveBeenCalled();
    });

    it('shares one refresh between requests refused at the same time', async () => {
        refreshTokens.mockImplementation(async () => {
            cookies.set(TokenKey.accessToken, 'new-token');
        });
        const { instance } = await setUp(new Set(['new-token']));

        await Promise.all([instance.get(URL), instance.get(URL), instance.get(URL)]);

        expect(refreshTokens).toHaveBeenCalledTimes(1);
    });

    it('signs out cleanly when the refresh token is rejected, without retrying', async () => {
        refreshTokens.mockRejectedValue(
            new AxiosError('Request failed with status code 403', '403', undefined, {}, {
                status: 403,
                statusText: '',
                headers: {},
                config: {} as InternalAxiosRequestConfig,
                data: {},
            })
        );
        const { instance, seen } = await setUp(new Set());

        const err = await instance.get(URL).catch((e) => e);

        expect(err.response?.status).toBe(403);
        expect(seen).toHaveLength(1);
        expect(removeCookiesAndLogout).toHaveBeenCalledTimes(1);
    });

    it('keeps the session when the refresh fails for a network reason', async () => {
        refreshTokens.mockRejectedValue(new AxiosError('Network Error', 'ERR_NETWORK'));
        const { instance } = await setUp(new Set());

        await instance.get(URL).catch((e) => e);

        expect(removeCookiesAndLogout).not.toHaveBeenCalled();
    });

    it('does not loop: a retried request refused again ends the session once', async () => {
        refreshTokens.mockImplementation(async () => {
            cookies.set(TokenKey.accessToken, 'new-token');
        });
        const { instance, seen } = await setUp(new Set());

        const err = await instance.get(URL).catch((e) => e);

        expect(err.response?.data?.error).toBe('TOKEN_INVALID');
        expect(seen).toHaveLength(2);
        expect(refreshTokens).toHaveBeenCalledTimes(1);
        expect(removeCookiesAndLogout).toHaveBeenCalledTimes(1);
    });

    it('leaves every other 403 alone', async () => {
        const { instance, seen } = await setUp(new Set(), {
            error: 'ACCESS_DENIED',
            message: 'The presented token does not grant access to this endpoint.',
        });

        const err = await instance.get(URL).catch((e) => e);

        expect(err.response?.status).toBe(403);
        expect(seen).toHaveLength(1);
        expect(refreshTokens).not.toHaveBeenCalled();
        expect(removeCookiesAndLogout).not.toHaveBeenCalled();
    });
});
