/**
 * F6: the order detail's action bar. The buttons come from the server's
 * `next_actions`; Confirm posts a transition from the status on screen with a
 * request id; a 409 state change is a toast plus a refetch; a 403 shows the
 * no-access sentence; a double click posts once.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import type { CommerceAccessState } from '@/lib/commerce/use-commerce-access';
import type { StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';

const state = vi.hoisted(() => ({ access: null as unknown }));
const api = vi.hoisted(() => ({ transitionOrder: vi.fn(), fetchOrder: vi.fn() }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/services/capabilities', () => ({
    readCurrentInstituteIdSafely: () => 'inst-1',
    syncCapabilitiesOnce: () => Promise.resolve(),
}));
vi.mock('@/constants/helper', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getInstituteId: () => 'inst-1',
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock('@/routes/commerce/orders/-shared/order-api', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    transitionOrder: api.transitionOrder,
    fetchOrder: api.fetchOrder,
}));

import { OrderActionBar } from './OrderActionBar';
import { OrderAccessAlertContext } from './order-ui';

const setRoles = (roles: string[]) => {
    state.access = {
        ...resolveCommerceAccess({ roles, isFeatureOn: () => true }),
        isResolved: true,
    } satisfies CommerceAccessState;
};

const detail = (nextActions: string[]): StaffOrderDetail => ({
    order: {
        id: 'ord-1',
        order_number: 'S-1001',
        channel: 'ONLINE',
        status: 'COD_PENDING_CONFIRMATION',
        payment_status: 'UNPAID',
        payment_method: 'COD',
        cancel_reason: null,
        customer_name: 'Test Buyer',
        customer_phone: '9000000001',
        currency: 'INR',
        total: 499,
        amount_paid: 0,
        created_at: '2026-11-16T10:00:00Z',
        stock_short: false,
        refund_due: null,
        shipment_status: null,
        tracking_number: null,
        status_since: '2026-11-16T10:00:00Z',
        refund_open: null,
        refund_state: null,
        return_state: null,
    },
    customer_id: null,
    customer_email: null,
    shipping_address: { name: 'Test Buyer', city: 'Test City', pincode: '100001' },
    billing_address: null,
    buyer_gstin: null,
    totals: null,
    coupon_code: null,
    customer_note: null,
    gift_note: null,
    fulfilment_location_id: 'loc-1',
    gateway_order_id: null,
    confirmed_at: null,
    cancelled_at: null,
    lines: [
        {
            id: 'line-1',
            line_no: 1,
            line_type: 'ITEM',
            package_session_id: 'ps-1',
            package_id: 'p-1',
            name: 'Cotton scarf',
            variant_label: 'Blue',
            sku: 'SCARF-BLUE',
            unit: null,
            qty_scale: 1,
            quantity: 1,
            unit_price: 499,
            mrp: 499,
            discount: null,
            tax_rate: 5,
            line_total: 499,
            qty_cancelled: 0,
            qty_shipped: 0,
            qty_returned: 0,
            stock_short_qty: null,
            list_unit_price: null,
            price_override_by: null,
        },
    ],
    tenders: [],
    timeline: [],
    shipments: [],
    stock_short: false,
    cod_amount: 499,
    cod_remittance_id: null,
    invoice_id: null,
    credit_note_ids: [],
    next_actions: nextActions,
    refund_committed: null,
    amount_refunded: null,
    refund_open: null,
    returns: [],
    refunds: [],
    exchange_of_order_id: null,
    notifications: [],
    replayed: false,
});

const axiosError = (status: number, message: string) =>
    new AxiosError('x', 'ERR', undefined, undefined, {
        status,
        data: { message },
        headers: {},
        statusText: '',
        config: {},
    } as never);

const renderBar = (value: StaffOrderDetail, onAccess?: (message: string) => void) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    render(
        <QueryClientProvider client={queryClient}>
            <OrderAccessAlertContext.Provider value={onAccess ?? null}>
                <OrderActionBar detail={value} />
            </OrderAccessAlertContext.Provider>
        </QueryClientProvider>
    );
    return { invalidate };
};

/** The bar's button opens the dialog; the dialog's button of the same name posts. */
const openConfirmAndSubmit = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'orders.actions.CONFIRM' }));
    await screen.findByText('orders.dialogs.confirm.title');
    const buttons = screen.getAllByRole('button', { name: 'orders.actions.CONFIRM' });
    return buttons[buttons.length - 1] as HTMLElement;
};

describe('OrderActionBar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setRoles([COMMERCE_ROLE.WAREHOUSE_STAFF]);
    });

    it('renders the server actions only: Confirm, and Cancel in the menu when offered', () => {
        renderBar(detail(['CONFIRM', 'CANCEL']));
        expect(screen.getByRole('button', { name: 'orders.actions.CONFIRM' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'orders.actions.more' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'orders.actions.PACK' })).toBeNull();
    });

    it('a detail without CANCEL has no menu and no "customer said no"', async () => {
        renderBar(detail(['CONFIRM']));
        expect(screen.queryByRole('button', { name: 'orders.actions.more' })).toBeNull();
        await openConfirmAndSubmit();
        expect(screen.queryByRole('button', { name: 'orders.cod.customerSaidNo' })).toBeNull();
    });

    it('Confirm posts a transition from the shown status with a request id', async () => {
        api.transitionOrder.mockResolvedValue(detail([]));
        renderBar(detail(['CONFIRM', 'CANCEL']));
        const submit = await openConfirmAndSubmit();
        expect(screen.getByRole('button', { name: 'orders.cod.customerSaidNo' })).toBeTruthy();
        fireEvent.click(submit);
        await waitFor(() => expect(api.transitionOrder).toHaveBeenCalledTimes(1));
        expect(api.transitionOrder).toHaveBeenCalledWith(
            'ord-1',
            expect.objectContaining({
                from_status: 'COD_PENDING_CONFIRMATION',
                to_status: 'CONFIRMED',
                client_request_id: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/),
            })
        );
        await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    });

    it('409 ORDER_STATE_CHANGED: the mapped sentence as a toast, and a refetch', async () => {
        api.transitionOrder.mockRejectedValue(axiosError(409, 'ORDER_STATE_CHANGED: order moved on'));
        const { invalidate } = renderBar(detail(['CONFIRM']));
        fireEvent.click(await openConfirmAndSubmit());
        await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('orders.errors.ORDER_STATE_CHANGED'));
        expect(invalidate).toHaveBeenCalled();
    });

    it('403 LOCATION_NOT_ALLOWED: the no-access sentence on the page', async () => {
        api.transitionOrder.mockRejectedValue(axiosError(403, 'LOCATION_NOT_ALLOWED: not your location'));
        const onAccess = vi.fn();
        renderBar(detail(['CONFIRM']), onAccess);
        fireEvent.click(await openConfirmAndSubmit());
        await waitFor(() => expect(onAccess).toHaveBeenCalledWith('orders.errors.LOCATION_NOT_ALLOWED'));
    });

    it('a double click posts once', async () => {
        let finish: (value: StaffOrderDetail) => void = () => undefined;
        api.transitionOrder.mockImplementation(
            () => new Promise<StaffOrderDetail>((resolve) => (finish = resolve))
        );
        renderBar(detail(['CONFIRM']));
        const submit = await openConfirmAndSubmit();
        fireEvent.click(submit);
        fireEvent.click(submit);
        await waitFor(() => expect(api.transitionOrder).toHaveBeenCalledTimes(1));
        finish(detail([]));
        await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
        expect(api.transitionOrder).toHaveBeenCalledTimes(1);
    });
});
