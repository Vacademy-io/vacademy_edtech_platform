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
import { resolveCan } from '@/services/capabilities';
import {
    COMMERCE_FEATURE,
    COMMERCE_FEATURE_KEYS,
    COMMERCE_NAV,
    COMMERCE_ROLE,
    type CommerceNavId,
    commerceStaffLandingRoute,
    filterAssignableRoles,
    filterCommerceSidebar,
    resolveCommerceAccess,
} from './commerce-access';

const staticItems = getSidebarItemsData();
const commerceItems = staticItems.filter((item) => item.category === 'COMMERCE');

const allOn = () => true;
const allOff = () => false;
const onExcept =
    (...off: string[]) =>
    (key: string) =>
        !off.includes(key);
const onlyOn =
    (...on: string[]) =>
    (key: string) =>
        on.includes(key);

const access = (roles: string[], isFeatureOn: (key: string) => boolean = allOn) =>
    resolveCommerceAccess({ roles, isFeatureOn });

const visibleCommerceIds = (roles: string[], isFeatureOn: (key: string) => boolean = allOn) =>
    filterCommerceSidebar(staticItems, access(roles, isFeatureOn))
        .filter((item) => item.category === 'COMMERCE')
        .map((item) => item.id);

const ALL_IDS = COMMERCE_NAV.map((rule) => rule.id);

describe('the sidebar and the access table describe the same eleven tabs', () => {
    it('every COMMERCE sidebar entry is a COMMERCE_NAV rule with the same route, in order', () => {
        expect(commerceItems.map((item) => [item.id, item.to])).toEqual(
            COMMERCE_NAV.map((rule) => [rule.id, rule.route])
        );
        expect(commerceItems).toHaveLength(11);
    });

    it('commerce tabs carry no sub-items and no adminOnly gate (the gate is the role)', () => {
        commerceItems.forEach((item) => expect(item.subItems).toBeUndefined());
    });

    it('every tab is filed under the Commerce rail and has a title', () => {
        // The names themselves (Hindi and English) are checked against the locale
        // files in routes/commerce/-shared/commerce-locales.test.ts.
        COMMERCE_NAV.forEach((rule) => {
            const item = staticItems.find((i) => i.id === rule.id);
            expect(item?.category).toBe('COMMERCE');
            expect(item?.title).toBeTruthy();
        });
    });
});

describe('feature gate: off until granted, in every mode', () => {
    it('module off: no commerce tab for anyone, an institute ADMIN included', () => {
        [
            ['ADMIN'],
            [COMMERCE_ROLE.STORE_MANAGER],
            [COMMERCE_ROLE.POS_CASHIER],
            ['TEACHER'],
        ].forEach((roles) => expect(visibleCommerceIds(roles, allOff)).toEqual([]));
    });

    it('module off: the rest of the sidebar is returned untouched', () => {
        const withoutCommerce = staticItems.filter((item) => item.category !== 'COMMERCE');
        expect(filterCommerceSidebar(withoutCommerce, access(['ADMIN'], allOff))).toBe(
            withoutCommerce
        );
        expect(
            filterCommerceSidebar(staticItems, access(['TEACHER'], allOff)).map((i) => i.id)
        ).toEqual(withoutCommerce.map((i) => i.id));
    });

    it('a LEGACY institute without the entitlement row sees no commerce', () => {
        const snapshot = {
            instituteId: 'inst-1',
            status: 'loaded' as const,
            data: {
                mode: 'LEGACY' as const,
                catalog_version: 1,
                modules: {},
                features: Object.fromEntries(COMMERCE_FEATURE_KEYS.map((k) => [k, false])),
                opt_in_modules: ['commerce'],
                display_settings_version: null,
            },
        };
        const can = (key: string) => resolveCan(snapshot, 'inst-1', key);
        expect(access(['ADMIN'], can).moduleOn).toBe(false);
        expect(visibleCommerceIds(['ADMIN'], can)).toEqual([]);
    });

    it('capabilities not loaded yet: closed', () => {
        const can = (key: string) =>
            resolveCan({ instituteId: null, status: 'loading', data: null }, 'inst-1', key);
        expect(visibleCommerceIds(['ADMIN'], can)).toEqual([]);
    });

    it('one feature off closes exactly its tabs', () => {
        expect(visibleCommerceIds(['ADMIN'], onExcept(COMMERCE_FEATURE.POS))).toEqual(
            ALL_IDS.filter((id) => id !== 'commerce-pos')
        );
        expect(visibleCommerceIds(['ADMIN'], onExcept(COMMERCE_FEATURE.CATALOGUE))).toEqual(
            ALL_IDS.filter(
                (id) =>
                    !['commerce-products', 'commerce-collections', 'commerce-discounts'].includes(
                        id
                    )
            )
        );
    });

    it('Home and Settings open on any one commerce feature; Reports on tax or orders', () => {
        expect(visibleCommerceIds(['ADMIN'], onlyOn(COMMERCE_FEATURE.POS))).toEqual([
            'commerce-home',
            'commerce-pos',
            'commerce-settings',
        ]);
        expect(visibleCommerceIds(['ADMIN'], onlyOn(COMMERCE_FEATURE.TAX_REPORTS))).toEqual([
            'commerce-home',
            'commerce-reports',
            'commerce-settings',
        ]);
        expect(visibleCommerceIds(['ADMIN'], onlyOn(COMMERCE_FEATURE.ORDERS))).toContain(
            'commerce-reports'
        );
    });
});

