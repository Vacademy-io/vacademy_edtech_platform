import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const status = vi.fn();
vi.mock('../-lib/scan-helper-client', () => ({
    scanHelper: { status: (...a: unknown[]) => status(...a) },
}));

import { HELPER_STATUS_POLL_MS, useScanHelperStatus } from './useScanHelperStatus';

let visibility: DocumentVisibilityState = 'visible';
const setVisibility = (v: DocumentVisibilityState) => {
    visibility = v;
    document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
    vi.useFakeTimers();
    status.mockReset();
    status.mockResolvedValue({ helper: {}, state: 'idle', scanners: [], printers: [] });
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => visibility,
    });
});
afterEach(() => {
    vi.useRealTimers();
});

describe('useScanHelperStatus', () => {
    it('asks every 3 s while the page is visible', async () => {
        expect(HELPER_STATUS_POLL_MS).toBe(3000);
        const { result } = renderHook(() => useScanHelperStatus(true));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(status).toHaveBeenCalledTimes(1);
        expect(result.current).not.toBeUndefined();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2999);
        });
        expect(status).toHaveBeenCalledTimes(1);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
        expect(status).toHaveBeenCalledTimes(2);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(6000);
        });
        expect(status).toHaveBeenCalledTimes(4);
    });

    it('stops while the page is hidden and asks at once when it is back', async () => {
        renderHook(() => useScanHelperStatus(true));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(status).toHaveBeenCalledTimes(1);
        act(() => setVisibility('hidden'));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(30_000);
        });
        expect(status).toHaveBeenCalledTimes(1);
        await act(async () => {
            setVisibility('visible');
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(status).toHaveBeenCalledTimes(2);
    });

    it('reports null when nothing answers', async () => {
        status.mockRejectedValue(new Error('refused'));
        const { result } = renderHook(() => useScanHelperStatus(true));
        expect(result.current).toBeUndefined();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(result.current).toBeNull();
    });

    it('does not ask at all when switched off', async () => {
        renderHook(() => useScanHelperStatus(false));
        await act(async () => {
            await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(status).not.toHaveBeenCalled();
    });
});
