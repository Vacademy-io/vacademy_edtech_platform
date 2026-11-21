/**
 * Notifications settings gating: without the Commerce module the locked page and
 * no request; warehouse staff get "no access"; a manager sees the shop card and
 * the nine triggers in the server's order.
 */
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import type { CommerceAccessState } from '@/lib/commerce/use-commerce-access';

const state = vi.hoisted(() => ({ access: null as unknown }));
const api = vi.hoisted(() => ({ fetchNotificationSettings: vi.fn() }));

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
vi.mock('./notifications-api', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchNotificationSettings: api.fetchNotificationSettings,
}));

import { normalizeSettings } from './notifications-api';
import { NOTIFICATION_TRIGGERS } from './notifications-logic';
import { NotificationsPage } from './NotificationsPage';

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
            <NotificationsPage />
        </QueryClientProvider>
    );

describe('NotificationsPage', () => {
    beforeEach(() => {
        api.fetchNotificationSettings.mockReset();
        api.fetchNotificationSettings.mockResolvedValue(
            normalizeSettings({
                shop: {
                    link_base_url: null,
                    link_base_candidates: ['https://shop.example'],
                    link_days: 7,
                    shop_name: {},
                    shop_name_default: 'The shop',
                    link_secret_configured: false,
                    sending_enabled: false,
                },
                triggers: NOTIFICATION_TRIGGERS.map((trigger, index) => ({
                    trigger,
                    enabled: true,
                    email_enabled: true,
                    whatsapp_enabled: index % 2 === 0,
                    version: 0,
                    variables: ['order_number'],
                    whatsapp: { template_name: 'x', default_template_name: 'x', status: { hi: 'APPROVED', en: 'MISSING' } },
                    email: { subject: {}, body: {}, overridden: {} },
                })),
            })
        );
    });

    it('module off: the locked page and no request', async () => {
        setAccess(['ADMIN'], false);
        renderPage();
        expect(screen.getByTestId('locked-page')).toBeTruthy();
        await wait();
        expect(api.fetchNotificationSettings).not.toHaveBeenCalled();
    });

    it('warehouse staff: no access and no request', async () => {
        setAccess([COMMERCE_ROLE.WAREHOUSE_STAFF]);
        renderPage();
        expect(screen.getByText('noAccess.title')).toBeTruthy();
        await wait();
        expect(api.fetchNotificationSettings).not.toHaveBeenCalled();
    });

    it('manager: banners, shop card and the nine triggers in order', async () => {
        setAccess([COMMERCE_ROLE.STORE_MANAGER]);
        const { container } = renderPage();
        expect(await screen.findByText('notifications.shop.title')).toBeTruthy();
        expect(screen.getByText('notifications.banners.sendingOff')).toBeTruthy();
        expect(screen.getByText('notifications.banners.linksOff')).toBeTruthy();
        const order = Array.from(container.querySelectorAll('[data-trigger]')).map((el) =>
            el.getAttribute('data-trigger')
        );
        expect(order).toEqual([...NOTIFICATION_TRIGGERS]);
        expect(screen.getAllByText('notifications.test')).toHaveLength(9);
        expect(screen.getByText('notifications.templates.request')).toBeTruthy();
    });
});
