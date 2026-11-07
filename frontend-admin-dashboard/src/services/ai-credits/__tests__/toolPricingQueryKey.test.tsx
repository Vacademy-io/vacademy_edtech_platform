import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

let currentInstitute: string | undefined = 'inst-a';

vi.mock('@/lib/auth/instituteUtils', () => ({
    getCurrentInstituteId: () => currentInstitute,
}));

const getMock = vi.fn();
vi.mock('@/lib/auth/axiosInstance', () => ({
    default: { get: (...args: unknown[]) => getMock(...args), post: vi.fn() },
}));

import { toolPricingQueryKey, useToolPricingQuery } from '@/services/ai-credits/get-ai-credits';

const wrapperFor = (client: QueryClient) =>
    function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    };

describe('tool pricing preview cache key (spec §10.4)', () => {
    beforeEach(() => {
        getMock.mockReset();
        currentInstitute = 'inst-a';
    });

    it('includes the institute id', () => {
        expect(toolPricingQueryKey('inst-a')).toEqual(['GET_TOOL_PRICING', 'inst-a']);
        expect(toolPricingQueryKey(undefined)).toEqual(['GET_TOOL_PRICING', null]);
    });

    it('keeps one cache entry per institute, so a switch refetches', async () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        getMock.mockResolvedValueOnce({ data: { tools: [{ tool_key: 'a' }] } });
        const first = renderHook(() => useToolPricingQuery(), { wrapper: wrapperFor(client) });
        await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
        expect(client.getQueryData(['GET_TOOL_PRICING', 'inst-a'])).toEqual({
            tools: [{ tool_key: 'a' }],
        });

        currentInstitute = 'inst-b';
        getMock.mockResolvedValueOnce({ data: { tools: [{ tool_key: 'b' }] } });
        const second = renderHook(() => useToolPricingQuery(), { wrapper: wrapperFor(client) });
        await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
        expect(second.result.current.data).toEqual({ tools: [{ tool_key: 'b' }] });
        expect(getMock).toHaveBeenCalledTimes(2);
        // The first institute's rates are still cached under their own key.
        expect(client.getQueryData(['GET_TOOL_PRICING', 'inst-a'])).toEqual({
            tools: [{ tool_key: 'a' }],
        });
    });
});
