import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const post = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({ default: { post: (...a: unknown[]) => post(...a) } }));

import { useGetAttendance } from './attendance';

const wrapper = ({ children }: { children: React.ReactNode }) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return React.createElement(QueryClientProvider, { client }, children);
};

const filter = (instituteId: string) => ({
    institute_id: instituteId,
    name: '',
    start_date: '2020-01-01',
    end_date: '2026-09-07',
    batch_ids: null, // "All Batches" — the case that used to span every institute
    live_session_ids: null,
});

describe('useGetAttendance institute scoping', () => {
    beforeEach(() => {
        post.mockReset();
        post.mockResolvedValue({ data: { content: [], last: true, empty: true } });
    });

    it('sends institute_id in the request body even when no batch is selected', async () => {
        renderHook(() => useGetAttendance({ pageNo: 0, pageSize: 10, filterRequest: filter('inst-1') }), {
            wrapper,
        });

        await waitFor(() => expect(post).toHaveBeenCalled());

        const [, body] = post.mock.calls[0];
        expect(body.institute_id).toBe('inst-1');
        expect(body.batch_ids).toBeNull();
    });

    it('does not fire at all until an institute id is available', async () => {
        renderHook(() => useGetAttendance({ pageNo: 0, pageSize: 10, filterRequest: filter('') }), {
            wrapper,
        });

        await new Promise((r) => setTimeout(r, 50));
        expect(post).not.toHaveBeenCalled();
    });
});