describe('switch-over days: reports AND migration', () => {
    it('migration off (the default) closes only the switch-over days', () => {
        expect(visibleCommerceIds(['ADMIN'], onExcept(COMMERCE_FEATURE.MIGRATION))).toEqual(
            ALL_IDS.filter((id) => id !== 'commerce-parallel-run')
        );
        expect(
            access(['ADMIN'], onExcept(COMMERCE_FEATURE.MIGRATION)).denialFor(
                'commerce-parallel-run'
            )
        ).toBe('feature');
    });

    it('migration on without tax and reports stays closed', () => {
        expect(
            visibleCommerceIds(['ADMIN'], onExcept(COMMERCE_FEATURE.TAX_REPORTS))
        ).not.toContain('commerce-parallel-run');
        expect(visibleCommerceIds(['ADMIN'], onlyOn(COMMERCE_FEATURE.MIGRATION))).toEqual([
            'commerce-home',
            'commerce-settings',
        ]);
    });

    it('both on: store manager and accountant, not warehouse staff or the cashier', () => {
        const both = onlyOn(COMMERCE_FEATURE.TAX_REPORTS, COMMERCE_FEATURE.MIGRATION);
        expect(visibleCommerceIds(['ADMIN'], both)).toContain('commerce-parallel-run');
        expect(visibleCommerceIds([COMMERCE_ROLE.STORE_MANAGER], both)).toContain(
            'commerce-parallel-run'
        );
        expect(visibleCommerceIds([COMMERCE_ROLE.ACCOUNTANT], both)).toContain(
            'commerce-parallel-run'
        );
        expect(
            access([COMMERCE_ROLE.WAREHOUSE_STAFF], both).denialFor('commerce-parallel-run')
        ).toBe('role');
        expect(
            access([COMMERCE_ROLE.POS_CASHIER], both).denialFor('commerce-parallel-run')
        ).toBe('role');
    });
});

describe('role gate', () => {
    it('a cashier sees only POS', () => {
        expect(visibleCommerceIds([COMMERCE_ROLE.POS_CASHIER])).toEqual(['commerce-pos']);
        // ...and nothing else at all: the whole sidebar is one entry.
        expect(
            filterCommerceSidebar(staticItems, access([COMMERCE_ROLE.POS_CASHIER])).map((i) => i.id)
        ).toEqual(['commerce-pos']);
    });

    it('an institute ADMIN sees all eleven', () => {
        expect(visibleCommerceIds(['ADMIN'])).toEqual(ALL_IDS);
    });

    it.each<[string, CommerceNavId[]]>([
        [COMMERCE_ROLE.STORE_MANAGER, ALL_IDS],
        [COMMERCE_ROLE.WAREHOUSE_STAFF, ['commerce-home', 'commerce-orders', 'commerce-inventory']],
        [
            COMMERCE_ROLE.ACCOUNTANT,
            [
                'commerce-home',
                'commerce-orders',
                'commerce-customers',
                'commerce-reports',
                'commerce-parallel-run',
            ],
        ],
    ])('%s sees its tabs', (role, expected) => {
        expect(visibleCommerceIds([role])).toEqual(expected);
    });

    it('a teacher with no commerce role sees no commerce tab, and keeps the rest', () => {
        const out = filterCommerceSidebar(staticItems, access(['TEACHER']));
        expect(out.some((item) => item.category === 'COMMERCE')).toBe(false);
        expect(out.some((item) => item.id === 'dashboard')).toBe(true);
    });

    it('a teacher who is also a cashier keeps the LMS sidebar and gains POS', () => {
        const out = filterCommerceSidebar(
            staticItems,
            access(['TEACHER', COMMERCE_ROLE.POS_CASHIER])
        );
        expect(out.filter((i) => i.category === 'COMMERCE').map((i) => i.id)).toEqual([
            'commerce-pos',
        ]);
        expect(out.some((item) => item.id === 'dashboard')).toBe(true);
    });

    it('role names are matched whatever their case', () => {
        expect(visibleCommerceIds(['commerce_pos_cashier'])).toEqual(['commerce-pos']);
    });

    it('shop-only staff keep their old sidebar while the module is off', () => {
        const out = filterCommerceSidebar(staticItems, access([COMMERCE_ROLE.POS_CASHIER], allOff));
        expect(out.some((item) => item.category === 'COMMERCE')).toBe(false);
        expect(out.length).toBeGreaterThan(0);
    });
});

