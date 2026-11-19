/**
 * Contract §8.3, the Sell screen: a scanner burst + Enter adds the item; a
 * piece already on the bill is refused; the totals are the server's quote;
 * offline shows the banner and disables Pay; a cashier without the module
 * fires no request at all.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import type { CommerceAccessState } from '@/lib/commerce/use-commerce-access';

const state = vi.hoisted(() => ({ access: null as unknown }));

vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/services/capabilities', () => ({
    readCurrentInstituteIdSafely: () => 'inst-1',
    syncCapabilitiesOnce: () => Promise.resolve(),
}));
vi.mock('@/components/common/layout-container/route-access-guard', () => ({
    NotInPlanPage: () => <div data-testid="locked-page" />,
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: { amount?: string }) => (options?.amount ? `${key}:${options.amount}` : key),
        i18n: { language: 'en' },
    }),
}));
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
    useBlocker: () => undefined,
    useNavigate: () => () => undefined,
}));
vi.mock('../-shared/pos-api', () => ({
    fetchSession: vi.fn(),
    fetchCatalogue: vi.fn(),
    scanAtRegister: vi.fn(),
    quoteBill: vi.fn(),
    fetchPosSettings: vi.fn(),
    fetchApprovers: vi.fn(async () => []),
    lookupCustomer: vi.fn(),
    createSale: vi.fn(),
    createBillBookEntry: vi.fn(),
    lookupSales: vi.fn(),
    fetchSale: vi.fn(),
}));

import * as api from '../-shared/pos-api';
import { CommerceGate } from '@/routes/commerce/-components/CommercePage';
import { hose, item, piece, quote, scarf, session } from '../-shared/pos-test-fixtures';
import type { CartExchange } from '../-shared/pos-cart';
import { PosBillBookPage } from './PosBillBookPage';
import { PosSellPage } from './PosSellPage';

const mocked = vi.mocked(api);

const setRoles = (roles: string[], featureOn = true) => {
    state.access = {
        ...resolveCommerceAccess({ roles, isFeatureOn: () => featureOn }),
        isResolved: true,
    } satisfies CommerceAccessState;
};

const setOnline = (value: boolean): void => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
};

const renderSell = (exchange: CartExchange | null = null) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <CommerceGate navId="commerce-pos">
                <PosSellPage sessionId="sess-1" exchange={exchange} />
            </CommerceGate>
        </QueryClientProvider>
    );
};

const CREDIT: CartExchange = { returnId: 'r-1', number: 'RET-1', credit: 300 };
const creditBanner = () => screen.queryByText('pos.returns.credit:₹300.00');

/** A scanner: a fast burst of characters, then Enter. */
const scanInto = (code: string) => {
    const box = screen.getByTestId('pos-scan');
    for (let i = 1; i <= code.length; i += 1) fireEvent.change(box, { target: { value: code.slice(0, i) } });
    fireEvent.keyDown(box, { key: 'Enter' });
};

