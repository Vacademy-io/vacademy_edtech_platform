/**
 * POS review follow-ups (MINOR 4 / S7): the registers page reads the locations
 * only for a manager of an institute with the counter module on; with the
 * module off it fires no request (contract §7.1).
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import type { CommerceAccessState } from '@/lib/commerce/use-commerce-access';

const state = vi.hoisted(() => ({ access: null as unknown }));
const hooks = vi.hoisted(() => ({ useLocations: vi.fn(() => ({ data: [] })) }));

vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/services/capabilities', () => ({
    readCurrentInstituteIdSafely: () => 'inst-1',
    syncCapabilitiesOnce: () => Promise.resolve(),
}));
vi.mock('@/components/design-system/table', () => ({ MyTable: () => null }));
vi.mock('@/constants/helper', () => ({ getInstituteId: () => 'inst-1' }));
vi.mock('@/components/common/layout-container/route-access-guard', () => ({
    NotInPlanPage: () => <div data-testid="locked-page" />,
}));
vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@tanstack/react-router', () => ({
    Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
    useNavigate: () => vi.fn(),
}));
vi.mock('@/routes/commerce/-shared/commerce-hooks', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useLocations: hooks.useLocations,
}));
vi.mock('@/routes/commerce/pos/-shared/pos-api', () => ({
    fetchRegisters: vi.fn(async () => []),
    fetchDocumentSeries: vi.fn(async () => []),
    fetchPosSettings: vi.fn(async () => null),
}));
vi.mock('./BillBooksCard', () => ({ BillBooksCard: () => null }));
vi.mock('./PosLimitsCard', () => ({ PosLimitsCard: () => null }));
vi.mock('./RegisterDialog', () => ({ RegisterDialog: () => null }));

import { RegistersPage } from './RegistersPage';

const setAccess = (roles: string[], featureOn: boolean) => {
    state.access = {
        ...resolveCommerceAccess({ roles, isFeatureOn: () => featureOn }),
        isResolved: true,
    } satisfies CommerceAccessState;
};

const renderPage = () =>
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <RegistersPage />
        </QueryClientProvider>
    );

describe('RegistersPage', () => {
    it('with the counter module off, the locations read is never enabled', () => {
        setAccess([COMMERCE_ROLE.STORE_MANAGER], false);
        renderPage();
        expect(screen.getByTestId('locked-page')).toBeTruthy();
        expect(hooks.useLocations).toHaveBeenCalled();
        expect(hooks.useLocations.mock.calls.every((call) => (call as unknown[])[0] === false)).toBe(true);
    });

    it('a store manager with the module on reads them', () => {
        hooks.useLocations.mockClear();
        setAccess([COMMERCE_ROLE.STORE_MANAGER], true);
        renderPage();
        expect(hooks.useLocations.mock.calls.some((call) => (call as unknown[])[0] === true)).toBe(true);
    });
});
