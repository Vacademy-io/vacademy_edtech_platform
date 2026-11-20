/**
 * Commerce access: which shop screens the signed-in person is OFFERED.
 *
 * Pure: no React, no network. `useCommerceAccess()` feeds it the roles from the
 * access token and the fail-closed feature reader (`resolveCan`, which reads the
 * `/capabilities/v1/me` features map in every mode for opt-in modules).
 *
 * Two gates, both needed for every screen:
 *  - FEATURE: the institute has the commerce feature (off for everyone, LEGACY
 *    institutes included, until its entitlement row is switched on).
 *  - ROLE: institute ADMIN, or one of the four commerce roles the screen lists.
 *
 * This decides what the UI offers, never what is allowed: every commerce
 * endpoint runs `CommerceAccessGuard` and answers 403 regardless.
 */
import type { SidebarItemsType } from '@/types/layout-container/layout-container-types';

export const COMMERCE_MODULE_KEY = 'commerce';

/** Feature keys exactly as `capabilities/catalog.json` spells them. */
export const COMMERCE_FEATURE = {
    CATALOGUE: 'commerce.catalogue',
    ORDERS: 'commerce.orders',
    STOCK: 'commerce.stock',
    POS: 'commerce.pos',
    TAX_REPORTS: 'commerce.tax_reports',
    /** Read as off until the catalogue carries it. */
    ACCOUNTS: 'commerce.accounts',
    /** Opening stock and switch-over; off for every institute until granted. */
    MIGRATION: 'commerce.migration',
} as const;

export type CommerceFeatureKey = (typeof COMMERCE_FEATURE)[keyof typeof COMMERCE_FEATURE];

export const COMMERCE_FEATURE_KEYS: readonly CommerceFeatureKey[] = Object.values(COMMERCE_FEATURE);

/** Role names exactly as auth_service seeds them (`CommerceRole.authority()`). */
export const COMMERCE_ROLE = {
    STORE_MANAGER: 'COMMERCE_STORE_MANAGER',
    WAREHOUSE_STAFF: 'COMMERCE_WAREHOUSE_STAFF',
    POS_CASHIER: 'COMMERCE_POS_CASHIER',
    ACCOUNTANT: 'COMMERCE_ACCOUNTANT',
} as const;

export type CommerceRoleName = (typeof COMMERCE_ROLE)[keyof typeof COMMERCE_ROLE];

export const COMMERCE_ROLE_NAMES: readonly CommerceRoleName[] = Object.values(COMMERCE_ROLE);

const ROLE_ADMIN = 'ADMIN';

export const isCommerceRoleName = (name: string | null | undefined): name is CommerceRoleName =>
    !!name && (COMMERCE_ROLE_NAMES as readonly string[]).includes(name.toUpperCase());

export const COMMERCE_SIDEBAR_CATEGORY = 'COMMERCE';

export type CommerceNavId =
    | 'commerce-home'
    | 'commerce-orders'
    | 'commerce-products'
    | 'commerce-collections'
    | 'commerce-inventory'
    | 'commerce-pos'
    | 'commerce-customers'
    | 'commerce-discounts'
    | 'commerce-reports'
    | 'commerce-parallel-run'
    | 'commerce-settings';

export interface CommerceNavRule {
    /** Sidebar tab id (also what `governs.nav` in the catalogue lists). */
    id: CommerceNavId;
    route: string;
    /** Key of the tab's name in the `sidebar` strings. */
    labelKey: string;
    /**
     * ANY of these features opens the screen; an empty list means "any commerce
     * feature at all" (Home, Settings).
     */
    anyFeature: readonly CommerceFeatureKey[];
    /** Features that must ALL be on as well (an add-on on top of `anyFeature`). */
    allFeatures?: readonly CommerceFeatureKey[];
    /** Commerce roles that see the screen. Institute ADMIN always does. */
    roles: readonly CommerceRoleName[];
}

const { STORE_MANAGER, WAREHOUSE_STAFF, POS_CASHIER, ACCOUNTANT } = COMMERCE_ROLE;

