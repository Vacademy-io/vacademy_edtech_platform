/**
 * POS review follow-ups: a counter return (and any PIN-gated write) keeps its
 * request id after an unanswered attempt, across the form being left and a
 * reload; when that id turns out to be saved with another body the screen
 * says so instead of making a second return.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';

vi.mock('@/lib/commerce/use-commerce-access', () => ({
    useCommerceAccess: () => ({
        ...resolveCommerceAccess({ roles: [COMMERCE_ROLE.POS_CASHIER], isFeatureOn: () => true }),
        isResolved: true,
    }),
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../-shared/pos-api', () => ({ fetchApprovers: vi.fn(async () => []) }));

import { readPosError } from '../-shared/pos-errors';
import { useAttemptStore } from '../-shared/pos-session-store';
import { networkError, serverError } from '../-shared/pos-test-fixtures';
import { usePinWrite } from './PosPinGate';

const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const useReturnWrite = () => usePinWrite('reg-1', 'posret', useAttemptStore('inst-1', 'sess-1', 'posret'));

type Sent = { client_request_id: string; lines: number };

afterEach(() => sessionStorage.clear());

describe('usePinWrite with the session attempt store', () => {
    it('a return re-made after a timeout and a reload goes with the first id; a mismatch says it was saved', async () => {
        const sent: Sent[] = [];
        const first = renderHook(useReturnWrite, { wrapper });
        await act(async () => {
            await expect(
                first.result.current.run(
                    { lines: 2 },
                    async (full: Sent) => {
                        sent.push(full);
                        throw networkError();
                    },
                    () => undefined,
                    'return.o-1'
                )
            ).rejects.toBeTruthy();
        });
        first.unmount(); // "Find another", or a reload

        const second = renderHook(useReturnWrite, { wrapper });
        let error: unknown = null;
        await act(async () => {
            try {
                await second.result.current.run(
                    { lines: 1 },
                    async (full: Sent) => {
                        sent.push(full);
                        throw serverError(409, 'IDEMPOTENCY_MISMATCH: client_request_id was already used');
                    },
                    () => undefined,
                    'return.o-1'
                );
            } catch (e) {
                error = e;
            }
        });
        expect(sent).toHaveLength(2);
        expect(sent[1]?.client_request_id).toBe(sent[0]?.client_request_id);
        expect(readPosError(error).code).toBe('PROBABLY_SAVED');
        expect(readPosError(error).posKey).toBe('pos.errors.PROBABLY_SAVED');
    });

    it('another bill’s return is a separate attempt', async () => {
        const sent: Sent[] = [];
        const hook = renderHook(useReturnWrite, { wrapper });
        await act(async () => {
            await hook.result.current
                .run({ lines: 1 }, async (full: Sent) => {
                    sent.push(full);
                    throw networkError();
                }, () => undefined, 'return.o-1')
                .catch(() => undefined);
            await hook.result.current.run(
                { lines: 1 },
                async (full: Sent) => {
                    sent.push(full);
                    return full;
                },
                () => undefined,
                'return.o-2'
            );
        });
        expect(sent[1]?.client_request_id).not.toBe(sent[0]?.client_request_id);
    });
});
