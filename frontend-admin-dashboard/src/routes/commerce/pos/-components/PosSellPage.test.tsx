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
}));

import * as api from '../-shared/pos-api';
import { CommerceGate } from '@/routes/commerce/-components/CommercePage';
import { item, piece, quote, scarf, session } from '../-shared/pos-test-fixtures';
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

const renderSell = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <CommerceGate navId="commerce-pos">
                <PosSellPage sessionId="sess-1" />
            </CommerceGate>
        </QueryClientProvider>
    );
};

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