/** The shop screens, in sidebar order: the ten of Phase 1 and the switch-over days. */
export const COMMERCE_NAV: readonly CommerceNavRule[] = [
    {
        id: 'commerce-home',
        route: '/commerce',
        labelKey: 'commerceHome',
        anyFeature: [],
        // Not the cashier: a cashier sees only POS and is taken straight to it,
        // so Home sends a cashier on to POS.
        roles: [STORE_MANAGER, WAREHOUSE_STAFF, ACCOUNTANT],
    },
    {
        id: 'commerce-orders',
        route: '/commerce/orders',
        labelKey: 'commerceOrders',
        anyFeature: [COMMERCE_FEATURE.ORDERS],
        roles: [STORE_MANAGER, WAREHOUSE_STAFF, ACCOUNTANT],
    },
    {
        id: 'commerce-products',
        route: '/commerce/products',
        labelKey: 'commerceProducts',
        anyFeature: [COMMERCE_FEATURE.CATALOGUE],
        roles: [STORE_MANAGER],
    },
    {
        id: 'commerce-collections',
        route: '/commerce/collections',
        labelKey: 'commerceCollections',
        anyFeature: [COMMERCE_FEATURE.CATALOGUE],
        roles: [STORE_MANAGER],
    },
    {
        id: 'commerce-inventory',
        route: '/commerce/inventory',
        labelKey: 'commerceInventory',
        anyFeature: [COMMERCE_FEATURE.STOCK],
        roles: [STORE_MANAGER, WAREHOUSE_STAFF],
    },
    {
        id: 'commerce-pos',
        route: '/commerce/pos',
        labelKey: 'commercePos',
        anyFeature: [COMMERCE_FEATURE.POS],
        roles: [STORE_MANAGER, POS_CASHIER],
    },
    {
        id: 'commerce-customers',
        route: '/commerce/customers',
        labelKey: 'commerceCustomers',
        anyFeature: [COMMERCE_FEATURE.ORDERS],
        roles: [STORE_MANAGER, ACCOUNTANT],
    },
    {
        id: 'commerce-discounts',
        route: '/commerce/discounts',
        labelKey: 'commerceDiscounts',
        anyFeature: [COMMERCE_FEATURE.CATALOGUE],
        roles: [STORE_MANAGER],
    },
    {
        id: 'commerce-reports',
        route: '/commerce/reports',
        labelKey: 'commerceReports',
        anyFeature: [
            COMMERCE_FEATURE.TAX_REPORTS,
            COMMERCE_FEATURE.ORDERS,
            COMMERCE_FEATURE.ACCOUNTS,
        ],
        roles: [STORE_MANAGER, ACCOUNTANT],
    },
    {
        // The old system's day totals beside the platform's during a store's parallel run.
        id: 'commerce-parallel-run',
        route: '/commerce/parallel-run',
        labelKey: 'commerceParallelRun',
        anyFeature: [COMMERCE_FEATURE.TAX_REPORTS],
        allFeatures: [COMMERCE_FEATURE.MIGRATION],
        roles: [STORE_MANAGER, ACCOUNTANT],
    },
    {
        id: 'commerce-settings',
        route: '/commerce/settings',
        labelKey: 'commerceSettings',
        anyFeature: [],
        roles: [STORE_MANAGER],
    },
];

const NAV_BY_ID = new Map<string, CommerceNavRule>(COMMERCE_NAV.map((rule) => [rule.id, rule]));

export const commerceNavRule = (id: string): CommerceNavRule | undefined => NAV_BY_ID.get(id);

/** Why a commerce screen is closed to this person. */
export type CommerceDenial = 'feature' | 'role';

export interface CommerceAccess {
    /** At least one commerce feature is on for the institute. */
    moduleOn: boolean;
    isAdmin: boolean;
    /** The commerce roles the person holds in this institute. */
    commerceRoles: CommerceRoleName[];
    /** Institute ADMIN or store manager: the people who set the shop up. */
    isManager: boolean;
    /** Holds a commerce role and nothing else: the sidebar shows only the shop. */
    isCommerceOnlyStaff: boolean;
    isFeatureOn(feature: CommerceFeatureKey): boolean;
    hasAnyRole(roles: readonly CommerceRoleName[]): boolean;
    /** The feature gate alone (what the institute has), whatever the person's role. */
    isNavFeatureOn(navId: CommerceNavId): boolean;
    /** null = open; otherwise the first gate that closes it (feature before role). */
    denialFor(navId: CommerceNavId): CommerceDenial | null;
    canOpen(navId: CommerceNavId): boolean;
    /** Where this person starts in the shop: POS for a cashier, Home otherwise. */
    landingRoute: string;
}

