import i18next from 'i18next';
import { getRolesForCurrentInstitute } from '@/lib/auth/instituteUtils';
import {
    readCurrentInstituteIdSafely,
    resolveCan,
    syncCapabilitiesOnce,
    useCapabilitiesStore,
} from '@/services/capabilities';
import {
    COMMERCE_FEATURE_KEYS,
    COMMERCE_ROLE,
    type CommerceRoleName,
    filterAssignableRoles,
    isCommerceRoleName,
} from './commerce-access';

/**
 * Non-hook readers for code that runs outside React (the roles fetcher, label
 * helpers). Same rules as useCommerceAccess: roles are per institute and the
 * module reads as off until the server says otherwise.
 */

function readRolesSafely(): string[] {
    try {
        return getRolesForCurrentInstitute();
    } catch {
        return [];
    }
}

/** Whether the current institute has any commerce feature, as far as is known now. */
export function isCommerceModuleOnNow(): boolean {
    const instituteId = readCurrentInstituteIdSafely();
    const snapshot = useCapabilitiesStore.getState();
    return COMMERCE_FEATURE_KEYS.some((feature) => resolveCan(snapshot, instituteId, feature));
}

/**
 * Drops the four commerce roles from a role list unless the viewer is an
 * institute ADMIN of an institute with the commerce module: the only case in
 * which the backend accepts a grant (anyone else gets a 403). Waits for the
 * capabilities call first, so an admin who opens Teams straight after login is
 * not shown a list without the roles for the next five minutes of cache.
 */
export async function hideUnassignableCommerceRoles<T extends { name?: string | null }>(
    roles: T[]
): Promise<T[]> {
    if (!roles.some((role) => isCommerceRoleName(role?.name))) return roles;
    const isAdmin = readRolesSafely().includes('ADMIN');
    if (isAdmin) await syncCapabilitiesOnce(readCurrentInstituteIdSafely());
    return filterAssignableRoles(roles, { isAdmin, moduleOn: isAdmin && isCommerceModuleOnNow() });
}

const ROLE_LABEL_KEYS: Record<CommerceRoleName, { key: string; fallback: string }> = {
    [COMMERCE_ROLE.STORE_MANAGER]: { key: 'storeManager', fallback: 'Store manager' },
    [COMMERCE_ROLE.WAREHOUSE_STAFF]: { key: 'warehouseStaff', fallback: 'Warehouse staff' },
    [COMMERCE_ROLE.POS_CASHIER]: { key: 'posCashier', fallback: 'Cashier' },
    [COMMERCE_ROLE.ACCOUNTANT]: { key: 'accountant', fallback: 'Shop accountant' },
};

let commerceStringsRequested = false;

/**
 * The role labels live in the `commerce` strings, which a screen outside the
 * shop (Teams) has not loaded. Ask for them once; the next render has them.
 */
function requestCommerceStrings(): void {
    if (commerceStringsRequested) return;
    commerceStringsRequested = true;
    try {
        if (i18next.isInitialized) {
            void i18next.loadNamespaces('commerce').catch(() => undefined);
        }
    } catch {
        // Strings unavailable: the English fallback below is used.
    }
}

/**
 * Display name for a commerce role ("COMMERCE_POS_CASHIER" → "Cashier"), or null
 * for any other role. Falls back to English while the `commerce` strings load.
 */
export function commerceRoleLabel(roleName: string | null | undefined): string | null {
    if (!isCommerceRoleName(roleName)) return null;
    requestCommerceStrings();
    const entry = ROLE_LABEL_KEYS[roleName.toUpperCase() as CommerceRoleName];
    const value = i18next.t(`commerce:roles.${entry.key}`, { defaultValue: entry.fallback });
    return typeof value === 'string' && value ? value : entry.fallback;
}
