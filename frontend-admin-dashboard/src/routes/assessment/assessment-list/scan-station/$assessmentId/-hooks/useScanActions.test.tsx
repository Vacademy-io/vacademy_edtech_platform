import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { AxiosError, AxiosHeaders } from 'axios';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const axiosCall = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({ default: (...a: unknown[]) => axiosCall(...a) }));
vi.mock('@/constants/urls', () => ({ SCAN_STATION_BASE_URL: '/scan' }));
const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m), success: vi.fn() } }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

import { planChangedKey, scanConfigKey, scanSessionKey, useScanActions } from './useScanActions';
import { isPlanChanged } from '../-lib/api-error';

const refused = (status: number, ex: string) =>
    new AxiosError(ex, String(status), undefined, undefined, {
        status,
        statusText: '',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: { url: '/scan', ex, responseCode: `${status} CONFLICT`, date: '2026-11-18' },
    });

const PLAN_CHANGED = refused(
    409,
    'PLAN_CHANGED: this changed while you were looking at it; check it again'
);

const setup = () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useScanActions('s1', 'inst1'), { wrapper });
    return { result, invalidate };
};

describe('useScanActions', () => {
    beforeEach(() => {
        axiosCall.mockReset();
        toastError.mockReset();
    });

    it('sends expected_fingerprint with an accept, and null on every other decision', async () => {
        axiosCall.mockResolvedValue({ data: { id: 's1' } });
        const { result } = setup();
        act(() =>
            result.current.decide('ACCEPT_COPY', {
                load_no: 1,
                sheet_no: 0,
                expected_fingerprint: 'fp-copy',
            })
        );
        await waitFor(() => expect(axiosCall).toHaveBeenCalledTimes(1));
        expect(axiosCall.mock.calls[0]![0]).toMatchObject({
            method: 'POST',
            url: '/scan/session/s1/decision',
            params: { instituteId: 'inst1' },
            data: {
                action: 'ACCEPT_COPY',
                load_no: 1,
                sheet_no: 0,
                ref: null,
                code: null,
                value: null,
                expected_fingerprint: 'fp-copy',
            },
        });
        act(() => result.current.decide('EXCLUDE_COPY', { load_no: 1, sheet_no: 0 }));
        await waitFor(() => expect(axiosCall).toHaveBeenCalledTimes(2));
        expect(axiosCall.mock.calls[1]![0].data.expected_fingerprint).toBeNull();
    });

    it('on PLAN_CHANGED refreshes the session and says the copy changed', async () => {
        axiosCall.mockRejectedValue(PLAN_CHANGED);
        const { result, invalidate } = setup();
        act(() =>
            result.current.decide('ACCEPT_COPY', {
                load_no: 1,
                sheet_no: 0,
                expected_fingerprint: 'stale',
            })
        );
        await waitFor(() => expect(toastError).toHaveBeenCalledWith('errors.copyChanged'));
        expect(invalidate).toHaveBeenCalledWith({ queryKey: scanSessionKey('s1', 'inst1') });
    });

    it('names the blank pages when their confirm is refused', async () => {
        axiosCall.mockRejectedValue(PLAN_CHANGED);
        const { result } = setup();
        act(() =>
            result.current.decide('ACCEPT_LOAD_FLAG', {
                load_no: 1,
                code: 'BLANKS_TO_CONFIRM',
                expected_fingerprint: 'stale',
            })
        );
        await waitFor(() => expect(toastError).toHaveBeenCalledWith('errors.blanksChanged'));
    });

    it('keeps the plain "session changed" message for any other 409', async () => {
        axiosCall.mockRejectedValue(refused(409, 'Scan session is not open'));
        const { result, invalidate } = setup();
        act(() => result.current.decide('KEEP_PAGE', { load_no: 1, ref: 'p1.0' }));
        await waitFor(() => expect(toastError).toHaveBeenCalledWith('errors.locked'));
        expect(invalidate).toHaveBeenCalled();
    });

    it('on a 404 (switched off mid-session) re-reads the config, not the server text', async () => {
        axiosCall.mockRejectedValue(refused(404, 'Not found'));
        const { result, invalidate } = setup();
        act(() => result.current.decide('KEEP_PAGE', { load_no: 1, ref: 'p1.0' }));
        await waitFor(() => expect(toastError).toHaveBeenCalledWith('errors.decision'));
        expect(invalidate).toHaveBeenCalledWith({ queryKey: scanConfigKey('inst1') });
        expect(invalidate).not.toHaveBeenCalledWith({ queryKey: scanSessionKey('s1', 'inst1') });
    });
});

describe('PLAN_CHANGED helpers', () => {
    it('tells a PLAN_CHANGED refusal from other errors', () => {
        expect(isPlanChanged(PLAN_CHANGED)).toBe(true);
        expect(isPlanChanged(refused(409, 'NOT_READY: the session is BLOCKED'))).toBe(false);
        expect(isPlanChanged(refused(422, 'PLAN_CHANGED: odd status'))).toBe(false);
        expect(isPlanChanged(new Error('PLAN_CHANGED'))).toBe(false);
    });

    it('picks the message by what was being accepted', () => {
        expect(planChangedKey({ action: 'ACCEPT_COPY', code: null })).toBe('errors.copyChanged');
        expect(planChangedKey({ action: 'ACCEPT_LOAD_FLAG', code: 'BLANKS_TO_CONFIRM' })).toBe(
            'errors.blanksChanged'
        );
        expect(planChangedKey({ action: 'ACCEPT_LOAD_FLAG', code: 'DPI_LOW' })).toBe(
            'errors.flagChanged'
        );
    });
});
