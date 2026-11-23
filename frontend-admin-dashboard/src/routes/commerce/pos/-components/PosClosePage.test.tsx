/**
 * Contract §8.3, closing the counter: the denomination grid sums; a non-zero
 * difference needs a note; APPROVAL_REQUIRED: POS_VARIANCE opens the PIN
 * dialog and the same body goes again with the approval.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import type { CommerceAccessState } from '@/lib/commerce/use-commerce-access';

const state = vi.hoisted(() => ({ access: null as unknown }));

vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock('../-shared/pos-api', () => ({
    closeSession: vi.fn(),
    fetchApprovers: vi.fn(async () => [{ user_id: 'm-1', full_name: 'Test Manager' }]),
    addCashMovement: vi.fn(),
}));
vi.mock('../-shared/pos-receipt', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../-shared/pos-receipt')>()),
    printReceipt: vi.fn(),
}));
vi.mock('@/routes/commerce/-components/ManagerPinDialog', () => ({
    ManagerPinDialog: ({
        open,
        onApprove,
        onOpenChange,
    }: {
        open: boolean;
        onApprove: (a: { approver_user_id: string; pin: string }) => Promise<void>;
        onOpenChange: (open: boolean) => void;
    }) =>
        open ? (
            <button
                type="button"
                data-testid="pin-approve"
                onClick={() =>
                    void onApprove({ approver_user_id: 'm-1', pin: '123456' }).then(
                        () => onOpenChange(false),
                        () => undefined
                    )
                }
            >
                approve
            </button>
        ) : null,
}));

import * as api from '../-shared/pos-api';
import { serverError, session } from '../-shared/pos-test-fixtures';
import type { ZReport } from '../-shared/pos-types';
import { PosCloseBody, denominationTotal } from './PosClosePage';

const mocked = vi.mocked(api);

const summary = (expected: number): ZReport => ({
    session_id: 'sess-1',
    register: { code: 'C1', name: 'Front counter' },
    location: { name: 'Main store' },
    cashier_user_id: 'u-cashier',
    opened_at: '2026-11-18T04:30:00Z',
    closed_at: null,
    opening_cash: 500,
    bills: { count: 2, total: 1450 },
    voided: { count: 0, total: 0 },
    discounts: 0,
    by_mode: [
        { mode: 'CASH', count: 1, amount: 1000 },
        { mode: 'UPI', count: 1, amount: 450 },
    ],
    tax_by_rate: [],
    refunds: [],
    refunds_pending: [],
    returns: { count: 0, credit: 0 },
    cash_in: 0,
    cash_out: 0,
    expected_cash: expected,
    counted_cash: null,
    variance: null,
    denominations: null,
    bill_book: { count: 0, total: 0 },
    first_invoice_number: null,
    last_invoice_number: null,
});

const renderClose = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <PosCloseBody session={session({ summary: summary(1500) })} online />
        </QueryClientProvider>
    );
};

const count = (note: number, value: string) =>
    fireEvent.change(screen.getByTestId(`pos-den-${note}`), { target: { value } });

describe('PosClosePage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.access = {
            ...resolveCommerceAccess({ roles: [COMMERCE_ROLE.POS_CASHIER], isFeatureOn: () => true }),
            isResolved: true,
        } satisfies CommerceAccessState;
    });

    it('sums the denominations', () => {
        expect(denominationTotal({ '500': '2', '100': '3', '2': '1', '50': 'x' })).toBe(1302);
        renderClose();
        count(500, '2');
        count(100, '3');
        count(2, '1');
        expect(screen.getByTestId('pos-close-counted').textContent).toBe('₹1,302.00');
        expect(screen.getByTestId('pos-close-difference').textContent).toBe('− ₹198.00');
    });

    it('a difference needs a note; a matching count closes without one', async () => {
        mocked.closeSession.mockResolvedValue(session({ status: 'CLOSED', z_report: summary(1500) }));
        renderClose();
        count(500, '2');
        fireEvent.click(screen.getByTestId('pos-close-submit'));
        expect(await screen.findByText('pos.close.noteRequired')).toBeTruthy();
        expect(mocked.closeSession).not.toHaveBeenCalled();

        count(500, '3');
        fireEvent.click(screen.getByTestId('pos-close-submit'));
        await waitFor(() => expect(mocked.closeSession).toHaveBeenCalledTimes(1));
        const [id, body] = mocked.closeSession.mock.calls[0] ?? [];
        expect(id).toBe('sess-1');
        expect(body?.denominations).toMatchObject({ '500': 3, '2000': 0, '1': 0 });
        expect(body?.counted_cash).toBeUndefined();
        expect(body?.note).toBeUndefined();
        expect(body?.client_request_id).toMatch(/^posclose-/);
        expect(await screen.findByText('pos.close.done')).toBeTruthy();
    });

    it('APPROVAL_REQUIRED: POS_VARIANCE opens the PIN dialog and resends with the approval', async () => {
        mocked.closeSession
            .mockRejectedValueOnce(serverError(409, 'APPROVAL_REQUIRED: POS_VARIANCE difference above the limit'))
            .mockResolvedValueOnce(session({ status: 'CLOSED', z_report: summary(1500) }));
        renderClose();
        count(500, '2');
        fireEvent.change(screen.getByLabelText(/pos.close.note/), { target: { value: 'Short by a note' } });
        fireEvent.click(screen.getByTestId('pos-close-submit'));
        fireEvent.click(await screen.findByTestId('pin-approve'));
        await waitFor(() => expect(mocked.closeSession).toHaveBeenCalledTimes(2));
        const first = mocked.closeSession.mock.calls[0]?.[1];
        const second = mocked.closeSession.mock.calls[1]?.[1];
        expect(first?.approval).toBeUndefined();
        expect(second?.approval).toEqual({ approver_user_id: 'm-1', pin: '123456' });
        expect(second?.client_request_id).toBe(first?.client_request_id);
        expect(second?.note).toBe('Short by a note');
        expect(await screen.findByText('pos.close.done')).toBeTruthy();
    });
});