export interface ResolveCommerceAccessArgs {
    /** Role names for the CURRENT institute, as the access token carries them. */
    roles: readonly string[];
    /** Fail-closed feature reader (`useCapabilities().can`). */
    isFeatureOn: (featureKey: string) => boolean;
}

export function resolveCommerceAccess({
    roles,
    isFeatureOn,
}: ResolveCommerceAccessArgs): CommerceAccess {
    const upper = roles.map((role) => (role || '').toUpperCase()).filter(Boolean);
    const isAdmin = upper.includes(ROLE_ADMIN);
    const commerceRoles = COMMERCE_ROLE_NAMES.filter((role) => upper.includes(role));
    const featureOn = (feature: CommerceFeatureKey) => isFeatureOn(feature);
    const moduleOn = COMMERCE_FEATURE_KEYS.some(featureOn);
    const hasAnyRole = (allowed: readonly CommerceRoleName[]) =>
        isAdmin || allowed.some((role) => commerceRoles.includes(role));

    const isNavFeatureOn = (navId: CommerceNavId) => {
        const rule = NAV_BY_ID.get(navId);
        if (!rule || !moduleOn) return false;
        if (rule.allFeatures && !rule.allFeatures.every(featureOn)) return false;
        return rule.anyFeature.length === 0 || rule.anyFeature.some(featureOn);
    };
    const denialFor = (navId: CommerceNavId): CommerceDenial | null => {
        const rule = NAV_BY_ID.get(navId);
        if (!rule || !isNavFeatureOn(navId)) return 'feature';
        return hasAnyRole(rule.roles) ? null : 'role';
    };
    const canOpen = (navId: CommerceNavId) => denialFor(navId) === null;

    const isCommerceOnlyStaff =
        commerceRoles.length > 0 && upper.every((role) => isCommerceRoleName(role));
    const cashierOnly = !isAdmin && commerceRoles.length === 1 && commerceRoles[0] === POS_CASHIER;

    return {
        moduleOn,
        isAdmin,
        commerceRoles,
        isManager: isAdmin || commerceRoles.includes(STORE_MANAGER),
        isCommerceOnlyStaff,
        isFeatureOn: featureOn,
        hasAnyRole,
        isNavFeatureOn,
        denialFor,
        canOpen,
        landingRoute: cashierOnly ? '/commerce/pos' : '/commerce',
    };
}

/**
 * The sidebar after the commerce gates.
 *  - A commerce tab stays only when its feature is on and the person's role sees it.
 *  - Someone who holds ONLY commerce roles gets only the shop: a cashier's sidebar
 *    is POS and nothing else. Applies while the module is on; with it off they
 *    keep the sidebar they had, so nobody is left with an empty screen.
 * Returns `items` itself when nothing changes.
 */
export function filterCommerceSidebar(
    items: SidebarItemsType[],
    access: CommerceAccess
): SidebarItemsType[] {
    const shopOnly = access.moduleOn && access.isCommerceOnlyStaff;
    const out = items.filter((item) => {
        const rule = NAV_BY_ID.get(item.id);
        if (rule) return access.canOpen(rule.id);
        // A custom tab filed under the Commerce rail follows the module switch.
        if (item.category === COMMERCE_SIDEBAR_CATEGORY) return access.moduleOn;
        return !shopOnly;
    });
    return out.length === items.length ? items : out;
}

/**
 * Role rows a Teams picker may offer. The four commerce roles are platform rows,
 * so the roles endpoint returns them for every institute; granting one is refused
 * (403) unless the caller is an institute ADMIN of an institute with the module.
 */
export function filterAssignableRoles<T extends { name?: string | null }>(
    roles: T[],
    viewer: { isAdmin: boolean; moduleOn: boolean }
): T[] {
    if (viewer.isAdmin && viewer.moduleOn) return roles;
    return roles.filter((role) => !isCommerceRoleName(role?.name));
}

/**
 * Post-login landing for shop-only staff: the Display Settings route is built
 * for LMS/CRM roles and would drop a cashier on a dashboard they cannot use.
 * Anyone with a non-commerce role keeps `fallback`.
 */
export function commerceStaffLandingRoute(
    roles: readonly string[] | null | undefined,
    fallback: string
): string {
    const upper = (roles ?? []).map((role) => (role || '').toUpperCase()).filter(Boolean);
    if (upper.length === 0 || !upper.every((role) => isCommerceRoleName(role))) return fallback;
    return upper.length === 1 && upper[0] === POS_CASHIER ? '/commerce/pos' : '/commerce';
}