describe('denial reasons and landing', () => {
    it('feature is reported before role', () => {
        const cashier = access([COMMERCE_ROLE.POS_CASHIER], onExcept(COMMERCE_FEATURE.ORDERS));
        expect(cashier.denialFor('commerce-orders')).toBe('feature');
        expect(cashier.denialFor('commerce-products')).toBe('role');
        expect(cashier.denialFor('commerce-pos')).toBeNull();
        expect(access(['ADMIN'], allOff).denialFor('commerce-home')).toBe('feature');
    });

    it('isNavFeatureOn ignores the role', () => {
        const cashier = access([COMMERCE_ROLE.POS_CASHIER]);
        expect(cashier.isNavFeatureOn('commerce-products')).toBe(true);
        expect(cashier.canOpen('commerce-products')).toBe(false);
    });

    it('a cashier lands on POS, other shop staff on Home', () => {
        expect(access([COMMERCE_ROLE.POS_CASHIER]).landingRoute).toBe('/commerce/pos');
        expect(access([COMMERCE_ROLE.WAREHOUSE_STAFF]).landingRoute).toBe('/commerce');
        expect(access(['ADMIN']).landingRoute).toBe('/commerce');
    });

    it('post-login: only shop-only staff are sent to the shop', () => {
        expect(commerceStaffLandingRoute([COMMERCE_ROLE.POS_CASHIER], '/dashboard')).toBe(
            '/commerce/pos'
        );
        expect(commerceStaffLandingRoute([COMMERCE_ROLE.ACCOUNTANT], '/dashboard')).toBe(
            '/commerce'
        );
        expect(
            commerceStaffLandingRoute(
                [COMMERCE_ROLE.POS_CASHIER, COMMERCE_ROLE.WAREHOUSE_STAFF],
                '/dashboard'
            )
        ).toBe('/commerce');
        expect(commerceStaffLandingRoute(['ADMIN'], '/dashboard')).toBe('/dashboard');
        expect(commerceStaffLandingRoute(['TEACHER', COMMERCE_ROLE.POS_CASHIER], '/x')).toBe('/x');
        expect(commerceStaffLandingRoute([], '/dashboard')).toBe('/dashboard');
        expect(commerceStaffLandingRoute(undefined, '/dashboard')).toBe('/dashboard');
    });

    it('isManager: institute ADMIN or store manager', () => {
        expect(access(['ADMIN']).isManager).toBe(true);
        expect(access([COMMERCE_ROLE.STORE_MANAGER]).isManager).toBe(true);
        expect(access([COMMERCE_ROLE.ACCOUNTANT]).isManager).toBe(false);
    });
});

describe('Teams role picker', () => {
    const roles = [
        { name: 'ADMIN' },
        { name: 'TEACHER' },
        { name: 'COMMERCE_STORE_MANAGER' },
        { name: 'COMMERCE_WAREHOUSE_STAFF' },
        { name: 'COMMERCE_POS_CASHIER' },
        { name: 'COMMERCE_ACCOUNTANT' },
        { name: 'Counsellor' },
    ];
    const names = (viewer: { isAdmin: boolean; moduleOn: boolean }) =>
        filterAssignableRoles(roles, viewer).map((role) => role.name);

    it('an ADMIN of an institute with the module is offered all four', () => {
        expect(names({ isAdmin: true, moduleOn: true })).toHaveLength(7);
    });

    it.each([
        { isAdmin: true, moduleOn: false },
        { isAdmin: false, moduleOn: true },
        { isAdmin: false, moduleOn: false },
    ])('hidden for %o', (viewer) => {
        expect(names(viewer)).toEqual(['ADMIN', 'TEACHER', 'Counsellor']);
    });
});
