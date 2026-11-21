import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';

const removeCookiesAndLogout = vi.fn();
const openAiUsageLimitDialog = vi.fn();
const toastWarning = vi.fn();

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
vi.mock('@/components/common/ai-usage-limit/AiUsageLimitDialog', () => ({
    openAiUsageLimitDialog,
}));
vi.mock('sonner', () => ({ toast: { warning: toastWarning } }));

const LIMIT_BODY = {
    error: 'AI_USAGE_LIMIT',
    use_case: 'tutor_chat',
    use_case_label: 'AI tutor chat',
    scope: 'USER',
    period: 'DAY',
    limit: 20,
    used: 20.4,
    unit: 'credits',
    resets_at: '2026-10-16T00:00:00+05:30',
    set_by: 'INSTITUTE',
    message: "You've reached today's limit for AI tutor chat. It resets at midnight.",
};

const failWith = async (status: number, data: unknown, headers: Record<string, string> = {}) => {
    const { default: instance } = await import('@/lib/auth/axiosInstance');
    instance.defaults.adapter = async (config) => {
        throw new AxiosError(
            `Request failed with status code ${status}`,
            String(status),
            config as InternalAxiosRequestConfig,
            {},
            {
                status,
                statusText: '',
                headers: AxiosHeaders.from(headers),
                config: config as InternalAxiosRequestConfig,
                data,
            }
        );
    };
    return instance.post('https://backend.example.com/ai-service/chat/v1/send', {});
};

const succeedWith = async (headers: Record<string, string>) => {
    const { default: instance } = await import('@/lib/auth/axiosInstance');
    instance.defaults.adapter = async (config) => ({
        status: 200,
        statusText: 'OK',
        headers: AxiosHeaders.from(headers),
        config: config as InternalAxiosRequestConfig,
        data: { ok: true },
    });
    return instance.get('https://backend.example.com/ai-service/chat/v1/x');
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('AI usage-limit handling in the authenticated interceptor', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        const { resetAiUsageWarningsForTests } = await import('@/lib/ai-usage-limit');
        resetAiUsageWarningsForTests();
    });

    it('opens the limit modal for a 429 AI_USAGE_LIMIT and still rejects with the original error', async () => {
        const err = await failWith(429, LIMIT_BODY, { 'retry-after': '3600' }).catch((e) => e);
        await flush();
        expect(err.response?.status).toBe(429);
        expect(err.response?.data?.error).toBe('AI_USAGE_LIMIT');
        expect(err.message).toBe(LIMIT_BODY.message);
        expect(err.aiUsageLimit?.retry_after_seconds).toBe(3600);
        expect(openAiUsageLimitDialog).toHaveBeenCalledTimes(1);
        expect(openAiUsageLimitDialog.mock.calls[0][0]).toMatchObject({
            use_case: 'tutor_chat',
            limit: 20,
            used: 20.4,
            set_by: 'INSTITUTE',
        });
        expect(removeCookiesAndLogout).not.toHaveBeenCalled();
    });

    it('understands the body wrapped in FastAPI detail', async () => {
        await failWith(429, { detail: LIMIT_BODY }).catch((e) => e);
        await flush();
        expect(openAiUsageLimitDialog).toHaveBeenCalledTimes(1);
    });

    it('leaves any other 429 untouched (no modal, same message, same body)', async () => {
        const body = { error: 'daily_quota_exceeded', message: 'quota' };
        const err = await failWith(429, body).catch((e) => e);
        await flush();
        expect(openAiUsageLimitDialog).not.toHaveBeenCalled();
        expect(err.message).toBe('Request failed with status code 429');
        expect(err.response?.data).toEqual(body);
    });

    it('does not open the modal for a non-429 that happens to carry the code', async () => {
        await failWith(402, LIMIT_BODY).catch((e) => e);
        await flush();
        expect(openAiUsageLimitDialog).not.toHaveBeenCalled();
    });

    it('reads a blob body (responseType: blob callers)', async () => {
        const blob = new Blob([JSON.stringify(LIMIT_BODY)], { type: 'application/json' });
        await failWith(429, blob).catch((e) => e);
        await flush();
        expect(openAiUsageLimitDialog).toHaveBeenCalledTimes(1);
    });

    it('toasts an X-AI-Usage-Warning once per use case per session', async () => {
        const res = await succeedWith({ 'x-ai-usage-warning': 'tutor_chat;pct=85' });
        expect(res.data).toEqual({ ok: true });
        await succeedWith({ 'x-ai-usage-warning': 'tutor_chat;pct=90' });
        await succeedWith({ 'x-ai-usage-warning': 'lesson_video;pct=81' });
        await flush();
        await flush();
        const ids = toastWarning.mock.calls.map((c) => c[1]?.id);
        expect(ids).toEqual(['ai-usage-warning-tutor_chat', 'ai-usage-warning-lesson_video']);
    });

    it('passes a response without the header straight through', async () => {
        const res = await succeedWith({});
        await flush();
        expect(res.status).toBe(200);
        expect(toastWarning).not.toHaveBeenCalled();
    });
});
