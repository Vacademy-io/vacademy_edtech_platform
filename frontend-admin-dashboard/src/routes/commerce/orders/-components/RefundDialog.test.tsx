/**
 * The refund dialog's cap message (contract §5.7.4): always stated, a larger
 * amount is a field error with submit disabled, nothing due shows no form, and
 * the server's REFUND_ABOVE_DUE comes back as the same sentence.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError } from 'axios';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import type { CommerceAccessState } from '@/lib/commerce/use-commerce-access';

const state = vi.hoisted(() => ({ access: null as unknown }));
const api = vi.hoisted(() => ({ createRefund: vi.fn(), fetchReturn: vi.fn() }));

vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/services/capabilities', () => ({
    readCurrentInstituteIdSafely: () => 'inst-1',
    syncCapabilitiesOnce: () => Promise.resolve(),
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useTranslation: () => ({
        t: (key: string, options?: { amount?: string }) => (options?.amount ? `${key}|${options.amount}` : key),
        i18n: { language: 'en' },
    }),
}));
vi.mock('@/routes/commerce/orders/-shared/order-api', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    createRefund: api.createRefund,
    fetchReturn: api.fetchReturn,
}));

import { formatMoney } from '@/components/design-system/money-cell';
import { detailFixture } from '@/routes/commerce/orders/-shared/order-fixtures';
import { RefundDialog } from './dialogs/RefundDialog';

const detail = (refundOpen: string) =>
    detailFixture(
        { refund_open: refundOpen, refund_committed: 0 },
        { status: 'CANCELLED', payment_method: 'PREPAID', payment_status: 'PAID', amount_paid: '1200.00' }
    );

const renderDialog = (refundOpen = '300.00') =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <RefundDialog open onOpenChange={() => undefined} detail={detail(refundOpen)} />
        </QueryClientProvider>
    );

const cap = (amount: number) => `orders.refund.cap|${formatMoney(amount, 'INR')}`;

describe('RefundDialog', () => {
    beforeEach(() => {
        api.createRefund.mockReset();
        state.access = {
            ...resolveCommerceAccess({ roles: [COMMERCE_ROLE.STORE_MANAGER], isFeatureOn: () => true }),
            isResolved: true,
        } satisfies CommerceAccessState;
    });

    it('states the cap and starts the amount at it', async () => {
        renderDialog();
        expect(await screen.findByTestId('refund-cap')).toHaveTextContent(cap(300));
        expect(screen.getByLabelText(/orders.dialogs.amount/)).toHaveValue(300);
    });

    it('more than the cap is a field error and submit is disabled', async () => {
        renderDialog();
        const amount = await screen.findByLabelText(/orders.dialogs.amount/);
        fireEvent.change(amount, { target: { value: '350' } });
        const alerts = await screen.findAllByRole('alert');
        expect(alerts.some((node) => node.textContent === cap(300))).toBe(true);
        expect(screen.getByRole('button', { name: 'orders.refund.submit' })).toBeDisabled();
    });

    it('nothing due: the sentence and no form', () => {
        renderDialog('0');
        expect(screen.getByText('orders.refund.nothingDue')).toBeTruthy();
        expect(screen.queryByLabelText(/orders.dialogs.amount/)).toBeNull();
        expect(screen.queryByRole('button', { name: 'orders.refund.submit' })).toBeNull();
    });

    it('the server REFUND_ABOVE_DUE shows the same sentence with its amount', async () => {
        api.createRefund.mockRejectedValue(
            new AxiosError('x', 'ERR', undefined, undefined, {
                status: 409,
                data: { message: 'REFUND_ABOVE_DUE: 120.00 is due back to the customer' },
                headers: {},
                statusText: '',
                config: {} as never,
            } as never)
        );
        renderDialog();
        fireEvent.click(await screen.findByRole('button', { name: 'orders.refund.submit' }));
        await waitFor(() =>
            expect(screen.getByText(`orders.errors.REFUND_ABOVE_DUE|${formatMoney('120.00', 'INR')}`)).toBeTruthy()
        );
        expect(api.createRefund).toHaveBeenCalledWith(
            expect.objectContaining({ order_id: 'ord-1', amount: 300, method: 'UPI' })
        );
    });
});
