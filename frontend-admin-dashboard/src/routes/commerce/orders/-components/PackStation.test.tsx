/**
 * F8: the pack station. A scanner's keystroke burst + Enter looks the code up
 * and the line count rises; Pack stays disabled until every line is complete;
 * Pack sends piece codes for one-of-a-kind lines only; a 409
 * PIECE_SCAN_REQUIRED turns the named line into a piece line; warehouse staff
 * may pack, an accountant gets "no access" and no request is fired.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import type { CommerceAccessState } from '@/lib/commerce/use-commerce-access';
import type { ScanResult, StaffOrderDetail } from '@/routes/commerce/orders/-shared/order-types';

const state = vi.hoisted(() => ({ access: null as unknown }));

vi.mock('@/lib/commerce/use-commerce-access', () => ({
    useCommerceAccess: () => state.access,
}));
vi.mock('@/services/capabilities', () => ({
    readCurrentInstituteIdSafely: () => 'inst-1',
    syncCapabilitiesOnce: () => Promise.resolve(),
}));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('react-i18next', () => ({
    // A `name` option is shown, so per-line labels can be told apart.
    useTranslation: () => ({
        t: (key: string, options?: { name?: string }) => (options?.name ? `${key}:${options.name}` : key),
        i18n: { language: 'en' },
    }),
}));
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
    useBlocker: () => undefined,
}));
vi.mock('./dialogs/ShipDialog', () => ({ ShipDialog: () => null }));
vi.mock('@/routes/commerce/orders/-shared/order-api', () => ({
    fetchOrder: vi.fn(),
    fetchOrders: vi.fn(),
    scanCode: vi.fn(),
    packOrder: vi.fn(),
    fetchInvoicePdfUrl: vi.fn(),
}));

import * as api from '@/routes/commerce/orders/-shared/order-api';
import { PackStationBody } from './PackStationPage';

const mocked = vi.mocked(api);

const setRoles = (roles: string[]) => {
    state.access = {
        ...resolveCommerceAccess({ roles, isFeatureOn: () => true }),
        isResolved: true,
    } satisfies CommerceAccessState;
};

const line = (id: string, lineNo: number, ps: string, name: string, quantity: number) => ({
    id,
    line_no: lineNo,
    line_type: 'ITEM',
    package_session_id: ps,
    package_id: null,
    name,
    variant_label: null,
    sku: `SKU-${lineNo}`,
    unit: null,
    qty_scale: 1,
    quantity,
    unit_price: 100,
    mrp: null,
    discount: null,
    tax_rate: null,
    line_total: 100 * quantity,
    qty_cancelled: 0,
    qty_shipped: 0,
    qty_returned: 0,
    stock_short_qty: null,
    list_unit_price: null,
    price_override_by: null,
});

const detail = (): StaffOrderDetail => ({
    order: {
        id: 'o-1',
        order_number: 'SO-1001',
        channel: 'ONLINE',
        status: 'CONFIRMED',
        payment_status: 'PAID',
        payment_method: 'PREPAID',
        cancel_reason: null,
        customer_name: 'Test Customer',
        customer_phone: '9000000000',
        currency: 'INR',
        total: 300,
        amount_paid: 300,
        created_at: null,
        stock_short: false,
        refund_due: null,
        shipment_status: null,
        tracking_number: null,
        status_since: null,
        refund_open: null,
        refund_state: null,
        return_state: null,
    },
    customer_id: null,
    customer_email: null,
    shipping_address: { city: 'Test City', pincode: '100001' },
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
    // Line 1 has no B1 facts (UNKNOWN); line 2 is a counted item.
    lines: [line('l-1', 1, 'ps-1', 'Cotton scarf', 1), line('l-2', 2, 'ps-2', 'Steel bottle', 2)],
    tenders: [],
    timeline: [],
    shipments: [],
    stock_short: false,
    cod_amount: null,
    cod_remittance_id: null,
    invoice_id: null,
    credit_note_ids: [],
    next_actions: ['PACK', 'CANCEL'],
    refund_committed: null,
    amount_refunded: null,
    refund_open: null,
    returns: [],
    refunds: [],
    exchange_of_order_id: null,
    notifications: [],
    replayed: false,
});

const variantScan = (ps: string): ScanResult => ({
    kind: 'VARIANT',
    variant: {
        package_session_id: ps,
        package_id: null,
        sku: null,
        product_name: null,
        variant_name: null,
        stock_mode: null,
        stock_policy: null,
        unit: null,
        qty_scale: 1,
    },
    piece: null,
});

const pieceScan = (ps: string, code: string): ScanResult => ({
    ...variantScan(ps),
    kind: 'PIECE',
    piece: { id: `id-${code}`, code, status: 'IN_STOCK', location_id: 'loc-1' },
});

const renderStation = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <PackStationBody initialOrderId="o-1" />
        </QueryClientProvider>
    );
};

/** A scanner: one fast burst of characters, then Enter. */
const scanInto = (code: string) => {
    const box = screen.getByLabelText('orders.pack.scanItems', { selector: 'input' });
    for (let i = 1; i <= code.length; i += 1) {
        fireEvent.change(box, { target: { value: code.slice(0, i) } });
    }
    fireEvent.keyDown(box, { key: 'Enter' });
};

