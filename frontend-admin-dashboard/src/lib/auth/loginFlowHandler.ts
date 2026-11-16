import { getInstituteId } from '@/constants/helper';
import { toast } from 'sonner';
import {
    setAuthorizationCookie,
    getUserRoles,
    removeCookiesAndLogout,
} from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import {
    shouldBlockStudentLogin,
    getInstituteSelectionResult,
    setSelectedInstitute,
    getPrimaryRole,
    getInstitutesFromToken,
} from '@/lib/auth/instituteUtils';
import { getTokenFromCookie } from '@/lib/auth/sessionUtility';
import { trackEvent, identifyUser } from '@/lib/amplitude';
import {
    getDisplaySettingsFromCache,
    getDisplaySettings,
    resolveEffectivePostLoginRoute,
    buildCustomRoleDisplaySettingsKey,
} from '@/services/display-settings';
import {
    ADMIN_DISPLAY_SETTINGS_KEY,
    TEACHER_DISPLAY_SETTINGS_KEY, CUSTOM_ROLE_DISPLAY_SETTINGS_KEY,
    type DisplaySettingsData,
} from '@/types/display-settings';
import type { QueryClient } from '@tanstack/react-query';
import { getCachedInstituteBranding, resolveInstituteForCurrentHost } from '@/services/domain-routing';
import { getCourseSettings } from '@/services/course-settings';
import { commerceStaffLandingRoute } from '@/lib/commerce/commerce-access';
import {
    hasFacultyAssignedPermission,
    fetchUserAccessDetails,
    processAccessMappings,
    saveFacultyAccessData,
} from '@/lib/auth/facultyAccessUtils';
import type { SubOrgAccess } from '@/types/faculty-access';

// Learner role names that must NOT drive the admin-portal display settings. A
// user who is both a learner and a staff member (e.g. STUDENT + COUNSELLOR) must
// resolve to the staff role's settings in the admin portal — never the learner's.
// The backend may list STUDENT before COUNSELLOR, so a plain first-match across
// all roles wrongly loaded the learner role's settings (all categories visible).
const LEARNER_ROLE_NAMES = ['STUDENT', 'LEARNER'];

/**
 * Resolve which custom-role ids should drive the admin-portal display settings
 * for a user holding `userRoles`. Prefers non-learner (staff) roles over learner
 * roles, and keeps the backend's own list order.
 *
 * Returns EVERY staff role the user holds, not just the first. A user is often
 * given two roles that split the product between them (COUNSELLOR for the CRM,
 * Upselling for the library); resolving to whichever one the backend happened to
 * list first meant everything the other role granted never showed up. Callers
 * union the configs behind those ids.
 *
 * Returns [] when nothing matches (caller then falls back to the base
 * CUSTOM_ROLE_DISPLAY_SETTINGS_KEY).
 */
export const pickDisplaySettingsRoleIds = (
    userRoles: string[] | undefined,
    customRoles: Array<{ id: string | number; name: string }> | undefined
): string[] => {
    if (!userRoles?.length || !customRoles?.length) return [];

    const isLearner = (r: string) => LEARNER_ROLE_NAMES.includes(r.toUpperCase());
    const staffRoles = userRoles.filter((r) => !isLearner(r));
    const learnerRoles = userRoles.filter(isLearner);

    // Collect every custom role, in the backend's own list order, whose name
    // matches one of `roles`. The /roles response can carry two rows for the
    // same name (a platform 'Admin' and an institute 'ADMIN'), so match
    // case-insensitively and keep only the first row per name — the user holds
    // one role, and two ids for it would union a config with itself.
    const matchIn = (roles: string[]): string[] => {
        const wanted = new Set(roles.map((r) => r.toUpperCase()));
        const takenNames = new Set<string>();
        const ids: string[] = [];
        customRoles.forEach((cr) => {
            if (!cr?.name) return;
            const name = cr.name.toUpperCase();
            if (!wanted.has(name) || takenNames.has(name)) return;
            takenNames.add(name);
            ids.push(String(cr.id));
        });
        return ids;
    };

    // Staff roles win outright over learner roles — a learner role must never
    // widen what a staff member sees in the admin portal.
    const staffMatches = matchIn(staffRoles);
    return staffMatches.length > 0 ? staffMatches : matchIn(learnerRoles);
};

