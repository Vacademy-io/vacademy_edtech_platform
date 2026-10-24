/**
 * Pure helpers behind the in-app institute switcher (navbar profile menu).
 *
 * Kept free of cookies, network and React so they can be unit-tested; the
 * side-effecting switch itself lives in `instituteSwitchFlow.ts`.
 */
import type { Authority } from '@/constants/auth/tokens';
import { StorageKey } from '@/constants/storage/storage';
import { CUSTOM_ROLE_DISPLAY_SETTINGS_KEY } from '@/types/display-settings';
import { THEME_ROLE_SETTINGS_KEY } from '@/types/theme-role-settings';
import { LANGUAGE_SETTING_STORAGE_KEY } from '@/services/language-settings';
import { getPrimaryRole, getValidInstitutes, type Institute } from '@/lib/auth/instituteUtils';

export interface SwitchableInstitute {
    id: string;
    roles: string[];
    permissions: string[];
    /** Same ranking the login picker uses: ADMIN, else the first non-STUDENT role. */
    primaryRole: string;
}

export interface EligibleInstituteOptions {
    /**
     * True when this portal only admits ADMINs for the given institute
     * (domain branding `role === 'ADMIN'`). Mirrors the check at the top of
     * `handleInstituteSelection`, so the list never offers an institute the
     * switch would then refuse.
     */
    requiresAdmin?: (instituteId: string) => boolean;
}

/**
 * The institutes the user may work in on the admin portal, in token order.
 * Same eligibility as the login picker (`getInstituteSelectionResult` →
 * `getValidInstitutes`): learner-only (and role-less) institutes are excluded.
 */
export const getEligibleInstitutes = (
    authorities: Record<string, Authority> | null | undefined,
    options: EligibleInstituteOptions = {}
): SwitchableInstitute[] => {
    if (!authorities || typeof authorities !== 'object') return [];

    const all: Institute[] = Object.entries(authorities).map(([id, authority]) => ({
        id,
        name: id,
        roles: Array.isArray(authority?.roles) ? authority.roles : [],
        permissions: Array.isArray(authority?.permissions) ? authority.permissions : [],
    }));

    return getValidInstitutes(all)
        .filter((inst) => !(options.requiresAdmin?.(inst.id) && !inst.roles.includes('ADMIN')))
        .map((inst) => ({
            id: inst.id,
            roles: inst.roles,
            permissions: inst.permissions,
            primaryRole: getPrimaryRole(inst.roles),
        }));
};

/** The switch entry is offered only with somewhere else to go, on a host that keeps the choice. */
export const canOfferInstituteSwitch = (eligibleCount: number, hostBound: boolean): boolean =>
    !hostBound && eligibleCount >= 2;

/** 'CONTENT CREATOR' → 'Content Creator', 'admin' → 'Admin'. */
export const formatRoleName = (role: string): string =>
    role
        .replace(/[_\s]+/g, ' ')
        .trim()
        .toLowerCase()
        .split(' ')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

export interface RoleLabelParts {
    /** Raw primary role name (e.g. 'ADMIN', 'COUNSELLOR'). */
    primary: string;
    /** Other staff roles the user also holds there (learner roles are not counted). */
    extraCount: number;
}

const LEARNER_ROLES = new Set(['STUDENT', 'LEARNER']);

/** What to show as "your role" for one institute in the switcher list. */
export const getRoleLabelParts = (roles: string[]): RoleLabelParts => {
    const primary = getPrimaryRole(roles);
    const staff = new Set(
        roles.filter((r) => !LEARNER_ROLES.has(r.toUpperCase())).map((r) => r.toUpperCase())
    );
    staff.delete(primary.toUpperCase());
    return { primary, extraCount: staff.size };
};

/** Case- and accent-insensitive name match for the switcher search box. */
export const filterInstitutesByQuery = <T extends { name: string }>(
    institutes: T[],
    query: string
): T[] => {
    const fold = (s: string) =>
        s
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    const q = fold(query);
    if (!q) return institutes;
    return institutes.filter((inst) => fold(inst.name).includes(q));
};