const packButton = () => screen.getAllByRole('button', { name: 'orders.actions.PACK' })[0] as HTMLButtonElement;
const count = (lineNo: number) => screen.getByTestId(`pack-count-${lineNo}`).textContent?.replace(/\s+/g, ' ');

describe('pack station', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocked.fetchOrder.mockResolvedValue(detail());
    });

    it('warehouse staff: a scan burst + Enter looks the code up and the count rises', async () => {
        setRoles([COMMERCE_ROLE.WAREHOUSE_STAFF]);
        mocked.scanCode.mockResolvedValue(variantScan('ps-2'));
        renderStation();
        await screen.findByText('Steel bottle');
        expect(count(2)).toBe('0 / 2');
        scanInto('V-BOTTLE');
        await waitFor(() => expect(mocked.scanCode).toHaveBeenCalledWith('V-BOTTLE'));
        await waitFor(() => expect(count(2)).toBe('1 / 2'));
    });

    it('Pack is disabled until complete, then sends piece codes for the piece line only', async () => {
        setRoles([COMMERCE_ROLE.WAREHOUSE_STAFF]);
        mocked.packOrder.mockResolvedValue({ ...detail(), next_actions: ['SHIP'] });
        renderStation();
        await screen.findByText('Cotton scarf');
        expect(packButton().disabled).toBe(true);

        mocked.scanCode.mockResolvedValueOnce(pieceScan('ps-1', 'P-0001'));
        scanInto('P-0001');
        await waitFor(() => expect(count(1)).toBe('1 / 1'));
        expect(screen.getByTestId('pack-line-1').getAttribute('data-mode')).toBe('PIECE');
        expect(packButton().disabled).toBe(true);

        mocked.scanCode.mockResolvedValue(variantScan('ps-2'));
        scanInto('V-BOTTLE');
        await waitFor(() => expect(count(2)).toBe('1 / 2'));
        scanInto('V-BOTTLE-2');
        await waitFor(() => expect(count(2)).toBe('2 / 2'));
        expect(packButton().disabled).toBe(false);

        fireEvent.click(packButton());
        await waitFor(() => expect(mocked.packOrder).toHaveBeenCalledTimes(1));
        const body = mocked.packOrder.mock.calls[0]?.[0];
        expect(body?.order_id).toBe('o-1');
        expect(body?.from_status).toBe('CONFIRMED');
        expect(body?.client_request_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
        expect(body?.lines).toEqual([
            { order_line_id: 'l-1', quantity: 1, piece_codes: ['P-0001'] },
            { order_line_id: 'l-2', quantity: 2 },
        ]);
        expect(await screen.findByText('orders.pack.done')).toBeTruthy();
    });

    it('409 PIECE_SCAN_REQUIRED: line 1 becomes a piece line and its tick is undone', async () => {
        setRoles([COMMERCE_ROLE.STORE_MANAGER]);
        const response = {
            status: 409,
            data: { message: 'PIECE_SCAN_REQUIRED: line 1 needs a scanned piece for each unit' },
            headers: {},
            statusText: 'Conflict',
            config: {},
        } as unknown as AxiosResponse;
        mocked.packOrder.mockRejectedValue(new AxiosError('conflict', '409', undefined, undefined, response));
        renderStation();
        await screen.findByText('Cotton scarf');
        const ticks = screen.getAllByRole('checkbox');
        ticks.forEach((tick) => fireEvent.click(tick));
        await waitFor(() => expect(packButton().disabled).toBe(false));

        fireEvent.click(packButton());
        await waitFor(() => expect(screen.getByTestId('pack-line-1').getAttribute('data-mode')).toBe('PIECE'));
        expect(count(1)).toBe('0 / 1');
        expect(within(screen.getByTestId('pack-line-1')).queryByRole('checkbox')).toBeNull();
        expect(screen.getByText('orders.errors.PIECE_SCAN_REQUIRED')).toBeTruthy();
        expect(packButton().disabled).toBe(true);
    });

    it('an accountant gets "no access" and no request is fired', async () => {
        setRoles([COMMERCE_ROLE.ACCOUNTANT]);
        renderStation();
        expect(screen.getByText('noAccess.title')).toBeTruthy();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(mocked.fetchOrder).not.toHaveBeenCalled();
        expect(mocked.fetchOrders).not.toHaveBeenCalled();
        expect(mocked.scanCode).not.toHaveBeenCalled();
    });
});