/**
 * The display-settings key the admin portal should read for this user.
 * Extracted so both login paths (fresh login and institute selection) resolve
 * it identically, and so it is testable without the surrounding login flow.
 */
export const resolveDisplaySettingsRoleKey = (
    hasAdminRole: boolean,
    hasFaculty: boolean,
    userRoles: string[] | undefined,
    customRoles: Array<{ id: string | number; name: string }> | undefined
): string => {
    // ADMIN outranks everything: admins keep their own settings blob and must
    // never have a custom role merged into it.
    if (hasAdminRole) return ADMIN_DISPLAY_SETTINGS_KEY;
    if (!hasFaculty) return TEACHER_DISPLAY_SETTINGS_KEY;

    const roleIds = pickDisplaySettingsRoleIds(userRoles, customRoles);
    if (roleIds.length === 0) return CUSTOM_ROLE_DISPLAY_SETTINGS_KEY;
    return buildCustomRoleDisplaySettingsKey(roleIds);
};

export interface LoginFlowResult {
    success: boolean;
    shouldShowInstituteSelection?: boolean;
    shouldShowSubOrgSelection?: boolean;
    subOrgs?: SubOrgAccess[];
    redirectUrl?: string;
    error?: string;
    userRoles?: string[];
    primaryRole?: string;
    hasStudentRole?: boolean;
    hasAdminRole?: boolean;
}

export interface LoginFlowOptions {
    loginMethod:
    | 'username_password'
    | 'oauth'
    | 'email_otp'
    | 'phone_otp'
    | 'sso'
    | 'demo_account'
    | 'signup'
    | 'cookie_token';
    accessToken: string;
    refreshToken: string;
    queryClient?: Pick<QueryClient, 'clear'>;
}

/**
 * Centralized login flow handler for all authentication methods
 * Handles role checking, institute selection, and redirection logic
 */
