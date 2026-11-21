/**
 * Customers screen gating: without the Commerce module the locked page and no
 * request; warehouse staff get "no access"; a manager sees the rows; a server
 * without the customers API shows "coming soon".
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import type { CommerceAccessState } from '@/lib/commerce/use-commerce-access';

const state = vi.hoisted(() => ({ access: null as unknown }));
const api = vi.hoisted(() => ({ fetchCustomers: vi.fn() }));

vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/services/capabilities', () => ({
    readCurrentInstituteIdSafely: () => 'inst-1',
    syncCapabilitiesOnce: () => Promise.resolve(),
}));
// MyTable pulls in legacy learner dialogs that need a router; the phone cards render the same rows.
vi.mock('@/components/design-system/table', () => ({ MyTable: () => null }));
vi.mock('@/lib/save-blob', () => ({ saveBlob: vi.fn() }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/components/common/layout-container/route-access-guard', () => ({
    NotInPlanPage: () => <div data-testid='locked-page' />,
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
vi.mock('@/routes/commerce/customers/-shared/customer-api', () => ({
    fetchCustomers: api.fetchCustomers,
    fetchCustomer: vi.fn(),
}));

import { CustomersPage } from './CustomersPage';

const setAccess = (roles: string[], featureOn = true) => {
    state.access = {
        ...resolveCommerceAccess({ roles, isFeatureOn: () => featureOn }),
        isResolved: true,
    } satisfies CommerceAccessState;
};

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wait = () => new Promise((resolve) => setTimeout(resolve, 20));

const renderPage = () =>
    render(
        <QueryClientProvider client={client()}>
            <CustomersPage search={{}} onSearchChange={() => undefined} />
        </QueryClientProvider>
    );

const missing = new AxiosError('missing', 'ERR', undefined, undefined, {
    status: 404,
    data: {},
    headers: {},
    statusText: '',
    config: {} as never,
} as never);

describe('CustomersPage', () => {
    beforeEach(() => {
        api.fetchCustomers.mockReset();
        api.fetchCustomers.mockResolvedValue({
            customers: [
                {
                    id: 'c-1',
                    name: 'Test Customer',
                    phone: '+919000000001',
                    email: null,
                    orders_count: 3,
                    total_spent: 1300,
                    dues: 500,
                    last_order_at: '2026-11-10T10:00:00Z',
                    cod_refusals: 0,
                    marketing_consent: true,
                    anonymised: false,
                    created_at: null,
                },
            ],
            page: 0,
            page_size: 50,
            total: 1,
        });
    });

    it('module off: the locked page and no request', async () => {
        setAccess(['ADMIN'], false);
        renderPage();
        expect(screen.getByTestId('locked-page')).toBeTruthy();
        await wait();
        expect(api.fetchCustomers).not.toHaveBeenCalled();
    });

    it('warehouse staff: no access and no request', async () => {
        setAccess([COMMERCE_ROLE.WAREHOUSE_STAFF]);
        renderPage();
        expect(screen.getByText('noAccess.title')).toBeTruthy();
        await wait();
        expect(api.fetchCustomers).not.toHaveBeenCalled();
    });

    it('manager: the rows', async () => {
        setAccess([COMMERCE_ROLE.STORE_MANAGER]);
        renderPage();
        expect(await screen.findByTestId('customer-card')).toBeTruthy();
        expect(screen.getAllByText('Test Customer').length).toBeGreaterThan(0);
        expect(api.fetchCustomers).toHaveBeenCalledWith(expect.objectContaining({ page: 0, pageSize: 50 }));
    });

    it('accountant: allowed too', async () => {
        setAccess([COMMERCE_ROLE.ACCOUNTANT]);
        renderPage();
        expect(await screen.findByTestId('customer-card')).toBeTruthy();
    });

    it('no customers API on the server: coming soon, not an error', async () => {
        setAccess([COMMERCE_ROLE.STORE_MANAGER]);
        api.fetchCustomers.mockRejectedValue(missing);
        renderPage();
        expect(await screen.findByText('customers.notAvailable')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });
});