/** The catalogue answer has reached the screen (react-query notifies on a timer). */
const catalogueLoaded = async () => {
    await waitFor(() => expect(mocked.fetchCatalogue).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
};

describe('PosSellPage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setOnline(true);
        try {
            localStorage.clear();
            sessionStorage.clear();
        } catch {
            // no storage in this environment
        }
        mocked.fetchSession.mockResolvedValue(session());
        mocked.fetchCatalogue.mockResolvedValue({
            register_id: 'reg-1',
            location_id: 'loc-1',
            generated_at: null,
            truncated: false,
            items: [item(), scarf()],
        });
        mocked.fetchPosSettings.mockResolvedValue({
            cashier_discount_percent: 5,
            cash_refund_limit: 0,
            cash_variance_limit: 0,
            configured: false,
        });
        mocked.quoteBill.mockResolvedValue(quote(900, [{ ref: 'l1', net: 900 }]));
    });

    afterEach(() => setOnline(true));

    it('a scanner burst + Enter adds the item from the counter catalogue; totals are the server quote', async () => {
        setRoles([COMMERCE_ROLE.POS_CASHIER]);
        renderSell();
        await waitFor(() => expect(mocked.fetchCatalogue).toHaveBeenCalledWith('reg-1'));
        await screen.findByTestId('pos-scan');
        await catalogueLoaded();
        scanInto('V-BOTTLE');
        expect(await screen.findByTestId('pos-line-l1')).toBeTruthy();
        expect(mocked.scanAtRegister).not.toHaveBeenCalled();
        scanInto('8900000000017');
        await waitFor(() => expect(screen.getByTestId('pos-qty-l1').textContent).toBe('2'));

        await waitFor(() => expect(mocked.quoteBill).toHaveBeenCalled(), { timeout: 2000 });
        const sent = mocked.quoteBill.mock.calls.at(-1)?.[0];
        expect(sent?.session_id).toBe('sess-1');
        expect(sent?.lines).toEqual([{ line_ref: 'l1', variant_id: 'ps-bottle', quantity: 2, unit_price: '450.00' }]);
        await waitFor(() => expect(screen.getByTestId('pos-total').textContent).toBe('₹900.00'));
        expect(screen.getByTestId('pos-pay').textContent).toContain('₹900.00');
    });

    it('a piece label goes to the server; the same piece again is refused', async () => {
        setRoles([COMMERCE_ROLE.POS_CASHIER]);
        mocked.scanAtRegister.mockResolvedValue({ kind: 'PIECE', item: scarf(), piece: piece('P0001') });
        renderSell();
        await screen.findByTestId('pos-scan');
        await catalogueLoaded();
        scanInto('P0001');
        expect(await screen.findByTestId('pos-line-l1')).toBeTruthy();
        expect(mocked.scanAtRegister).toHaveBeenCalledWith('reg-1', 'P0001');
        // Typed again (another spelling, so the scanner-bounce guard does not drop it).
        scanInto('p0001');
        await waitFor(() => expect(screen.getByTestId('pos-scan-message').textContent).toBe('pos.cart.alreadyOnBill'));
        expect(screen.queryByTestId('pos-line-l2')).toBeNull();
    });

    it('a scanned length closed without a length leaves the bill; a typed one stays (WP-44 FA5)', async () => {
        setRoles([COMMERCE_ROLE.POS_CASHIER]);
        mocked.fetchCatalogue.mockResolvedValue({
            register_id: 'reg-1',
            location_id: 'loc-1',
            generated_at: null,
            truncated: false,
            items: [item(), hose()],
        });
        renderSell();
        await screen.findByTestId('pos-scan');
        await catalogueLoaded();
        scanInto('V-HOSE');
        expect(await screen.findByTestId('pos-line-l1')).toBeTruthy();
        const cancel = await screen.findAllByRole('button', { name: 'common.cancel' });
        fireEvent.click(cancel[cancel.length - 1] as HTMLElement);
        await waitFor(() => expect(screen.queryByTestId('pos-line-l1')).toBeNull());

        scanInto('v-hose');
        expect(await screen.findByTestId('pos-line-l2')).toBeTruthy();
        const length = await screen.findByTestId('pos-length-total');
        const input = length.closest('[role="dialog"]')?.querySelector('input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '2.5' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(screen.queryByTestId('pos-length-total')).toBeNull());
        expect(screen.getByTestId('pos-line-l2')).toBeTruthy();
    });

    it('offline: the banner shows and Pay is disabled', async () => {
        setRoles([COMMERCE_ROLE.POS_CASHIER]);
        setOnline(false);
        renderSell();
        expect(await screen.findByTestId('pos-offline')).toBeTruthy();
        await screen.findByTestId('pos-scan');
        await catalogueLoaded();
        scanInto('V-BOTTLE');
        expect(await screen.findByTestId('pos-line-l1')).toBeTruthy();
        expect((screen.getByTestId('pos-pay') as HTMLButtonElement).disabled).toBe(true);
    });

    it('an exchange credit survives a reload of the till (kept per session in this tab)', async () => {
        setRoles([COMMERCE_ROLE.POS_CASHIER]);
        const first = renderSell(CREDIT);
        await screen.findByTestId('pos-scan');
        expect(creditBanner()).toBeTruthy();
        first.unmount();
        // The address no longer carries it: it comes back from the session store.
        renderSell(null);
        await screen.findByTestId('pos-scan');
        await waitFor(() => expect(creditBanner()).toBeTruthy());
        expect(screen.queryByTestId('pos-add-credit')).toBeNull();
    });

    it('Clear bill empties the lines but keeps the exchange credit; removing it asks first', async () => {
        setRoles([COMMERCE_ROLE.POS_CASHIER]);
        renderSell(CREDIT);
        await screen.findByTestId('pos-scan');
        await catalogueLoaded();
        scanInto('V-BOTTLE');
        expect(await screen.findByTestId('pos-line-l1')).toBeTruthy();
        fireEvent.click(screen.getByText('pos.sell.clear'));
        const confirms = await screen.findAllByText('pos.sell.clear');
        fireEvent.click(confirms[confirms.length - 1] as HTMLElement);
        await waitFor(() => expect(screen.queryByTestId('pos-line-l1')).toBeNull());
        expect(creditBanner()).toBeTruthy();
        expect(sessionStorage.getItem('commerce.pos.exchange.inst-1.sess-1')).toContain('r-1');

        fireEvent.click(screen.getByLabelText('pos.sell.removeExchange'));
        expect(creditBanner()).toBeTruthy(); // not gone until confirmed
        fireEvent.click(await screen.findByTestId('pos-remove-credit-confirm'));
        await waitFor(() => expect(creditBanner()).toBeNull());
        expect(sessionStorage.getItem('commerce.pos.exchange.inst-1.sess-1')).toBeNull();
        expect(screen.getByTestId('pos-add-credit')).toBeTruthy();
    });

    it('a credit the quote does not name needs a manager PIN; the amount found with the return counts meanwhile', async () => {
        setRoles([COMMERCE_ROLE.POS_CASHIER]);
        mocked.quoteBill.mockResolvedValue({ ...quote(900, [{ ref: 'l1', net: 900 }]), exchange_credit: null });
        renderSell(CREDIT);
        await screen.findByTestId('pos-scan');
        await catalogueLoaded();
        scanInto('V-BOTTLE');
        expect(await screen.findByTestId('pos-credit-needs-pin', {}, { timeout: 2000 })).toBeTruthy();
        expect(mocked.quoteBill.mock.calls.at(-1)?.[0]?.exchange).toEqual({ return_id: 'r-1' });
        await waitFor(() => expect(screen.getByTestId('pos-pay').textContent).toContain('₹600.00'));
    });

    it('after a reload, a payment whose answer never came is flagged with a way to the bills', async () => {
        setRoles([COMMERCE_ROLE.POS_CASHIER]);
        sessionStorage.setItem(
            'commerce.pos.attempt.inst-1.sess-1.sale',
            JSON.stringify({ id: 'pos-x-abcdefabcdef', body: '{}', uncertain: true })
        );
        renderSell();
        expect(await screen.findByTestId('pos-maybe-saved')).toBeTruthy();
        expect(screen.getByText('pos.sell.checkBills')).toBeTruthy();
    });

    it('a cashier of an institute without the module fires no request', async () => {
        setRoles([COMMERCE_ROLE.POS_CASHIER], false);
        renderSell();
        expect(await screen.findByTestId('locked-page')).toBeTruthy();
        await new Promise((r) => setTimeout(r, 50));
        expect(mocked.fetchSession).not.toHaveBeenCalled();
        expect(mocked.fetchCatalogue).not.toHaveBeenCalled();
        expect(mocked.quoteBill).not.toHaveBeenCalled();
    });

    it('a warehouse login gets no access and fires no request', async () => {
        setRoles([COMMERCE_ROLE.WAREHOUSE_STAFF]);
        renderSell();
        expect(await screen.findByText('noAccess.title')).toBeTruthy();
        expect(mocked.fetchSession).not.toHaveBeenCalled();
    });
});