export const handleLoginFlow = async (options: LoginFlowOptions): Promise<LoginFlowResult> => {
    const { loginMethod, accessToken, refreshToken, queryClient } = options;

    try {
        // Drop any previous user's faculty cache BEFORE setting the new tokens.
        // Without this, an abrupt prior session end (browser close, tab crash,
        // expired refresh) leaves `faculty_access_data` + `selected_suborg_id` in
        // localStorage — the sidebar then renders the previous user's sub-org
        // branding (logo + "Powered by …") even after the new account logs in.
        // Defensive — paired with the same removal in removeCookiesAndLogout.
        try {
            localStorage.removeItem('faculty_access_data');
            localStorage.removeItem('selected_suborg_id');
        } catch (_err) {
            /* best-effort */
        }

        // Set tokens in cookies
        setAuthorizationCookie(TokenKey.accessToken, accessToken);
        setAuthorizationCookie(TokenKey.refreshToken, refreshToken);

        // Small delay to allow token propagation to backend
        // This helps avoid 403 errors on the first authenticated API call
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Clear queries if queryClient is provided
        if (queryClient) {
            queryClient.clear();
        }

        // Identify user to Amplitude
        const { getTokenDecodedData } = await import('@/lib/auth/sessionUtility');
        const tokenData = getTokenDecodedData(accessToken);

        try {
            const userId = tokenData?.user as string | undefined;
            if (userId) {
                identifyUser(userId, {
                    login_method: loginMethod,
                    email: tokenData?.email ?? null,
                    username: tokenData?.username ?? null,
                });
            }
        } catch {
            // noop: analytics should not block login flow
        }

        // Get user roles from token
        const userRoles = getUserRoles(accessToken);

        // Check domain-specific role restrictions
        const cachedBranding = getCachedInstituteBranding();
        if (cachedBranding?.role === 'ADMIN') {
            // Domain requires ADMIN role - check if user has ADMIN role
            const hasAdminRole = userRoles.includes('ADMIN');

            if (!hasAdminRole) {
                // Track blocked login attempt
                trackEvent('Login Blocked', {
                    login_method: loginMethod,
                    reason: 'admin_role_required',
                    user_roles: userRoles,
                    required_role: 'ADMIN',
                    timestamp: new Date().toISOString(),
                });

                // Clear tokens and show error
                removeCookiesAndLogout();

                toast.error('Access Denied', {
                    description:
                        'This portal requires ADMIN privileges. Please contact your administrator.',
                    className: 'error-toast',
                    duration: 5000,
                });

                return {
                    success: false,
                    error: 'admin_role_required',
                    userRoles,
                };
            }
        }

        // Check if user should be blocked (only has STUDENT role)
        if (shouldBlockStudentLogin()) {
            // Track blocked login attempt
            trackEvent('Login Blocked', {
                login_method: loginMethod,
                reason: 'student_only_role',
                user_roles: userRoles,
                timestamp: new Date().toISOString(),
            });

            // Clear tokens and show error
            removeCookiesAndLogout();

            toast.error('Access Denied', {
                description:
                    'Students are not allowed to access the admin portal. Please contact your administrator.',
                className: 'error-toast',
                duration: 5000,
            });

            return {
                success: false,
                error: 'student_access_denied',
                userRoles,
            };
        }

        // Check institute selection requirements
        const instituteResult = getInstituteSelectionResult();

        if (instituteResult.shouldShowSelection) {
            // User needs to select an institute
            return {
                success: true,
                shouldShowInstituteSelection: true,
                userRoles,
            };
        }

        // User has only one institute or no valid institutes
        if (instituteResult.selectedInstitute) {
            const primaryRole = getPrimaryRole(instituteResult.selectedInstitute.roles);
            const hasStudentRole = instituteResult.selectedInstitute.roles.includes('STUDENT');
            const hasAdminRole = instituteResult.selectedInstitute.roles.includes('ADMIN');

            // Set the selected institute
            const instituteId = instituteResult.selectedInstitute.id;
            setSelectedInstitute(instituteId);

            // Faculty Access Check
            if (hasFacultyAssignedPermission(instituteId)) {
                // ── Portal-scoped login enforcement (sub-org tenant isolation) ──
                // A white-label SUB-ORG admin portal maps its domain to ONE sub-org via
                // `institute_domain_routing.sub_org_id`, surfaced as the resolved
                // branding's `subOrgId`. Every sub-org admin is really a PARENT-institute
                // user (same JWT + user_role), so the ONLY thing that tells, e.g., the VKE
                // portal apart from the Edvance portal is which sub-org the user is mapped
                // to in FSPSSM (processed.subOrgs). Without this, any Enark sub-org admin
                // can log in on any Enark sub-org portal. Rules:
                //   • mapped to THIS portal's sub-org → allow + auto-select it (works even
                //     if the user belongs to several sub-orgs — the portal disambiguates)
                //   • scoped to NO sub-org (parent-level admin or faculty) → allow to roam
                //   • a sub-org user on the WRONG portal → reject ("wrong portal")
                // If the access list can't be loaded we fail OPEN (log in as before) rather
                // than risk logging out a legitimate user on a transient error — the check
                // still applies on every successful load, which is the normal case.
                // Non-sub-org portals (parent / rows without sub_org_id) → portalSubOrgId
                // is null and the original selection behaviour runs unchanged.

                // Resolve the portal's sub-org identity. Prefer cached branding, but if it
                // is absent/stale (e.g. the tab was opened before this portal's sub_org_id
                // was set) fall back to a LIVE host re-resolve so a stale localStorage entry
                // can't silently disable the check below.
                let portalSubOrgId = getCachedInstituteBranding()?.subOrgId ?? null;
                if (!portalSubOrgId) {
                    try {
                        portalSubOrgId = (await resolveInstituteForCurrentHost())?.subOrgId ?? null;
                    } catch {
                        /* leave null — non-sub-org portal or resolve unavailable */
                    }
                }

                // Load the user's sub-org access. On failure `processed` stays null and the
                // check below fails OPEN (see comment above) — matching prior behaviour.
                let processed: ReturnType<typeof processAccessMappings> | null = null;
                try {
                    const userId = tokenData?.user as string;
                    if (userId) {
                        const accessDetails = await fetchUserAccessDetails(userId, instituteId);
                        processed = processAccessMappings(accessDetails.accessMappings);
                    }
                } catch (error) {
                    console.error('Faculty access initialization failed:', error);
                    // Continue with normal flow if faculty access check fails.
                }

                if (portalSubOrgId) {
                    const userSubOrgIds = processed ? processed.subOrgs.map((s) => s.subOrgId) : [];
                    const belongsToPortalSubOrg = userSubOrgIds.includes(portalSubOrgId);
                    // A user scoped to NO sub-org (parent-level admin or faculty) may roam any
                    // sub-org portal. When the access list failed to load, userSubOrgIds is
                    // empty here too, so we fail OPEN — same as the original behaviour — rather
                    // than log out a legitimate user on a transient fetch error.
                    const isUnrestrictedParentAdmin = userSubOrgIds.length === 0;

                    if (!belongsToPortalSubOrg && !isUnrestrictedParentAdmin) {
                        trackEvent('Login Blocked', {
                            login_method: loginMethod,
                            reason: 'suborg_portal_mismatch',
                            portal_sub_org_id: portalSubOrgId,
                            user_sub_org_ids: userSubOrgIds,
                            timestamp: new Date().toISOString(),
                        });

                        // Clear tokens and show error — foreign sub-org user.
                        removeCookiesAndLogout();

                        toast.error('Access Denied', {
                            description:
                                'These credentials don’t belong to this portal. Please sign in on your organization’s own login page.',
                            className: 'error-toast',
                            duration: 5000,
                        });

                        return {
                            success: false,
                            error: 'suborg_portal_mismatch',
                            userRoles,
                        };
                    }

                    if (processed) {
                        saveFacultyAccessData({
                            subOrgs: processed.subOrgs,
                            // On a sub-org portal the domain already picks the sub-org, so
                            // select it directly and skip the picker. Parent admins keep
                            // parent context (null).
                            selectedSubOrgId: belongsToPortalSubOrg ? portalSubOrgId : null,
                            globalPackageIds: processed.globalPackageIds,
                            globalPackageSessionIds: processed.globalPackageSessionIds,
                            permissions: processed.permissions,
                        });
                    }
                } else if (processed) {
                    if (processed.subOrgs.length > 1) {
                        saveFacultyAccessData({
                            subOrgs: processed.subOrgs,
                            selectedSubOrgId: null,
                            globalPackageIds: processed.globalPackageIds,
                            globalPackageSessionIds: processed.globalPackageSessionIds,
                            permissions: processed.permissions,
                        });
                        return {
                            success: true,
                            shouldShowSubOrgSelection: true,
                            subOrgs: processed.subOrgs,
                            userRoles,
                        };
                    } else if (processed.subOrgs.length === 1 && processed.subOrgs[0]) {
                        saveFacultyAccessData({
                            subOrgs: processed.subOrgs,
                            selectedSubOrgId: processed.subOrgs[0].subOrgId,
                            globalPackageIds: processed.globalPackageIds,
                            globalPackageSessionIds: processed.globalPackageSessionIds,
                            permissions: processed.permissions,
                        });
                    } else {
                        // No sub-orgs found, but might have global filters
                        saveFacultyAccessData({
                            subOrgs: processed.subOrgs,
                            selectedSubOrgId: null,
                            globalPackageIds: processed.globalPackageIds,
                            globalPackageSessionIds: processed.globalPackageSessionIds,
                            permissions: processed.permissions,
                        });
                    }
                }
            }

            // Refresh settings caches for this institute (non-blocking for course settings)
            void getCourseSettings(true).catch(() => { });

            // Determine redirect URL from Display Settings - fetch the correct role settings first
            const hasFaculty = hasFacultyAssignedPermission(instituteId);
            let roleKey: string = resolveDisplaySettingsRoleKey(
                hasAdminRole,
                hasFaculty,
                instituteResult.selectedInstitute?.roles,
                undefined
            );

            if (!hasAdminRole && hasFaculty) {
                try {
                    const { getAllRoles } = await import('@/routes/manage-custom-teams/-services/custom-team-services');
                    const customRoles = await getAllRoles();
                    roleKey = resolveDisplaySettingsRoleKey(
                        hasAdminRole,
                        hasFaculty,
                        instituteResult.selectedInstitute?.roles,
                        customRoles
                    );
                } catch (err) {
                    console.error('Failed to map custom role for display settings', err);
                }
            }

            // Save the determined role key so other components can access it synchronously
            localStorage.setItem('ACTIVE_ROLE_DISPLAY_SETTINGS_KEY', roleKey);

            // Use cache-first approach for display settings to avoid blocking login
            // First try to use cached settings for immediate redirect
            let ds: DisplaySettingsData | null = getDisplaySettingsFromCache(roleKey);

            if (ds) {
                console.log(
                    '🔍 LOGIN DEBUG: Using cached display settings for immediate redirect:',
                    {
                        roleKey,
                        postLoginRedirectRoute: ds?.postLoginRedirectRoute,
                    }
                );
                // Trigger background refresh (non-blocking)
                void getDisplaySettings(roleKey, true).catch(() => { });
            } else {
                // No cache available, need to fetch with reduced retry delay
                const maxRetries = 3;
                let retryCount = 0;

                while (retryCount < maxRetries && !ds) {
                    try {
                        console.log(
                            `🔍 LOGIN DEBUG: Fetching display settings for role: ${roleKey} (attempt ${retryCount + 1}/${maxRetries})`
                        );
                        ds = await getDisplaySettings(roleKey, true);
                        console.log('🔍 LOGIN DEBUG: Display settings fetched successfully:', {
                            roleKey,
                            postLoginRedirectRoute: ds?.postLoginRedirectRoute,
                            attempt: retryCount + 1,
                        });
                        break; // Success, exit retry loop
                    } catch (error) {
                        retryCount++;
                        const errorStatus = (error as { response?: { status?: number } })?.response
                            ?.status;
                        console.warn(
                            `🔍 LOGIN DEBUG: Failed to fetch display settings (attempt ${retryCount}/${maxRetries}) [Status: ${errorStatus}]:`,
                            error
                        );

                        if (retryCount >= maxRetries) {
                            // Final attempt failed, use defaults
                            console.log(
                                '🔍 LOGIN DEBUG: All retries failed, using default redirect'
                            );
                            break;
                        } else {
                            // Wait before retry (reduced exponential backoff: 200ms, 400ms, 800ms)
                            const delay = Math.pow(2, retryCount - 1) * 200;
                            console.log(`🔍 LOGIN DEBUG: Retrying in ${delay}ms...`);
                            await new Promise((resolve) => setTimeout(resolve, delay));
                        }
                    }
                }
            }

            // Priority: role-specific Display Settings postLoginRedirectRoute (when explicitly
            // saved by an admin) wins over domain branding's afterLoginRoute. Domain branding
            // is only used as a fallback when the role's postLoginRedirectRoute isn't set.
            const cachedBrandingOverride = getCachedInstituteBranding(instituteResult.selectedInstitute.id);
            let redirectUrl =
                ds?.postLoginRedirectRoute ||
                cachedBrandingOverride?.afterLoginRoute ||
                '/dashboard';
            // If the candidate redirect lands in a sidebar category the role can't see
            // (e.g. /dashboard for a role with CRM hidden), reroute to the default visible
            // category's first visible tab so the sidebar and content stay in sync.
            redirectUrl = resolveEffectivePostLoginRoute(redirectUrl, ds);
            // Shop-only staff (commerce roles and nothing else) start in the shop:
            // a cashier at POS, everyone else at Commerce Home.
            redirectUrl = commerceStaffLandingRoute(
                instituteResult.selectedInstitute?.roles,
                redirectUrl
            );
            console.log('🔍 LOGIN DEBUG: Determined redirect URL:', {
                postLoginRedirectRoute: ds?.postLoginRedirectRoute,
                domainAfterLoginRoute: cachedBrandingOverride?.afterLoginRoute,
                finalRedirectUrl: redirectUrl,
                roleKey,
                hasAdminRole,
            });

            return {
                success: true,
                redirectUrl,
                userRoles,
                primaryRole,
                hasStudentRole,
                hasAdminRole,
            };
        }

        // Fallback - navigate to dashboard or afterLoginRoute
        console.log('🔍 LOGIN DEBUG: Using fallback redirect logic (no selected institute)');
        const fallbackCachedResult = getCachedInstituteBranding(); // Fallback might not have an ID context readily available unless we guess
        const fallbackUrl = fallbackCachedResult?.afterLoginRoute || '/dashboard';
        console.log('🔍 LOGIN DEBUG: Fallback redirect URL:', {
            domainAfterLoginRoute: fallbackCachedResult?.afterLoginRoute,
            finalFallbackUrl: fallbackUrl,
        });
        return {
            success: true,
            redirectUrl: fallbackUrl,
            userRoles,
        };
    } catch (error) {
        trackEvent('Login Failed', {
            login_method: loginMethod,
            error_reason: 'login_flow_error',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString(),
        });

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Login flow failed',
        };
    }
};

