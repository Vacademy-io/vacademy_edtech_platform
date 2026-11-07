import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';

const removeCookiesAndLogout = vi.fn();

vi.mock('@/lib/auth/sessionUtility', () => ({
    getTokenFromCookie: () => 'header.payload.signature',
    isTokenExpired: () => false,
    refreshTokens: vi.fn(),
    removeCookiesAndLogout,
    debugTokenStatus: vi.fn(),
}));
vi.mock('@sentry/react', () => ({
    captureMessage: vi.fn(),
    captureException: vi.fn(),
    withScope: vi.fn(),
}));
vi.mock('@/lib/perf/network-health', () => ({ recordApiSample: vi.fn() }));
vi.mock('@/lib/formatters', () => ({ getActiveLocale: () => 'en' }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));

/**
 * Drives the REAL response interceptor.
 *
 * These assertions cannot be made against a hand-built `{ response: { status, data } }` object:
 * the whole point is what the interceptor does to the error on its way to the caller, and for
 * years it replaced every 403 with a bare Error — so callers reading `error.response` (and every
 * reason code the backend sends) silently got nothing.
 */
const requestWith = async (status: number, data: unknown) => {
    const { default: instance } = await import('@/lib/auth/axiosInstance');
    instance.defaults.adapter = async (config) => {
        const headers = AxiosHeaders.from({});
        throw new AxiosError(
            `Request failed with status code ${status}`,
            String(status),
            config as InternalAxiosRequestConfig,
            {},
            { status, statusText: '', headers, config: config as InternalAxiosRequestConfig, data }
        );
    };
    return instance.get('https://backend.example.com/notification-service/v1/chat/conversations');
};

/** The body common_service's GlobalExceptionHandler returns for a ResponseStatusException. */
const statusErrorInfo = (code: string, status: number) => ({
    url: 'https://backend.example.com/notification-service/v1/chat/conversations',
    ex: code,
    message: code,
    responseCode: String(status),
    date: '2026-09-01T14:27:07.664+00:00',
});

describe('the authenticated response interceptor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('hands a 403 to the caller with its status and reason code intact', async () => {
        const err = await requestWith(403, statusErrorInfo('CHAT_DISABLED', 403)).catch((e) => e);
        expect(err.response?.status).toBe(403);
        expect(err.response?.data?.message).toBe('CHAT_DISABLED');
    });

    it('keeps the friendly sentence on a 403 so err.message callers are unaffected', async () => {
        const err = await requestWith(403, statusErrorInfo('CHAT_DISABLED', 403)).catch((e) => e);
        expect(err.message).toBe('You do not have permission to perform this action.');
    });

    it('does not log the user out on a 401 that carries a backend reason', async () => {
        // A widget/support/roadmap controller answering "Authentication required" is one endpoint's
        // own permission check, not a dead session — ending the session over it would be wrong.
        const err = await requestWith(401, statusErrorInfo('Authentication required', 401)).catch(
            (e) => e
        );
        expect(removeCookiesAndLogout).not.toHaveBeenCalled();
        expect(err.response?.status).toBe(401);
    });

    it('still logs the user out on a bare 401 with no backend body', async () => {
        await requestWith(401, '').catch((e) => e);
        expect(removeCookiesAndLogout).toHaveBeenCalled();
    });

    it('still logs the user out on a bare 511', async () => {
        await requestWith(511, '').catch((e) => e);
        expect(removeCookiesAndLogout).toHaveBeenCalled();
    });
});