/**
 * localStorage keys that hold data for ONE institute without the institute id
 * in the key, plus the per-institute display-settings caches. A fresh login
 * starts from storage wiped by logout, so a switch drops all of them to land in
 * the same state. `selectedInstituteId` is deliberately absent: the login code
 * we reuse (`handleInstituteSelection`) overwrites it.
 */
export const INSTITUTE_SCOPED_STORAGE_KEYS: readonly string[] = [
    // Written by the login flow itself (loginFlowHandler.ts handleLoginFlow
    // clears the faculty pair before anything else).
    'ACTIVE_ROLE_DISPLAY_SETTINGS_KEY',
    'faculty_access_data',
    'selected_suborg_id',
    // Institute details side effects (services/student-list-section/getInstituteDetails.ts).
    // Only written when the institute HAS the setting, so a stale value would leak.
    StorageKey.NAMING_SETTINGS,
    StorageKey.firstTimeNamingSettings,
    StorageKey.MODULES,
    StorageKey.TAB_SETTINGS,
    StorageKey.CUSTOM_ROLE_DISPLAY_SETTINGS,
    THEME_ROLE_SETTINGS_KEY,
    LANGUAGE_SETTING_STORAGE_KEY,
    'instituteDetails',
    'custom-field-settings-cache',
    'STUDENT_DISPLAY_SETTINGS_CACHE_V1', // services/student-display-settings.ts LS_KEY
    // Sidebar "recent" list — routes/labels of the previous institute.
    'vacademy_recent_sidebar_tabs',
];

export const INSTITUTE_SCOPED_STORAGE_PREFIXES: readonly string[] = [
    // services/display-settings.ts getLocalStorageKey(): `${prefix}-${instituteId}`
    // (and the legacy un-suffixed keys).
    StorageKey.ADMIN_DISPLAY_SETTINGS,
    StorageKey.TEACHER_DISPLAY_SETTINGS,
    CUSTOM_ROLE_DISPLAY_SETTINGS_KEY,
    // services/capabilities.ts version stamp per institute.
    'DISPLAY_SETTINGS_SERVER_VERSION',
];

/** Which of `keys` a switch must drop. */
export const getInstituteScopedStorageKeys = (keys: Iterable<string>): string[] => {
    const exact = new Set(INSTITUTE_SCOPED_STORAGE_KEYS);
    const out: string[] = [];
    for (const key of keys) {
        if (exact.has(key) || INSTITUTE_SCOPED_STORAGE_PREFIXES.some((p) => key.startsWith(p))) {
            out.push(key);
        }
    }
    return out;
};

export type StorageSnapshot = Array<readonly [string, string]>;

interface StorageLike {
    readonly length: number;
    key(index: number): string | null;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

const listKeys = (storage: StorageLike): string[] => {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (key !== null) keys.push(key);
    }
    return keys;
};

/**
 * Removes every institute-scoped key and returns what was there (plus
 * `selectedInstituteId`) so a failed switch can put it all back.
 */
export const clearInstituteScopedStorage = (storage: StorageLike): StorageSnapshot => {
    const snapshot: Array<readonly [string, string]> = [];
    const selected = storage.getItem('selectedInstituteId');
    if (selected !== null) snapshot.push(['selectedInstituteId', selected] as const);
    for (const key of getInstituteScopedStorageKeys(listKeys(storage))) {
        const value = storage.getItem(key);
        if (value !== null) snapshot.push([key, value] as const);
        storage.removeItem(key);
    }
    return snapshot;
};

/** Undo a partial switch: drop whatever the target wrote, then restore the snapshot. */
export const restoreInstituteScopedStorage = (
    storage: StorageLike,
    snapshot: StorageSnapshot
): void => {
    for (const key of getInstituteScopedStorageKeys(listKeys(storage))) {
        storage.removeItem(key);
    }
    if (!snapshot.some(([key]) => key === 'selectedInstituteId')) {
        storage.removeItem('selectedInstituteId');
    }
    for (const [key, value] of snapshot) {
        storage.setItem(key, value);
    }
};