/**
 * Handle institute selection and redirect accordingly
 */
export const handleInstituteSelection = async (instituteId: string): Promise<LoginFlowResult> => {
    try {
        const institutes = getInstitutesFromToken();
        const selectedInstitute = institutes.find((inst) => inst.id === instituteId);

        if (!selectedInstitute) {
            return {
                success: false,
                error: 'Institute not found',
            };
        }

        const primaryRole = getPrimaryRole(selectedInstitute.roles);
        const hasStudentRole = selectedInstitute.roles.includes('STUDENT');
        const hasAdminRole = selectedInstitute.roles.includes('ADMIN');
        const userRoles = getUserRoles(getTokenFromCookie(TokenKey.accessToken));

        // Check domain-specific role restrictions
        const cachedBranding = getCachedInstituteBranding(instituteId);
        if (cachedBranding?.role === 'ADMIN') {
            // Domain requires ADMIN role - check if user has ADMIN role
            if (!hasAdminRole) {
                // Track blocked login attempt
                trackEvent('Login Blocked', {
                    login_method: 'institute_selection',
                    reason: 'admin_role_required',
                    user_roles: userRoles,
                    required_role: 'ADMIN',
                    institute_id: instituteId,
                    timestamp: new Date().toISOString(),
                });

                return {
                    success: false,
                    error: 'admin_role_required',
                    userRoles,
                };
            }
        }

        // Set the selected institute
        setSelectedInstitute(instituteId);

        // Faculty Access Check — mirrors handleLoginFlow (see the detailed comment
        // there). The portal's sub-org id is re-resolved live if the cached branding
        // lacks it; a failed access fetch fails OPEN (logs in as before).
        if (hasFacultyAssignedPermission(instituteId)) {
            let portalSubOrgId = cachedBranding?.subOrgId ?? null;
            if (!portalSubOrgId) {
                try {
                    portalSubOrgId = (await resolveInstituteForCurrentHost())?.subOrgId ?? null;
                } catch {
                    /* leave null — non-sub-org portal or resolve unavailable */
                }
            }

            let processed: ReturnType<typeof processAccessMappings> | null = null;
            try {
                const accessToken = getTokenFromCookie(TokenKey.accessToken);
                const { getTokenDecodedData } = await import('@/lib/auth/sessionUtility');
                const tData = getTokenDecodedData(accessToken);
                if (tData?.user) {
                    const accessDetails = await fetchUserAccessDetails(tData.user as string, instituteId);
                    processed = processAccessMappings(accessDetails.accessMappings);
                }
            } catch (error) {
                console.error('Faculty access initialization failed in institute selection:', error);
                // Continue with normal flow if faculty access check fails.
            }

            if (portalSubOrgId) {
                const userSubOrgIds = processed ? processed.subOrgs.map((s) => s.subOrgId) : [];
                const belongsToPortalSubOrg = userSubOrgIds.includes(portalSubOrgId);
                // See handleLoginFlow: parent-level users (no sub-org) roam; a failed access
                // load fails OPEN (empty list) rather than logging out a legitimate user.
                const isUnrestrictedParentAdmin = userSubOrgIds.length === 0;

                if (!belongsToPortalSubOrg && !isUnrestrictedParentAdmin) {
                    trackEvent('Login Blocked', {
                        login_method: 'institute_selection',
                        reason: 'suborg_portal_mismatch',
                        portal_sub_org_id: portalSubOrgId,
                        user_sub_org_ids: userSubOrgIds,
                        institute_id: instituteId,
                        timestamp: new Date().toISOString(),
                    });

                    removeCookiesAndLogout();

                    toast.error('Access Denied', {
                        description:
                            'These credentials don’t belong to this portal. Please sign in on your organization’s own login page.',
                        className: 'error-toast',
                        duration: 5000,
                    });

                    return {
                        success: false,
                        error: 'suborg_portal_mismatch',
                        userRoles,
                    };
                }

                if (processed) {
                    saveFacultyAccessData({
                        subOrgs: processed.subOrgs,
                        selectedSubOrgId: belongsToPortalSubOrg ? portalSubOrgId : null,
                        globalPackageIds: processed.globalPackageIds,
                        globalPackageSessionIds: processed.globalPackageSessionIds,
                        permissions: processed.permissions,
                    });
                }
            } else if (processed) {
                if (processed.subOrgs.length > 1) {
                    saveFacultyAccessData({
                        subOrgs: processed.subOrgs,
                        selectedSubOrgId: null,
                        globalPackageIds: processed.globalPackageIds,
                        globalPackageSessionIds: processed.globalPackageSessionIds,
                        permissions: processed.permissions,
                    });
                    return {
                        success: true,
                        shouldShowSubOrgSelection: true,
                        subOrgs: processed.subOrgs,
                        userRoles,
                    };
                } else if (processed.subOrgs.length === 1 && processed.subOrgs[0]) {
                    saveFacultyAccessData({
                        subOrgs: processed.subOrgs,
                        selectedSubOrgId: processed.subOrgs[0].subOrgId,
                        globalPackageIds: processed.globalPackageIds,
                        globalPackageSessionIds: processed.globalPackageSessionIds,
                        permissions: processed.permissions,
                    });
                } else {
                    // No sub-orgs found, but might have global filters
                    saveFacultyAccessData({
                        subOrgs: processed.subOrgs,
                        selectedSubOrgId: null,
                        globalPackageIds: processed.globalPackageIds,
                        globalPackageSessionIds: processed.globalPackageSessionIds,
                        permissions: processed.permissions,
                    });
                }
            }
        }

        // Refresh settings caches for this institute (non-blocking for course settings)
        void getCourseSettings(true).catch(() => { });

        // Determine redirect URL from Display Settings - fetch the correct role settings first
        const hasFaculty = hasFacultyAssignedPermission(instituteId);
        let roleKey: string = resolveDisplaySettingsRoleKey(
            hasAdminRole,
            hasFaculty,
            selectedInstitute?.roles,
            undefined
        );

        if (!hasAdminRole && hasFaculty) {
            try {
                const { getAllRoles } = await import('@/routes/manage-custom-teams/-services/custom-team-services');
                const customRoles = await getAllRoles();
                roleKey = resolveDisplaySettingsRoleKey(
                    hasAdminRole,
                    hasFaculty,
                    selectedInstitute?.roles,
                    customRoles
                );
            } catch (err) {
                console.error('Failed to map custom role for display settings', err);
            }
        }

        // Save the determined role key so other components can access it synchronously
        localStorage.setItem('ACTIVE_ROLE_DISPLAY_SETTINGS_KEY', roleKey);

        // Use cache-first approach for display settings to avoid blocking
        let ds: DisplaySettingsData | null = getDisplaySettingsFromCache(roleKey);

        if (ds) {
            console.log(
                '🔍 INSTITUTE DEBUG: Using cached display settings for immediate redirect:',
                {
                    roleKey,
                    postLoginRedirectRoute: ds?.postLoginRedirectRoute,
                }
            );
            // Trigger background refresh (non-blocking)
            void getDisplaySettings(roleKey, true).catch(() => { });
        } else {
            // No cache available, need to fetch with reduced retry delay
            const maxRetries = 3;
            let retryCount = 0;

            while (retryCount < maxRetries && !ds) {
                try {
                    console.log(
                        `🔍 INSTITUTE DEBUG: Fetching display settings for role: ${roleKey} (attempt ${retryCount + 1}/${maxRetries})`
                    );
                    ds = await getDisplaySettings(roleKey, true);
                    console.log('🔍 INSTITUTE DEBUG: Display settings fetched successfully:', {
                        roleKey,
                        postLoginRedirectRoute: ds?.postLoginRedirectRoute,
                        attempt: retryCount + 1,
                    });
                    break; // Success, exit retry loop
                } catch (error) {
                    retryCount++;
                    console.warn(
                        `🔍 INSTITUTE DEBUG: Failed to fetch display settings (attempt ${retryCount}/${maxRetries}):`,
                        error
                    );

                    if (retryCount >= maxRetries) {
                        // Final attempt failed, use defaults
                        console.log(
                            '🔍 INSTITUTE DEBUG: All retries failed, using default redirect'
                        );
                        break;
                    } else {
                        // Wait before retry (reduced exponential backoff: 200ms, 400ms, 800ms)
                        const delay = Math.pow(2, retryCount - 1) * 200;
                        console.log(`🔍 INSTITUTE DEBUG: Retrying in ${delay}ms...`);
                        await new Promise((resolve) => setTimeout(resolve, delay));
                    }
                }
            }
        }

        // Priority: role-specific Display Settings postLoginRedirectRoute (explicitly saved by
        // an admin) wins over domain branding's afterLoginRoute. afterLoginRoute is the fallback
        // when the role has no postLoginRedirectRoute configured.
        const cached = getCachedInstituteBranding(instituteId);
        let redirectUrl =
            ds?.postLoginRedirectRoute || cached?.afterLoginRoute || '/dashboard';
        // Reroute away from hidden sidebar categories so the sidebar and page content match.
        redirectUrl = resolveEffectivePostLoginRoute(redirectUrl, ds);
        // Shop-only staff start in the shop (see the same call in the login flow).
        redirectUrl = commerceStaffLandingRoute(selectedInstitute.roles, redirectUrl);

        // Preserve learner tab hint if user also has STUDENT role and route points to dashboard
        if (
            hasStudentRole &&
            selectedInstitute.roles.length > 1 &&
            (redirectUrl === '/dashboard' || redirectUrl.startsWith('/dashboard?'))
        ) {
            redirectUrl = '/dashboard?showLearnerTab=true';
        }

        return {
            success: true,
            redirectUrl,
            userRoles,
            primaryRole,
            hasStudentRole,
            hasAdminRole,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Institute selection failed',
        };
    }
};

/**
 * Navigate to the appropriate URL based on login flow result
 */
export const navigateFromLoginFlow = (result: LoginFlowResult): void => {
    if (!result.success) {
        return;
    }

    if (result.shouldShowInstituteSelection) {
        // Redirect to institute selection page
        window.location.href = '/login?showInstituteSelection=true';
        return;
    }

    if (result.shouldShowSubOrgSelection) {
        // Redirect to sub-org selection page
        window.location.href = '/login?showSubOrgSelection=true';
        return;
    }

    if (result.redirectUrl) {
        // Navigate to the determined URL
        window.location.href = result.redirectUrl;
        return;
    }

    // Fallback to dashboard
    window.location.href = '/dashboard';
};
