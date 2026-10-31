/**
 * In-app institute switch: runs the SAME post-selection steps as picking an
 * institute on the login screen, then reloads the app into it, so a switched
 * session is indistinguishable from a fresh login into that institute.
 *
 *   1. drop every institute-scoped cache (instituteSwitch.ts — what logout would
 *      have wiped before a fresh login; handleLoginFlow clears the faculty pair
 *      the same way before selecting),
 *   2. `handleInstituteSelection(id)` — the login picker's own handler: portal
 *      ADMIN check, selectedInstituteId, faculty/sub-org access, course settings
 *      refresh, display-settings role key + fetch, post-login redirect,
 *   3. sub-org picker when the user has several (login: SubOrgSelection),
 *   4. clear React Query + sessionStorage and `window.location.assign(redirect)`
 *      — a full reload, so every in-memory store (institute details, logos,
 *      capabilities, study library…) starts empty.
 */
import type { QueryClient } from '@tanstack/react-query';
import { getTokenDecodedData, getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getCurrentInstituteId, getInstitutesFromToken } from '@/lib/auth/instituteUtils';
import {
    handleInstituteSelection,
    resolveDisplaySettingsRoleKey,
} from '@/lib/auth/loginFlowHandler';
import { hasFacultyAssignedPermission, setSelectedSubOrgId } from '@/lib/auth/facultyAccessUtils';
import {
    getDisplaySettings,
    getDisplaySettingsFromCache,
    resolveEffectivePostLoginRoute,
} from '@/services/display-settings';
import { getCachedInstituteBranding } from '@/services/domain-routing';
import { getCourseSettings } from '@/services/course-settings';
import { trackEvent } from '@/lib/amplitude';
import { isNative } from '@/native/platform';
import { getFlavor } from '@/native/flavor';
import type { DisplaySettingsData } from '@/types/display-settings';
import type { SubOrgAccess } from '@/types/faculty-access';
import {
    clearInstituteScopedStorage,
    getEligibleInstitutes,
    restoreInstituteScopedStorage,
    type StorageSnapshot,
    type SwitchableInstitute,
} from '@/lib/auth/instituteSwitch';

/** Institutes the signed-in user can switch to (token + portal ADMIN rule). */
export const getSwitchableInstitutes = (): SwitchableInstitute[] => {
    const token = getTokenFromCookie(TokenKey.accessToken);
    const data = token ? getTokenDecodedData(token) : null;
    return getEligibleInstitutes(data?.authorities, {
        requiresAdmin: (id) => getCachedInstituteBranding(id)?.role === 'ADMIN',
    });
};

/**
 * True on a white-label host that is mapped to one institute. index.tsx's
 * branding bootstrap rewrites `selectedInstituteId` to the host's institute on
 * every full page load there (cacheInstituteBranding with the default
 * setSelectedInstitute), so a switch would be undone by the reload. Native
 * fixed-flavor apps brand by a fixed institute WITHOUT selecting it.
 */
export const isHostBoundToInstitute = (): boolean => {
    try {
        const raw = localStorage.getItem('current_domain_branding');
        if (!raw) return false;
        const branding = JSON.parse(raw) as {
            instituteId?: string | null;
            subOrgId?: string | null;
        };
        if (!branding?.instituteId && !branding?.subOrgId) return false;
        const flavor = getFlavor();
        const usesFlavorBranding =
            isNative() && !!(flavor.brandingDomain && flavor.brandingSubdomain);
        return !usesFlavorBranding;
    } catch {
        return false;
    }
};

export type InstituteSwitchOutcome =
    | { status: 'redirect'; redirectUrl: string }
    | { status: 'chooseSubOrg'; subOrgs: SubOrgAccess[] }
    | { status: 'failed'; error: string }
    /** handleInstituteSelection rejected the user and already logged them out + toasted. */
    | { status: 'signedOut' };

export interface InstituteSwitchSession {
    targetInstituteId: string;
    previousInstituteId: string | undefined;
    snapshot: StorageSnapshot;
}

/** Puts the previous institute's storage back. Returns true when a reload is needed. */
export const rollbackInstituteSwitch = (session: InstituteSwitchSession): boolean => {
    const changed = getCurrentInstituteId() !== session.previousInstituteId;
    restoreInstituteScopedStorage(localStorage, session.snapshot);
    return changed;
};

