/**
 * Acceptance at the screen level: a commerce route without its feature
 * shows the locked page, a role that does not see the screen gets "no access",
 * and the content is rendered only when both gates are open.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    COMMERCE_FEATURE,
    COMMERCE_ROLE,
    resolveCommerceAccess,
} from '@/lib/commerce/commerce-access';
import type { CommerceAccessState } from '@/lib/commerce/use-commerce-access';

const state = vi.hoisted(() => ({ access: null as unknown, synced: 0 }));

vi.mock('@/lib/commerce/use-commerce-access', () => ({
    useCommerceAccess: () => state.access,
}));
vi.mock('@/services/capabilities', () => ({
    readCurrentInstituteIdSafely: () => 'inst-1',
    syncCapabilitiesOnce: () => {
        state.synced += 1;
        return Promise.resolve();
    },
}));
vi.mock('@/components/common/layout-container/route-access-guard', () => ({
    NotInPlanPage: () => <div data-testid="locked-page" />,
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}));

import { CommerceGate } from './CommercePage';

const setAccess = (
    roles: string[],
    isFeatureOn: (key: string) => boolean,
    isResolved = true
): void => {
    state.access = {
        ...resolveCommerceAccess({ roles, isFeatureOn }),
        isResolved,
    } satisfies CommerceAccessState;
};

const allOn = () => true;
const allOff = () => false;

const renderGate = (
    navId: Parameters<typeof CommerceGate>[0]['navId'],
    anyFeature?: Parameters<typeof CommerceGate>[0]['anyFeature']
) =>
    render(
        <CommerceGate navId={navId} anyFeature={anyFeature}>
            <div data-testid="content" />
        </CommerceGate>
    );

describe('CommerceGate', () => {
    beforeEach(() => {
        state.synced = 0;
    });

    it('module off: the locked page, for an institute ADMIN too', () => {
        setAccess(['ADMIN'], allOff);
        renderGate('commerce-home');
        expect(screen.getByTestId('locked-page')).toBeTruthy();
        expect(screen.queryByTestId('content')).toBeNull();
    });

    it('the route’s own feature off: the locked page', () => {
        setAccess(['ADMIN'], (key) => key !== COMMERCE_FEATURE.POS);
        renderGate('commerce-pos');
        expect(screen.getByTestId('locked-page')).toBeTruthy();
    });

    it('a Settings page whose endpoints need another feature: the locked page', () => {
        setAccess(['ADMIN'], (key) => key === COMMERCE_FEATURE.POS);
        renderGate('commerce-settings', [COMMERCE_FEATURE.STOCK]);
        expect(screen.getByTestId('locked-page')).toBeTruthy();
        expect(screen.queryByTestId('content')).toBeNull();
    });

    it('feature on, wrong role: "no access", not the locked page', () => {
        setAccess([COMMERCE_ROLE.POS_CASHIER], allOn);
        renderGate('commerce-products');
        expect(screen.queryByTestId('locked-page')).toBeNull();
        expect(screen.queryByTestId('content')).toBeNull();
        expect(screen.getByText('noAccess.title')).toBeTruthy();
    });

    it('feature on and a role that sees it: the content', () => {
        setAccess([COMMERCE_ROLE.POS_CASHIER], allOn);
        renderGate('commerce-pos');
        expect(screen.getByTestId('content')).toBeTruthy();
        expect(screen.queryByTestId('locked-page')).toBeNull();
    });

    it('while capabilities are loading: neither the content nor the locked page', () => {
        setAccess(['ADMIN'], allOff, false);
        renderGate('commerce-home');
        expect(screen.queryByTestId('locked-page')).toBeNull();
        expect(screen.queryByTestId('content')).toBeNull();
        expect(state.synced).toBe(1);
    });
});
