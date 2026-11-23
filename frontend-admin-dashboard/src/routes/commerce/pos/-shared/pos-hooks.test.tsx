/**
 * POS review follow-ups: a bill does not refetch the whole catalogue (writes
 * leave the catalogue reads alone), and a write's variables (a resend carries
 * the manager's PIN) leave the mutation cache as soon as it settles.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => ({ isResolved: true }) }));

import { invalidatePos, isCatalogueKey, posKeys, usePosWrite } from './pos-hooks';

describe('invalidatePos', () => {
    it('marks every counter read stale except the catalogue and its search', async () => {
        const client = new QueryClient();
        client.setQueryData(posKeys.catalogue('reg-1'), { items: [] });
        client.setQueryData(posKeys.catalogueSearch('reg-1', 'bo'), { items: [] });
        client.setQueryData(posKeys.session('sess-1'), { id: 'sess-1' });
        client.setQueryData(posKeys.sessionSales('sess-1', 0), { rows: [] });
        await invalidatePos(client);
        const stale = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated;
        expect(stale(posKeys.catalogue('reg-1'))).toBe(false);
        expect(stale(posKeys.catalogueSearch('reg-1', 'bo'))).toBe(false);
        expect(stale(posKeys.session('sess-1'))).toBe(true);
        expect(stale(posKeys.sessionSales('sess-1', 0))).toBe(true);
        expect(isCatalogueKey(posKeys.registers())).toBe(false);
    });
});

describe('usePosWrite', () => {
    it('keeps no variables (the PIN) in the mutation cache once the write settles', async () => {
        const client = new QueryClient();
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        );
        const send = vi.fn(async (body: { approval: { pin: string } }) => body);
        const { result } = renderHook(() => usePosWrite(send), { wrapper });
        await act(async () => {
            await result.current.mutateAsync([{ approval: { pin: '123456' } }]);
        });
        await act(async () => {
            await new Promise((r) => setTimeout(r, 10));
        });
        const kept = client
            .getMutationCache()
            .getAll()
            .map((m) => JSON.stringify(m.state.variables ?? null));
        expect(kept.some((v) => v.includes('123456'))).toBe(false);
    });
});
