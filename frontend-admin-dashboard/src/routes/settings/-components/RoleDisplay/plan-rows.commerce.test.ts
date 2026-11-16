import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
    // Node's unconfigured Web Storage global shadows happy-dom's here.
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
            setItem: (k: string, v: string) => void store.set(k, String(v)),
            removeItem: (k: string) => void store.delete(k),
            clear: () => store.clear(),
        },
        configurable: true,
        writable: true,
    });
});

import { getSidebarItemsData } from '@/components/common/layout-container/sidebar/utils';
import { FULL_ENTITLEMENT } from '@/lib/capabilities/entitlement';
import { COMMERCE_FEATURE, resolveCommerceAccess } from '@/lib/commerce/commerce-access';
import { createPlanRowFilter, withCommerceRows } from './plan-rows';

const staticItems = getSidebarItemsData();
const roleTabs = staticItems.map((item) => ({ id: item.id }));
// A LEGACY institute: the plan filter shows every row.
const legacyRows = createPlanRowFilter(FULL_ENTITLEMENT, staticItems);

const rowsFor = (isFeatureOn: (key: string) => boolean) =>
    withCommerceRows(legacyRows, resolveCommerceAccess({ roles: ['ADMIN'], isFeatureOn }));

describe('Display Settings rows for commerce', () => {
    it('a LEGACY institute without the module is not offered the Commerce category or its tabs', () => {
        const rows = rowsFor(() => false);
        expect(rows.category('COMMERCE', roleTabs)).toBe(false);
        expect(rows.tab('commerce-pos')).toBe(false);
        expect(rows.tab('commerce-home')).toBe(false);
        // Everything else is exactly as the plan filter says.
        expect(rows.category('CRM', roleTabs)).toBe(true);
        expect(rows.category('LMS', roleTabs)).toBe(true);
        expect(rows.tab('courses')).toBe(true);
        expect(rows.tab('custom-123')).toBe(true);
    });

    it('with the module on, the category and the tabs of the features that are on', () => {
        const rows = rowsFor((key) => key !== COMMERCE_FEATURE.POS);
        expect(rows.category('COMMERCE', roleTabs)).toBe(true);
        expect(rows.tab('commerce-orders')).toBe(true);
        expect(rows.tab('commerce-pos')).toBe(false);
    });

    it('the rows follow the institute, not the viewer’s own commerce role', () => {
        const cashier = withCommerceRows(
            legacyRows,
            resolveCommerceAccess({ roles: ['COMMERCE_POS_CASHIER'], isFeatureOn: () => true })
        );
        expect(cashier.tab('commerce-products')).toBe(true);
    });
});