/** Steps 1–2 (and the decision for step 3). */
export const beginInstituteSwitch = async (
    targetInstituteId: string
): Promise<{ session: InstituteSwitchSession | null; outcome: InstituteSwitchOutcome }> => {
    const previousInstituteId = getCurrentInstituteId();
    if (targetInstituteId === previousInstituteId) {
        return { session: null, outcome: { status: 'failed', error: 'already_current' } };
    }
    if (!getSwitchableInstitutes().some((inst) => inst.id === targetInstituteId)) {
        return { session: null, outcome: { status: 'failed', error: 'not_eligible' } };
    }

    const snapshot = clearInstituteScopedStorage(localStorage);
    const session: InstituteSwitchSession = { targetInstituteId, previousInstituteId, snapshot };

    let result: Awaited<ReturnType<typeof handleInstituteSelection>>;
    try {
        result = await handleInstituteSelection(targetInstituteId);
    } catch (error) {
        result = {
            success: false,
            error: error instanceof Error ? error.message : 'institute_switch_failed',
        };
    }

    if (!result.success) {
        if (result.error === 'suborg_portal_mismatch') {
            return { session, outcome: { status: 'signedOut' } };
        }
        return {
            session,
            outcome: { status: 'failed', error: result.error || 'institute_switch_failed' },
        };
    }

    if (result.shouldShowSubOrgSelection && result.subOrgs?.length) {
        return { session, outcome: { status: 'chooseSubOrg', subOrgs: result.subOrgs } };
    }

    return {
        session,
        outcome: { status: 'redirect', redirectUrl: result.redirectUrl || '/dashboard' },
    };
};

/**
 * After a sub-org pick. The login screen's SubOrgSelection only stores the id
 * (setSelectedSubOrgId); handleInstituteSelection returned BEFORE its
 * display-settings half, so run that half here — mirrors
 * loginFlowHandler.ts handleInstituteSelection lines 707-806.
 */
export const completeInstituteSwitchWithSubOrg = async (
    targetInstituteId: string,
    subOrgId: string
): Promise<string> => {
    setSelectedSubOrgId(subOrgId);

    const institute = getInstitutesFromToken().find((inst) => inst.id === targetInstituteId);
    const roles = institute?.roles ?? [];
    const hasAdminRole = roles.includes('ADMIN');
    const hasStudentRole = roles.includes('STUDENT');

    void getCourseSettings(true).catch(() => {});

    const hasFaculty = hasFacultyAssignedPermission(targetInstituteId);
    let roleKey = resolveDisplaySettingsRoleKey(hasAdminRole, hasFaculty, roles, undefined);
    if (!hasAdminRole && hasFaculty) {
        try {
            const { getAllRoles } = await import(
                '@/routes/manage-custom-teams/-services/custom-team-services'
            );
            roleKey = resolveDisplaySettingsRoleKey(
                hasAdminRole,
                hasFaculty,
                roles,
                await getAllRoles()
            );
        } catch (err) {
            console.error('Failed to map custom role for display settings', err);
        }
    }
    localStorage.setItem('ACTIVE_ROLE_DISPLAY_SETTINGS_KEY', roleKey);

    let ds: DisplaySettingsData | null = getDisplaySettingsFromCache(roleKey);
    if (ds) {
        void getDisplaySettings(roleKey, true).catch(() => {});
    } else {
        for (let attempt = 0; attempt < 3 && !ds; attempt += 1) {
            try {
                ds = await getDisplaySettings(roleKey, true);
            } catch {
                if (attempt < 2) {
                    await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
                }
            }
        }
    }

    const branding = getCachedInstituteBranding(targetInstituteId);
    let redirectUrl = ds?.postLoginRedirectRoute || branding?.afterLoginRoute || '/dashboard';
    redirectUrl = resolveEffectivePostLoginRoute(redirectUrl, ds);
    if (
        hasStudentRole &&
        roles.length > 1 &&
        (redirectUrl === '/dashboard' || redirectUrl.startsWith('/dashboard?'))
    ) {
        redirectUrl = '/dashboard?showLearnerTab=true';
    }
    return redirectUrl;
};

/**
 * A page left by a switch must never come back from the back/forward cache: its
 * heap still holds the previous institute while storage now points at the new
 * one. Reload it instead if the browser restores it.
 */
export const reloadIfRestoredFromBfcache = (): void => {
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) window.location.reload();
    });
};

/** Step 4: leave nothing of the previous institute in memory. */
export const commitInstituteSwitch = (
    session: InstituteSwitchSession,
    redirectUrl: string,
    queryClient?: Pick<QueryClient, 'clear'>
): void => {
    try {
        trackEvent('Institute Switched', {
            from_institute_id: session.previousInstituteId ?? null,
            to_institute_id: session.targetInstituteId,
            timestamp: new Date().toISOString(),
        });
    } catch {
        // analytics must never block the switch
    }
    queryClient?.clear();
    try {
        sessionStorage.clear();
    } catch {
        /* best-effort, as on logout */
    }
    reloadIfRestoredFromBfcache();
    window.location.assign(redirectUrl);
};
