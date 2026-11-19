/**
 * Contract §15 (owner 11-19) and review M10 on screen: a staff order left on
 * credit can be returned before it is paid. The return dialog says what is
 * still owed and that the credit first lowers it, and splits the estimate;
 * the order's totals show "Still owed" from `amount_due` and how much the
 * returns took off. Website orders show none of it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';

const state = vi.hoisted(() => ({ access: null as unknown }));
const api = vi.hoisted(() => ({ createReturn: vi.fn(), previewReturn: vi.fn() }));

vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/services/capabilities', () => ({
    readCurrentInstituteIdSafely: () => 'inst-1',
    syncCapabilitiesOnce: () => Promise.resolve(),
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('react-i18next', async () => {
    const { localeT } = await import('@/routes/commerce/-shared/en-t');
    const t = localeT('en');
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});
vi.mock('@/routes/commerce/orders/-shared/order-api', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    createReturn: api.createReturn,
    previewReturn: api.previewReturn,
}));
// The design-system select is a popover; a native one stands in for choosing.
vi.mock('@/routes/commerce/-components/CatalogueBits', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    PlainSelect: ({
        label,
        value,
        onChange,
        options,
    }: {
        label: string;
        value: string;
        onChange: (value: string) => void;
        options: { value: string; label: string }[];
    }) => (
        <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="" />
            {options.map((o) => (
                <option key={o.value} value={o.value}>
                    {o.label}
                </option>
            ))}
        </select>
    ),
}));

import { detailFixture } from '@/routes/commerce/orders/-shared/order-fixtures';
import { ReturnCreateDialog } from './dialogs/ReturnCreateDialog';
import { OrderTotalsCard } from './OrderTotalsCard';

const shippedLine = {
    id: 'line-1',
    line_no: 1,
    line_type: 'ITEM',
    package_session_id: 'ps-scarf',
    name: 'Cotton scarf',
    sku: 'SCARF-1',
    qty_scale: 1,
    quantity: 2,
    qty_cancelled: 0,
    qty_shipped: 2,
    qty_returned: 0,
    unit_price: '500.00',
};

/** A ₹1,000 staff credit order, delivered; `money` adds the detail's own fields. */
const creditOrder = (money: Record<string, unknown>, order: Record<string, unknown> = {}) =>
    detailFixture(
        { lines: [shippedLine], ...money },
        {
            channel: 'ADMIN',
            status: 'DELIVERED',
            payment_method: 'CREDIT',
            payment_status: 'UNPAID',
            total: '1000.00',
            amount_paid: 0,
            ...order,
        }
    );

const wrap = (node: React.ReactNode) =>
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

beforeEach(() => {
    vi.clearAllMocks();
    state.access = {
        ...resolveCommerceAccess({ roles: [COMMERCE_ROLE.STORE_MANAGER], isFeatureOn: () => false }),
        isResolved: true,
    };
});

