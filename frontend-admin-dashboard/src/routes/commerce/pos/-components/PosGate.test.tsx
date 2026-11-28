/** POS review follow-ups (MINOR 10): a refused person gets the admin frame (a way out), the till stays full screen. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { COMMERCE_ROLE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';

const state = vi.hoisted(() => ({ access: null as unknown }));
vi.mock('@/lib/commerce/use-commerce-access', () => ({ useCommerceAccess: () => state.access }));
vi.mock('@/components/common/layout-container/layout-container', () => ({
    LayoutContainer: ({ children }: { children: ReactNode }) => <div data-testid="admin-frame">{children}</div>,
}));
vi.mock('@/services/capabilities', () => ({
    readCurrentInstituteIdSafely: () => 'inst-1',
    syncCapabilitiesOnce: () => Promise.resolve(),
}));
vi.mock('@/components/common/layout-container/route-access-guard', () => ({
    NotInPlanPage: () => <div data-testid="locked-page" />,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));

import { PosGate } from './PosGate';

const setRoles = (roles: string[]) => {
    state.access = { ...resolveCommerceAccess({ roles, isFeatureOn: () => true }), isResolved: true };
};

describe('PosGate', () => {
    it('a login without a counter role sees the refusal inside the admin frame', () => {
        setRoles([COMMERCE_ROLE.WAREHOUSE_STAFF]);
        render(<PosGate><p>till</p></PosGate>);
        expect(screen.getByTestId('admin-frame')).toBeTruthy();
        expect(screen.queryByText('till')).toBeNull();
    });

    it('a cashier gets the full-screen till', () => {
        setRoles([COMMERCE_ROLE.POS_CASHIER]);
        render(<PosGate><p>till</p></PosGate>);
        expect(screen.queryByTestId('admin-frame')).toBeNull();
        expect(screen.getByText('till')).toBeTruthy();
    });
});
