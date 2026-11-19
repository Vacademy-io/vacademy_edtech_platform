/**
 * F1 on screen: "Record receipt" asks for the order detail's `amount_due`
 * (server: total − paid − credit of goods returned before payment), not
 * total − paid. A ₹1,000 credit order with ₹300 returned owes ₹700.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import type { CommerceAccessState } from '@/lib/commerce/use-commerce-access';

const state = vi.hoisted(() => ({ access: null as unknown }));
const api = vi.hoisted(() => ({ recordReceipt: vi.fn() }));

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
    recordReceipt: api.recordReceipt,
}));

import { formatMoney } from '@/components/design-system/money-cell';
import { detailFixture } from '@/routes/commerce/orders/-shared/order-fixtures';
import { ReceiptDialog } from './dialogs/ReceiptDialog';

/** A staff credit order of ₹1,000, nothing paid; `money` adds the detail's own fields (amount_due). */
const creditOrder = (money: Record<string, unknown>) =>
    detailFixture(money, {
        channel: 'ADMIN',
        status: 'DELIVERED',
        payment_method: 'CREDIT',
        payment_status: 'UNPAID',
        total: '1000.00',
        amount_paid: 0,
    });

const renderDialog = (money: Record<string, unknown>) =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <ReceiptDialog open onOpenChange={() => undefined} detail={creditOrder(money)} />
        </QueryClientProvider>
    );

describe('ReceiptDialog', () => {
    beforeEach(() => {
        api.recordReceipt.mockReset();
        state.access = {
            ...resolveCommerceAccess({ roles: [COMMERCE_ROLE.STORE_MANAGER], isFeatureOn: () => true }),
            isResolved: true,
        } satisfies CommerceAccessState;
    });

    it('states and starts at the server amount_due (₹700 after a ₹300 return), not total − paid', async () => {
        renderDialog({ amount_due: '700.00' });
        expect(await screen.findByText(`orders.receipt.due|${formatMoney(700, 'INR')}`)).toBeTruthy();
        expect(screen.queryByText(`orders.receipt.due|${formatMoney(1000, 'INR')}`)).toBeNull();
        expect(screen.getByLabelText(/orders.dialogs.amount/)).toHaveValue(700);
    });

    it('more than amount_due is refused on the field with the server figure', async () => {
        renderDialog({ amount_due: '700.00' });
        const amount = await screen.findByLabelText(/orders.dialogs.amount/);
        fireEvent.change(amount, { target: { value: '700.01' } });
        fireEvent.click(screen.getByRole('button', { name: 'orders.actions.RECORD_RECEIPT' }));
        const alerts = await screen.findAllByRole('alert');
        expect(alerts.some((node) => node.textContent === `orders.errors.RECEIPT_ABOVE_DUE|${formatMoney(700, 'INR')}`)).toBe(
            true
        );
        expect(api.recordReceipt).not.toHaveBeenCalled();
    });

    it('a return that credits the whole order leaves nothing to receive', async () => {
        renderDialog({ amount_due: '0.00' });
        expect(await screen.findByText(`orders.receipt.due|${formatMoney(0, 'INR')}`)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'orders.actions.RECORD_RECEIPT' })).toBeDisabled();
    });

    it('without amount_due (an older server) the due is total − paid', async () => {
        renderDialog({});
        expect(await screen.findByText(`orders.receipt.due|${formatMoney(1000, 'INR')}`)).toBeTruthy();
    });
});
