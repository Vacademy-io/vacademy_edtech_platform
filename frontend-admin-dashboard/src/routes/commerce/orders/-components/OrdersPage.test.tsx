/**
 * F7: the order desk's role gating. Tabs, header buttons and bulk actions
 * follow the role; without the Commerce module the locked page shows and no
 * request is fired; tab counts come from each queue's `total`.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import type { CommerceAccessState } from '@/lib/commerce/use-commerce-access';

const state = vi.hoisted(() => ({ access: null as unknown }));
const api = vi.hoisted(() => ({ fetchOrders: vi.fn() }));

vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/services/capabilities', () => ({
    readCurrentInstituteIdSafely: () => 'inst-1',
    syncCapabilitiesOnce: () => Promise.resolve(),
}));
// MyTable pulls in legacy learner dialogs that need a router; the phone list renders the same rows.
vi.mock('@/components/design-system/table', () => ({ MyTable: () => null }));
// The sandbox's node_modules lacks the native file plugins save-blob imports.
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/components/common/layout-container/route-access-guard', () => ({
    NotInPlanPage: () => <div data-testid="locked-page" />,
}));
vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children, className }: { children: ReactNode; className?: string }) => (
        <a className={className}>{children}</a>
    ),
    useNavigate: () => vi.fn(),
}));
vi.mock('@/routes/commerce/orders/-shared/order-api', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchOrders: api.fetchOrders,
}));

import { OrdersPage } from './OrdersPage';

const row = (id: string, status = 'CONFIRMED') => ({
    id,
    order_number: `SO-${id}`,
    channel: 'ONLINE',
    status,
    payment_status: 'PAID',
    payment_method: 'PREPAID',
    cancel_reason: null,
    customer_name: 'Test Customer',
    customer_phone: '9000000001',
    currency: 'INR',
    total: 500,
    amount_paid: 500,
    created_at: '2026-11-10T10:00:00Z',
    stock_short: false,
    refund_due: null,
    shipment_status: null,
    tracking_number: null,
    status_since: '2026-11-10T10:00:00Z',
    refund_open: null,
    refund_state: null,
    return_state: null,
});

const setAccess = (roles: string[], featureOn = true) => {
    state.access = {
        ...resolveCommerceAccess({ roles, isFeatureOn: () => featureOn }),
        isResolved: true,
    } satisfies CommerceAccessState;
};

const renderDesk = (search: Record<string, string> = {}) =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <OrdersPage search={search} onSearchChange={() => undefined} />
        </QueryClientProvider>
    );

const tabs = () => screen.queryAllByRole('tab').map((tab) => tab.getAttribute('data-queue'));

describe('OrdersPage role gating', () => {
    beforeEach(() => {
        api.fetchOrders.mockReset();
        api.fetchOrders.mockImplementation(async (params: Record<string, unknown>) =>
            params.pageSize === 1
                ? { orders: [], page: 0, page_size: 1, total: params.queue === 'TO_PACK' ? 7 : 2 }
                : { orders: [row('1'), row('2')], page: 0, page_size: 50, total: 2 }
        );
    });

    it('warehouse: no COD or Dues tabs and no New order, but the pack station', async () => {
        setAccess([COMMERCE_ROLE.WAREHOUSE_STAFF]);
        renderDesk();
        await screen.findAllByText('SO-1');
        expect(tabs()).not.toContain('COD_TO_COLLECT');
        expect(tabs()).not.toContain('DUES');
        expect(tabs()).toContain('TO_PACK');
        expect(screen.queryByText('orders.newOrder')).toBeNull();
        expect(screen.getByText('orders.packStation')).toBeTruthy();
    });

    it('accountant: no pack station link and no bulk Mark packed', async () => {
        setAccess([COMMERCE_ROLE.ACCOUNTANT]);
        renderDesk({ queue: 'ALL' });
        await screen.findAllByText('SO-1');
        expect(tabs()).toEqual(['COD_TO_COLLECT', 'DUES', 'REFUND_DUE', 'ALL']);
        expect(screen.queryByText('orders.packStation')).toBeNull();
        expect(screen.queryByText('orders.newOrder')).toBeNull();
        const ticks = screen.getAllByLabelText('orders.list.select');
        fireEvent.click(ticks[0]!);
        await screen.findByText('orders.bulk.export');
        expect(screen.queryByText('orders.bulk.markPacked')).toBeNull();
        expect(screen.queryByText('orders.bulk.printSlips')).toBeNull();
    });

    it('manager: New order, every tab and the To pack bulk actions', async () => {
        setAccess([COMMERCE_ROLE.STORE_MANAGER]);
        renderDesk();
        await screen.findAllByText('SO-1');
        expect(screen.getByText('orders.newOrder')).toBeTruthy();
        expect(tabs()).toHaveLength(11);
        fireEvent.click(screen.getAllByLabelText('orders.list.select')[0]!);
        await screen.findByText('orders.bulk.markPacked');
    });

    it('counts come from each queue total', async () => {
        setAccess([COMMERCE_ROLE.STORE_MANAGER]);
        renderDesk();
        await waitFor(() => expect(screen.getByTestId('queue-count-TO_PACK').textContent).toBe('7'));
        expect(screen.getByTestId('queue-count-DUES').textContent).toBe('2');
        expect(screen.queryByTestId('queue-count-ALL')).toBeNull();
        expect(api.fetchOrders).toHaveBeenCalledWith(expect.objectContaining({ queue: 'TO_PACK', pageSize: 1 }));
    });

    it('module off: the locked page and no request', async () => {
        setAccess(['ADMIN'], false);
        renderDesk();
        expect(screen.getByTestId('locked-page')).toBeTruthy();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(api.fetchOrders).not.toHaveBeenCalled();
        expect(screen.queryByText('orders.newOrder')).toBeNull();
    });
});

describe('OrdersPage queue tabs keyboard', () => {
    beforeEach(() => {
        api.fetchOrders.mockReset();
        api.fetchOrders.mockResolvedValue({ orders: [row('1')], page: 0, page_size: 50, total: 1 });
    });

    it('Tab reaches the selected tab only; arrows, Home and End move between tabs without opening one', async () => {
        setAccess([COMMERCE_ROLE.ACCOUNTANT]);
        const onSearchChange = vi.fn();
        render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <OrdersPage search={{ queue: 'DUES' }} onSearchChange={onSearchChange} />
            </QueryClientProvider>
        );
        await screen.findAllByText('SO-1');
        const all = screen.getAllByRole('tab');
        const byQueue = (queue: string) => all.find((tab) => tab.getAttribute('data-queue') === queue)!;
        expect(all.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1, -1]);

        const panel = screen.getByRole('tabpanel');
        expect(panel.getAttribute('aria-labelledby')).toBe(byQueue('DUES').id);
        all.forEach((tab) => expect(tab.getAttribute('aria-controls')).toBe(panel.id));

        byQueue('DUES').focus();
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(byQueue('REFUND_DUE'));
        fireEvent.keyDown(document.activeElement!, { key: 'End' });
        expect(document.activeElement).toBe(byQueue('ALL'));
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
        expect(document.activeElement).toBe(byQueue('COD_TO_COLLECT'));
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
        expect(document.activeElement).toBe(byQueue('ALL'));
        fireEvent.keyDown(document.activeElement!, { key: 'Home' });
        expect(document.activeElement).toBe(byQueue('COD_TO_COLLECT'));
        // Moving never opens a queue (each opening loads a list); a click does.
        expect(onSearchChange).not.toHaveBeenCalled();
        fireEvent.click(byQueue('COD_TO_COLLECT'));
        expect(onSearchChange).toHaveBeenCalled();
    });
});