describe('PosSellPage: measured goods fix round (WP-44 W6, W8)', () => {
    const lengthBox = async () => {
        const total = await screen.findByTestId('pos-length-total');
        return total.closest('[role="dialog"]')?.querySelector('input') as HTMLInputElement;
    };
    /** A scanner typing into whatever has the focus: keys a few ms apart, then Enter. */
    const burstInto = (input: HTMLInputElement, code: string) =>
        [...code.split(''), 'Enter'].forEach((key) => fireEvent.keyDown(input, { key }));

    beforeEach(() => {
        vi.clearAllMocks();
        setOnline(true);
        try {
            localStorage.clear();
            sessionStorage.clear();
        } catch {
            // no storage in this environment
        }
        setRoles([COMMERCE_ROLE.POS_CASHIER]);
        mocked.fetchSession.mockResolvedValue(session());
        mocked.fetchCatalogue.mockResolvedValue({
            register_id: 'reg-1',
            location_id: 'loc-1',
            generated_at: null,
            truncated: false,
            items: [item(), hose(), hose({ variant_id: 'ps-hose-2', sku: 'HSE-2', label_code: 'V-HOSE2' })],
        });
        mocked.fetchPosSettings.mockResolvedValue({
            cashier_discount_percent: 5,
            cash_refund_limit: 0,
            cash_variance_limit: 0,
            configured: false,
        });
        mocked.quoteBill.mockResolvedValue(quote(900, [{ ref: 'l1', net: 900 }]));
    });

    it('W6: a label scanned into an open length box adds that item; the roll keeps its box', async () => {
        renderSell();
        await screen.findByTestId('pos-scan');
        await catalogueLoaded();
        scanInto('V-HOSE');
        const input = await lengthBox();
        expect(input.value).toBe('0.5');
        burstInto(input, 'V-BOTTLE');
        expect(await screen.findByTestId('pos-line-l2')).toBeTruthy();
        expect(screen.getByTestId('pos-line-l1')).toBeTruthy();
        // Not read as a length: the box is still open on the roll with its own text.
        expect((await lengthBox()).value).toBe('0.5');
    });

    it('W6: another roll scanned while a new roll waits for its first length takes the box; the first leaves', async () => {
        renderSell();
        await screen.findByTestId('pos-scan');
        await catalogueLoaded();
        scanInto('V-HOSE');
        burstInto(await lengthBox(), 'V-HOSE2');
        expect(await screen.findByTestId('pos-line-l2')).toBeTruthy();
        await waitFor(() => expect(screen.queryByTestId('pos-line-l1')).toBeNull());
        expect(await lengthBox()).toBeTruthy();
    });

    it('W8: a paper bill takes 2.3 m of a roll sold in 0.5 m steps (recorded as written)', async () => {
        mocked.quoteBill.mockResolvedValue({
            ...quote(460, [{ ref: 'l1', net: 460 }]),
            unavailable: [{ line_ref: 'l1', reason: 'QUANTITY_STEP' }],
        });
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={client}>
                <CommerceGate navId="commerce-pos">
                    <PosBillBookPage sessionId="sess-1" />
                </CommerceGate>
            </QueryClientProvider>
        );
        await screen.findByTestId('pos-scan');
        await catalogueLoaded();
        scanInto('V-HOSE');
        const input = await lengthBox();
        fireEvent.change(input, { target: { value: '2.3' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(screen.queryByTestId('pos-length-total')).toBeNull());
        await waitFor(() => expect(mocked.quoteBill.mock.calls.at(-1)?.[0].lines[0]?.quantity).toBe(23), { timeout: 2000 });
        await new Promise((r) => setTimeout(r, 50));
        expect(screen.queryByText('pos.errors.QUANTITY_STEP')).toBeNull();
    });
});
