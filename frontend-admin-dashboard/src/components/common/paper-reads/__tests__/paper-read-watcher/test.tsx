import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above these; vi.hoisted keeps the handles usable inside them.
const { getJob, toast } = vi.hoisted(() => ({
    getJob: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/auth/axiosInstance', () => ({
    default: { get: (url: string) => getJob(url), post: vi.fn() },
}));
vi.mock('@/constants/urls', () => ({ AI_SERVICE_BASE_URL: 'http://ai', BASE_URL: 'http://be' }));
vi.mock('sonner', () => ({ toast }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k) }),
}));

import { PaperReadWatcher } from '../../PaperReadWatcher';
import { listPendingPaperReads, rememberPendingPaperRead } from '@/services/paper-digitise';

const done = (n: number) => ({
    data: { task_id: 't1', status: 'COMPLETED', status_message: null, result: { questions: new Array(n).fill({}) } },
});

/**
 * A read finishes while the teacher is elsewhere: exactly one toast, then the
 * read is forgotten so no reload, tick or second tab repeats it.
 */
describe('PaperReadWatcher', () => {
    const onOpen = vi.fn();
    const mount = () =>
        render(
            <QueryClientProvider client={new QueryClient()}>
                <PaperReadWatcher onOpen={onOpen} />
            </QueryClientProvider>
        );

    beforeEach(() => {
        // happy-dom does not always expose localStorage as a global here; a
        // minimal in-memory Storage is all the registry needs.
        if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
            const store = new Map<string, string>();
            Object.defineProperty(globalThis, 'localStorage', {
                configurable: true,
                value: {
                    getItem: (k: string) => store.get(k) ?? null,
                    setItem: (k: string, v: string) => void store.set(k, String(v)),
                    removeItem: (k: string) => void store.delete(k),
                    clear: () => store.clear(),
                },
            });
        }
        localStorage.clear();
        getJob.mockReset();
        toast.success.mockReset();
        toast.error.mockReset();
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('toasts once when a remembered read completes and forgets it', async () => {
        rememberPendingPaperRead({ taskId: 't1', assessmentId: 'a1', name: 'Newton Laws', path: '/slides?x=1' });
        getJob.mockResolvedValue(done(64));
        mount();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(toast.success.mock.calls[0]?.[0]).toContain('"count":64');
        expect(listPendingPaperReads()).toEqual([]);
        // later ticks stay silent
        await act(async () => {
            await vi.advanceTimersByTimeAsync(30_000);
        });
        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(getJob).toHaveBeenCalledTimes(1);
        // the action opens the page the read was started from
        (toast.success.mock.calls[0]?.[1] as { action: { onClick: () => void } }).action.onClick();
        expect(onOpen).toHaveBeenCalledWith('/slides?x=1');
    });

    it('keeps waiting while the read runs, and reports a failure once', async () => {
        rememberPendingPaperRead({ taskId: 't1', assessmentId: 'a1', name: 'N', path: '' });
        getJob.mockResolvedValueOnce({ data: { task_id: 't1', status: 'PROGRESS', status_message: null, result: null } });
        getJob.mockResolvedValueOnce({ data: { task_id: 't1', status: 'FAILED', status_message: 'scan unreadable', result: null } });
        mount();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(toast.error).not.toHaveBeenCalled();
        expect(listPendingPaperReads()).toHaveLength(1);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(toast.error.mock.calls[0]?.[0]).toContain('scan unreadable');
        expect(listPendingPaperReads()).toEqual([]);
    });

    it('does nothing at all when nothing is pending', async () => {
        mount();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(20_000);
        });
        expect(getJob).not.toHaveBeenCalled();
    });
});