describe('ReturnCreateDialog on an unpaid staff credit order', () => {
    it('says what is owed and that the credit lowers it; the estimate splits into "off what is owed" and "paid back"', async () => {
        api.previewReturn.mockResolvedValue({ policy: null, warnings: [], lines: [], credit_estimate: 700 });
        wrap(
            <ReturnCreateDialog
                open
                onOpenChange={() => undefined}
                detail={creditOrder({ amount_due: '600.00' }, { payment_status: 'PARTIALLY_PAID', amount_paid: '400.00' })}
            />
        );
        expect(screen.getByTestId('return-before-payment').textContent).toBe(
            'This order still owes ₹600.00. The credit of this return first lowers what is owed; only the part above it is paid back.'
        );
        fireEvent.change(screen.getByLabelText(/Cotton scarf/), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Reason for the return'), { target: { value: 'DEFECTIVE' } });
        const split = await screen.findByTestId('return-credit-split', {}, { timeout: 2000 });
        expect(split.textContent).toContain('Off what is owed (estimate)₹600.00');
        expect(split.textContent).toContain('To pay back (estimate)₹100.00');
        // The return goes to the server like any other: nothing blocks it on screen.
        expect(screen.getByTestId('return-create-submit')).not.toBeDisabled();
    });

    it('a ₹300 return on a ₹1,000 unpaid order: all of it comes off what is owed, nothing is paid back', async () => {
        api.previewReturn.mockResolvedValue({ policy: null, warnings: [], lines: [], credit_estimate: 300 });
        wrap(<ReturnCreateDialog open onOpenChange={() => undefined} detail={creditOrder({ amount_due: '1000.00' })} />);
        fireEvent.change(screen.getByLabelText(/Cotton scarf/), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Reason for the return'), { target: { value: 'DEFECTIVE' } });
        const split = await screen.findByTestId('return-credit-split', {}, { timeout: 2000 });
        expect(split.textContent).toContain('Off what is owed (estimate)₹300.00');
        expect(split.textContent).toContain('To pay back (estimate)₹0.00');
    });

    it('shows the server\'s split (credit_to_due, refund_amount) instead of its own estimate', async () => {
        // ₹50 received, ₹950 owed by the screen's reckoning; the server says ₹600 off the due and ₹50 back.
        api.previewReturn.mockResolvedValue({
            policy: null,
            warnings: [],
            lines: [],
            credit_estimate: 700,
            credit_to_due: 600,
            refund_amount: 50,
        });
        wrap(
            <ReturnCreateDialog
                open
                onOpenChange={() => undefined}
                detail={creditOrder({ amount_due: '600.00' }, { payment_status: 'PARTIALLY_PAID', amount_paid: '50.00' })}
            />
        );
        fireEvent.change(screen.getByLabelText(/Cotton scarf/), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Reason for the return'), { target: { value: 'DEFECTIVE' } });
        const split = await screen.findByTestId('return-credit-split', {}, { timeout: 2000 });
        expect(split.textContent).toContain('Off what is owed (estimate)₹600.00');
        expect(split.textContent).toContain('To pay back (estimate)₹50.00');
        expect(split.textContent).not.toContain('₹100.00');
    });

    it('a paid website order shows neither the owed line nor the split', async () => {
        api.previewReturn.mockResolvedValue({ policy: null, warnings: [], lines: [], credit_estimate: 300 });
        wrap(
            <ReturnCreateDialog
                open
                onOpenChange={() => undefined}
                detail={creditOrder({ amount_due: 0 }, { channel: 'ONLINE', payment_method: 'PREPAID', payment_status: 'PAID', amount_paid: '1000.00' })}
            />
        );
        expect(screen.queryByTestId('return-before-payment')).toBeNull();
        fireEvent.change(screen.getByLabelText(/Cotton scarf/), { target: { value: '1' } });
        fireEvent.change(screen.getByLabelText('Reason for the return'), { target: { value: 'DEFECTIVE' } });
        await waitFor(() => expect(api.previewReturn).toHaveBeenCalled(), { timeout: 2000 });
        expect(screen.queryByTestId('return-credit-split')).toBeNull();
    });
});

describe('OrderTotalsCard: "Still owed" (M10)', () => {
    it('shows the server amount_due and how much returns before payment took off', () => {
        render(<OrderTotalsCard detail={creditOrder({ amount_due: '700.00' })} />);
        expect(screen.getByText('Still owed')).toBeTruthy();
        expect(screen.getByText('₹700.00')).toBeTruthy();
        expect(screen.getByTestId('order-due-lowered').textContent).toBe(
            'Goods returned before payment took ₹300.00 off what is owed.'
        );
    });

    it('a fully returned unpaid order owes nothing and says why', () => {
        render(<OrderTotalsCard detail={creditOrder({ amount_due: 0 })} />);
        expect(screen.getByText('Still owed')).toBeTruthy();
        expect(screen.getByTestId('order-due-lowered').textContent).toContain('₹1,000.00');
    });

    it('a paid order shows no "Still owed" line', () => {
        render(
            <OrderTotalsCard
                detail={creditOrder({ amount_due: 0 }, { channel: 'ONLINE', payment_status: 'PAID', amount_paid: '1000.00' })}
            />
        );
        expect(screen.queryByText('Still owed')).toBeNull();
    });
});
