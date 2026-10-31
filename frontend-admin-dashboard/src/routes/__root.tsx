import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getInstituteId } from '@/constants/helper';
import { hasFacultyAssignedPermission } from '@/lib/auth/facultyAccessUtils';
import { SmartErrorPage } from '@/components/core/SmartErrorPage';
import { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet, redirect } from '@tanstack/react-router';
import React, { Suspense } from 'react';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { usePageTitle } from '@/hooks/use-page-title';
import {
    getTokenFromCookie,
    isTokenExpired,
    setAuthorizationCookie,
} from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { getUserRoles } from '@/lib/auth/sessionUtility';
import { ADMIN_DISPLAY_SETTINGS_KEY, TEACHER_DISPLAY_SETTINGS_KEY, CUSTOM_ROLE_DISPLAY_SETTINGS_KEY } from '@/types/display-settings';
import {
    getDisplaySettingsFromCache,
    resolveEffectivePostLoginRoute,
} from '@/services/display-settings';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { VacademyAssistant } from '@/components/vacademy-assistant/VacademyAssistant';
import { AssistDock } from '@/components/assist-dock/AssistDock';
import { FollowUpReminderDialog } from '@/components/shared/leads/followup-reminders';
import { QuickSettingsDialog } from '@/components/settings/quick-access/QuickSettingsDialog';

const TanStackRouterDevtools =
    process.env.NODE_ENV === 'production'
        ? () => null
        : React.lazy(() =>
            import('@tanstack/router-devtools')
                .then((res) => ({
                    default: res.TanStackRouterDevtools,
                }))
                .catch(() => ({
                    default: () => null,
                }))
        );

const isAuthenticated = () => {
    const accessToken = getTokenFromCookie(TokenKey.accessToken);
    const refreshToken = getTokenFromCookie(TokenKey.refreshToken);
    return accessToken && refreshToken && !isTokenExpired(accessToken);
};

// Function to handle SSO tokens from URL parameters
const handleSSOTokens = (search: string) => {
    const searchParams = new URLSearchParams(search);
    const accessToken = searchParams.get('accessToken');
    const refreshToken = searchParams.get('refreshToken');

    if (accessToken && refreshToken) {
        // Store tokens in cookies
        setAuthorizationCookie(TokenKey.accessToken, accessToken);
        setAuthorizationCookie(TokenKey.refreshToken, refreshToken);
        return true;
    }

    return false;
};

// List of public routes that don't require authentication
const publicRoutes = [
    '/login',
    '/login/forgot-password',
    '/login/oauth/redirect',
    '/signup',
    '/landing',
    '/pricing',
    '/content',
    '/vim/onboarding',
    '/vim/login',
    '/vim/waitlist',
    // MCP OAuth consent: the visitor arrives from an AI client and may not be
    // signed in yet. The guard below forwards only a pathname, which would drop
    // the ?txn= handle, so the page handles sign-in itself (it stashes the txn
    // first). Nothing is granted without a verified session on the backend.
    '/mcp/authorize',
];

const isVimotionHost = () =>
    typeof window !== 'undefined' &&
    window.location.hostname.toLowerCase().includes('vimotion');

// Helper functions to break down the complex beforeLoad logic
const handleRootPathRedirect = (location: any) => {
    if (location.pathname === '/') {
        if (isVimotionHost()) {
            throw redirect({ to: '/vim' });
        }
        const subdomain =
            typeof window !== 'undefined' ? window.location.hostname.split('.')[0] : '';
        const isVoltSubdomain = subdomain === 'volt';
        throw redirect({ to: isVoltSubdomain ? '/landing' : '/login' });
    }
};

// Removed: let /auth-transfer route handle token processing and redirect itself

const handleAuthenticationChecks = (location: any) => {
    // Check if the route requires authentication
    const isPublicRoute = publicRoutes.some((route) => location.pathname.startsWith(route));

    // If it's not a public route and user is not authenticated,
    // redirect to login with the intended destination. Vim shell paths
    // (/vim, /vim/dashboard, /vim/edit/...) belong to a separate product
    // surface — sending unauth users to the admin /login would punt them
    // out of the vim shell entirely, so route them to /vim/login instead.
    if (!isPublicRoute && !isAuthenticated()) {
        const isVimRoute =
            location.pathname === '/vim' || location.pathname.startsWith('/vim/');
        throw redirect({
            to: isVimRoute ? '/vim/login' : '/login',
            search: {
                redirect: location.pathname,
            },
        });
    }
};

const handleAuthenticatedUserLoginAccess = (location: any) => {
    // If user is authenticated and tries to access login page,
    // check for redirect parameter and handle accordingly (unless showing institute selection)
    if (isAuthenticated() && location.pathname.startsWith('/login')) {
        // Also check if search is an object with the parameter
        if (
            typeof location.search === 'object' &&
            location.search &&
            'showInstituteSelection' in location.search
        ) {
            return;
        }

        const searchParams = new URLSearchParams(location.search);
        const redirectParam = searchParams.get('redirect');

        if (redirectParam === '/auth-transfer') {
            // If redirecting to auth-transfer, go to study library instead
            throw redirect({ to: '/study-library/courses' });
        } else if (redirectParam && redirectParam.startsWith('/')) {
            // If there's a valid redirect parameter, use it
            throw redirect({ to: redirectParam as string });
        } else {
            // Default redirect based on role display settings if available
            const accessToken = getTokenFromCookie(TokenKey.accessToken);
            const roles = getUserRoles(accessToken);
            const isAdminRole = roles.includes('ADMIN');
            const hasFaculty = hasFacultyAssignedPermission(getInstituteId());
    const roleKey = getActiveRoleDisplaySettingsKey();
            const fromCache = getDisplaySettingsFromCache(roleKey);
            const candidate = fromCache?.postLoginRedirectRoute || '/dashboard';
            const to = resolveEffectivePostLoginRoute(candidate, fromCache);
            throw redirect({ to });
        }
    }
};

export const Route = createRootRouteWithContext<{
    queryClient: QueryClient;
}>()({
    beforeLoad: ({ location }) => {
        // Special handling for OAuth redirect - don't set tokens here, let the OAuth component handle it
        if (location.pathname === '/login/oauth/redirect') {
            return; // Allow the OAuth redirect component to handle the flow
        }

        // Handle SSO tokens from URL parameters for other routes
        handleSSOTokens((location.search as string) || '');

        // Handle root path redirect
        handleRootPathRedirect(location);

        // Let the /auth-transfer route component handle token processing and redirects itself

        // Handle authentication checks
        handleAuthenticationChecks(location);

        // Handle authenticated user accessing login page
        handleAuthenticatedUserLoginAccess(location);
    },

    component: () => {
        // Ensure the global title is maintained across all pages
        usePageTitle();
        // Boot the FCM lifecycle (service worker + token registration + foreground listener).
        // No-ops silently when notification permission hasn't been granted yet — UI should expose
        // a button that calls the returned `ensurePermission` from this hook to prompt.
        usePushNotifications();

        return (
            <>
                <Outlet />
                <AssistDock />
                <VacademyAssistant />
                {/* Global centered follow-up reminder — pops when one is due. */}
                <FollowUpReminderDialog />
                {/* Quick-access settings popup — inert until a caller opens one. */}
                <QuickSettingsDialog />
                <Suspense>
                    <TanStackRouterDevtools />
                </Suspense>
                <ReactQueryDevtools initialIsOpen={false} />
            </>
        );
    },
    errorComponent: SmartErrorPage,
});