/** Lets the query resolve and the effects run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('pack station: the scan box keeps the focus for a USB scanner', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setRoles([COMMERCE_ROLE.WAREHOUSE_STAFF]);
        mocked.fetchOrder.mockResolvedValue(detail());
    });

    it("opened from the desk's Pack button (?order=): the box is focused once the order loads", async () => {
        renderStation();
        const box = await screen.findByLabelText('orders.pack.scanItems', { selector: 'input' });
        await settle();
        expect(document.activeElement).toBe(box);

        // The first scan goes into the box, not into the page.
        mocked.scanCode.mockResolvedValue(variantScan('ps-2'));
        scanInto('V-BOTTLE');
        await waitFor(() => expect(count(2)).toBe('1 / 2'));
        expect(document.activeElement).toBe(
            screen.getByLabelText('orders.pack.scanItems', { selector: 'input' })
        );
    });

    it('after scanning the packing slip: the packing view box is focused for the first item', async () => {
        mocked.fetchOrders.mockResolvedValue({ orders: [detail().order], page: 0, page_size: 5, total: 1 } as never);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={client}>
                <PackStationBody />
            </QueryClientProvider>
        );
        const first = screen.getByLabelText('orders.pack.scanPrompt', { selector: 'input' });
        expect(document.activeElement).toBe(first);
        fireEvent.change(first, { target: { value: 'SO-1001' } });
        fireEvent.keyDown(first, { key: 'Enter' });
        const box = await screen.findByLabelText('orders.pack.scanItems', { selector: 'input' });
        await settle();
        expect(box).not.toBe(first);
        expect(document.activeElement).toBe(box);
    });

    it('after "change order", the find box is focused again', async () => {
        renderStation();
        await screen.findByLabelText('orders.pack.scanItems', { selector: 'input' });
        fireEvent.click(screen.getByRole('button', { name: 'orders.pack.changeOrder' }));
        const first = await screen.findByLabelText('orders.pack.scanPrompt', { selector: 'input' });
        await settle();
        expect(document.activeElement).toBe(first);
    });
});

describe('pack station: screen reader', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setRoles([COMMERCE_ROLE.WAREHOUSE_STAFF]);
        mocked.fetchOrder.mockResolvedValue(detail());
    });

    it("each line's tick box names its item", async () => {
        renderStation();
        await screen.findByText('Steel bottle');
        expect(screen.getByRole('checkbox', { name: 'orders.pack.allPackedFor:Cotton scarf' })).toBeTruthy();
        expect(screen.getByRole('checkbox', { name: 'orders.pack.allPackedFor:Steel bottle' })).toBeTruthy();
    });

    it('the same refusal twice is a new alert, so it is read out again', async () => {
        renderStation();
        await screen.findByText('Steel bottle');
        mocked.scanCode.mockResolvedValue(variantScan('ps-elsewhere'));
        scanInto('V-OTHER-1');
        const firstAlert = await screen.findByText('orders.pack.scan.notInOrder');
        scanInto('V-OTHER-2');
        await waitFor(() => expect(mocked.scanCode).toHaveBeenCalledTimes(2));
        await waitFor(() =>
            expect(screen.getByText('orders.pack.scan.notInOrder')).not.toBe(firstAlert)
        );
        expect(screen.getAllByText('orders.pack.scan.notInOrder')).toHaveLength(1);
        expect(screen.getByText('orders.pack.scan.notInOrder').closest('[role="alert"]')).toBeTruthy();
    });
});
