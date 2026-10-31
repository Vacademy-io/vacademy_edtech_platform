import { getActiveRoleDisplaySettingsKey } from '@/lib/auth/instituteUtils';
import { getInstituteId } from '@/constants/helper';
import { hasFacultyAssignedPermission } from '@/lib/auth/facultyAccessUtils';
import { MyInput } from '@/components/design-system/input';
import { MyButton } from '@/components/design-system/button';
import { Link } from '@tanstack/react-router';
import { loginSchema } from '@/schemas/login/login';
import { useEffect } from 'react';
// Removed split-screen splash layout to center the login component
import { loginUser, loginResponseSchema } from '@/hooks/login/login-button';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAnimationStore } from '@/stores/login/animationStore';
import { toast } from 'sonner';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Form, FormControl, FormField, FormItem } from '@/components/ui/form';
import { useNavigate } from '@tanstack/react-router';
import { handleSSOLogin } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { handleOAuthLogin } from '@/hooks/login/oauth-login';
import { GitHubIcon } from '@/components/icons/GitHubIcon';
import { GoogleIcon } from '@/components/icons/GoogleIcon';
import { EmailLogin } from './EmailOtpForm';
import { PhoneLoginForm } from './PhoneLoginForm';
import { useState } from 'react';
import { amplitudeEvents, trackEvent } from '@/lib/amplitude';
import { InstituteSelection } from './InstituteSelection';
import { SubOrgSelection } from './SubOrgSelection';
import { getInstituteSelectionResult, setSelectedInstitute } from '@/lib/auth/instituteUtils';
import { getTokenFromCookie, getUserRoles } from '@/lib/auth/sessionUtility';
import { handleLoginFlow } from '@/lib/auth/loginFlowHandler';
import {
    cacheInstituteBranding,
    getCachedInstituteBranding,
    getPublicUrl,
    resolveInstituteForCurrentHost,
    resolveInstituteForDomain,
    type DomainResolveResponse,
} from '@/services/domain-routing';
import { getFlavor, isNative } from '@/native';
import useInstituteLogoStore from '@/components/common/layout-container/sidebar/institutelogo-global-zustand';
import {
    getDisplaySettings,
    getDisplaySettingsFromCache,
    resolveEffectivePostLoginRoute,
} from '@/services/display-settings';
import { ADMIN_DISPLAY_SETTINGS_KEY, TEACHER_DISPLAY_SETTINGS_KEY, CUSTOM_ROLE_DISPLAY_SETTINGS_KEY } from '@/types/display-settings';

type FormValues = z.infer<typeof loginSchema>;

// Rejection error codes for which handleLoginFlow already shows its OWN specific
// toast (admin-role required / student blocked / wrong sub-org portal). Callers
// must not stack a second, generic toast on top of these.
const isHandledLoginError = (error?: string): boolean =>
    error === 'admin_role_required' ||
    error === 'student_access_denied' ||
    error === 'suborg_portal_mismatch';

/**
 * Computes which auth providers to show from resolved domain-routing branding,
 * mirroring the learner login semantics: OAuth / email-OTP / username-password
 * are shown unless the institute explicitly disabled them (`=== false`), while
 * phone login is opt-in (shown only when explicitly enabled). A missing object
 * (no institute configured) falls back to the generic Vacademy providers.
 */
function resolveAuthProviderFlags(branding: Partial<DomainResolveResponse> | null | undefined) {
    return {
        allowGoogleAuth: branding?.allowGoogleAuth !== false,
        allowGithubAuth: branding?.allowGithubAuth !== false,
        allowEmailOtpAuth: branding?.allowEmailOtpAuth !== false,
        allowUsernamePasswordAuth: branding?.allowUsernamePasswordAuth !== false,
        allowPhoneAuth: branding?.allowPhoneAuth === true,
    };
}

export function LoginForm() {
    const { t } = useTranslation('loginLoginForm');
    const queryClient = useQueryClient();
    const { hasSeenAnimation, setHasSeenAnimation } = useAnimationStore();
    const navigate = useNavigate();
    const { instituteLogo } = useInstituteLogoStore();
    // Branding must be STATE, not a bare localStorage read: logout wipes
    // localStorage (clearWebStorage) and the router then redirects to /login
    // CLIENT-SIDE, so index.tsx's bootstrap never re-runs and this read returns
    // null — which silently dropped the institute name and the T&C/Privacy
    // footer while the logo (held in the in-memory zustand store) stayed put.
    // The live re-resolve effect below refills it.
    const [cachedBranding, setCachedBranding] = useState<
        ReturnType<typeof getCachedInstituteBranding>
    >(() => getCachedInstituteBranding());
    const instituteName = cachedBranding?.instituteName;
    const portalRoleLabel = cachedBranding?.role === 'TEACHER' ? 'Teacher' : 'Admin';
    const portalInstitute = instituteName || 'Vacademy';
    const [authMethod, setAuthMethod] = useState<'EMAIL' | 'USERNAME' | 'PHONE'>('USERNAME');
    // Seed from cached branding so the first paint already reflects the institute's
    // configured providers (no flash of all buttons); the live re-resolve below
    // then corrects any stale/missing cache.
    const [providerFlags, setProviderFlags] = useState(() =>
        resolveAuthProviderFlags(getCachedInstituteBranding())
    );
    const [allowSignup, setAllowSignup] = useState(false);
    const [showInstituteSelection, setShowInstituteSelection] = useState(false);
    const [showSubOrgSelection, setShowSubOrgSelection] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            username: '',
            password: '',
        },
        mode: 'onTouched',
    });

    useEffect(() => {
        if (!hasSeenAnimation) {
            setTimeout(() => {
                setHasSeenAnimation();
            }, 8000);
        }
    }, [hasSeenAnimation, setHasSeenAnimation]);

    useEffect(() => {
        // Initialize auth provider toggles and signup visibility from cached branding
        try {
            const cached = getCachedInstituteBranding();
            if (cached) {
                setProviderFlags(resolveAuthProviderFlags(cached));
                setAllowSignup(cached.allowSignup !== false);

                // Prefer email login if username/password is disabled
                if (
                    cached.allowUsernamePasswordAuth === false &&
                    cached.allowEmailOtpAuth !== false
                ) {
                    setAuthMethod('EMAIL');
                } else if (
                    cached.allowUsernamePasswordAuth === false &&
                    cached.allowEmailOtpAuth === false &&
                    cached.allowPhoneAuth === true
                ) {
                    setAuthMethod('PHONE');
                }
            }
        } catch (_e) {
            // ignore
        }

        // Check for error parameters from OAuth
        const urlParams = new URLSearchParams(window.location.search);
        const error = urlParams.get('error');
        const showInstituteSelection = urlParams.get('showInstituteSelection');
        const showSubOrgSelection = urlParams.get('showSubOrgSelection');

        if (error === 'student_access_denied') {
            toast.error(t('errors.accessDeniedTitle'), {
                description: t('errors.studentAccessDenied'),
                className: 'error-toast',
                duration: 5000,
            });
            return;
        }

        if (error === 'admin_role_required') {
            toast.error(t('errors.accessDeniedTitle'), {
                description: t('errors.adminRoleRequired'),
                className: 'error-toast',
                duration: 5000,
            });
            return;
        }

        // Check if we should show institute selection from URL parameter
        if (showInstituteSelection === 'true') {
            setShowInstituteSelection(true);
            return;
        }

        // Check if we should show sub-org selection from URL parameter
        if (showSubOrgSelection === 'true') {
            setShowSubOrgSelection(true);
            return;
        }

        // Handle SSO login from URL parameters
        const ssoLoginSuccess = handleSSOLogin();

        if (ssoLoginSuccess) {
            // Track SSO login success
            amplitudeEvents.signIn('sso');
            trackEvent('Login Success', {
                login_method: 'sso',
                timestamp: new Date().toISOString(),
            });

            // Use centralized login flow for SSO
            const cookieAccessToken = getTokenFromCookie(TokenKey.accessToken);
            const cookieRefreshToken = getTokenFromCookie(TokenKey.refreshToken);

            if (cookieAccessToken && cookieRefreshToken) {
                setTimeout(async () => {
                    try {
                        const result = await handleLoginFlow({
                            loginMethod: 'sso',
                            accessToken: cookieAccessToken,
                            refreshToken: cookieRefreshToken,
                            queryClient,
                        });

                        if (!result.success) {
                            // handleLoginFlow already toasts its own rejection reasons —
                            // don't stack a second (previously wrong) toast on top.
                            if (!isHandledLoginError(result.error)) {
                                toast.error(t('errors.accessDeniedTitle'), {
                                    description: t('errors.notAllowedPortal'),
                                    className: 'error-toast',
                                    duration: 5000,
                                });
                            }
                            return;
                        }

                        if (result.shouldShowInstituteSelection) {
                            setShowInstituteSelection(true);
                            return;
                        }

                        if (result.shouldShowSubOrgSelection) {
                            setShowSubOrgSelection(true);
                            return;
                        }

                        const redirectUrl = result.redirectUrl || '/dashboard';
                        navigate({ to: redirectUrl });
                    } catch (error) {
                        console.error('SSO login flow error:', error);
                        toast.error(t('errors.loginFailedRetry'));
                    }
                }, 100);
            }
            return;
        }

        const accessToken = urlParams.get('accessToken');
        const refreshToken = urlParams.get('refreshToken');

        if (accessToken && refreshToken) {
            // Use centralized login flow for OAuth
            setTimeout(async () => {
                try {
                    const result = await handleLoginFlow({
                        loginMethod: 'oauth',
                        accessToken,
                        refreshToken,
                        queryClient,
                    });

                    if (!result.success) {
                        // handleLoginFlow already toasts its own rejection reasons —
                        // don't stack a second (previously wrong) toast on top.
                        if (!isHandledLoginError(result.error)) {
                            toast.error(t('errors.accessDeniedTitle'), {
                                description: t('errors.notAllowedPortal'),
                                className: 'error-toast',
                                duration: 5000,
                            });
                        }
                        return;
                    }

                    if (result.shouldShowInstituteSelection) {
                        setShowInstituteSelection(true);
                        return;
                    }

                    if (result.shouldShowSubOrgSelection) {
                        setShowSubOrgSelection(true);
                        return;
                    }

                    const redirectUrl = result.redirectUrl || '/dashboard';
                    navigate({ to: redirectUrl });
                } catch (error) {
                    console.error('OAuth login flow error:', error);
                    toast.error(t('errors.loginFailedRetry'));
                }
            }, 100);
        } else {
            // Check if we have tokens in cookies and need to show institute selection
            const cookieAccessToken = getTokenFromCookie(TokenKey.accessToken);
            if (cookieAccessToken) {
                // Check if user needs to select an institute
                const instituteResult = getInstituteSelectionResult();

                if (instituteResult.shouldShowSelection) {
                    setShowInstituteSelection(true);
                    return;
                }
            }
        }
    }, [navigate, queryClient]);

    // Re-resolve the LIVE domain-routing branding + flags on the login page. The
    // cached branding read above can be stale, missing (logout wipes localStorage
    // and the redirect to /login is client-side, so index.tsx never re-runs) or
    // predate the auth flags (e.g. written by an older build), which would
    // otherwise leave OAuth buttons visible even after the institute disabled
    // them. Resolving fresh guarantees an explicit `false` always wins — matching
    // the learner login, which gates providers on the freshly-resolved institute
    // settings — and that the institute name / T&C links always render.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                // Only native flavors resolve by a FIXED domain/subdomain; the
                // web build must resolve by the request host. The default flavor
                // ('vacademy-admin') carries a fixed brandingDomain, so without
                // the isNative() guard web hosts would wrongly resolve
                // vacademy.io/admin-app → Vacademy CRM. Mirrors index.tsx.
                const flavor = getFlavor();
                const live =
                    isNative() && flavor.brandingDomain && flavor.brandingSubdomain
                        ? await resolveInstituteForDomain(
                              flavor.brandingDomain!,
                              flavor.brandingSubdomain!
                          )
                        : await resolveInstituteForCurrentHost();
                if (cancelled || !live) return;

                // Live wins over whatever the cache held, so a toggle flipped in
                // Settings (e.g. hideInstituteName) shows up without a hard reload.
                setCachedBranding((prev) => (prev ? { ...prev, ...live } : live));

                const store = useInstituteLogoStore.getState();
                store.setBrandingDisplay({
                    hideInstituteName: live.hideInstituteName === true,
                    logoWidthPx: typeof live.logoWidthPx === 'number' ? live.logoWidthPx : null,
                    logoHeightPx: typeof live.logoHeightPx === 'number' ? live.logoHeightPx : null,
                    stackNameBelowLogo: live.stackNameBelowLogo === true,
                });

                setProviderFlags(resolveAuthProviderFlags(live));
                setAllowSignup(live.allowSignup !== false);
                if (live.allowUsernamePasswordAuth === false && live.allowEmailOtpAuth !== false) {
                    setAuthMethod('EMAIL');
                } else if (
                    live.allowUsernamePasswordAuth === false &&
                    live.allowEmailOtpAuth === false &&
                    live.allowPhoneAuth === true
                ) {
                    setAuthMethod('PHONE');
                }

                // Cold/wiped storage (post-logout): refill it so the pre-paint
                // favicon/title script and the rest of the app see branding again,
                // and restore the logo if the in-memory store lost it too. Not
                // marked as the selected institute — login still resolves the
                // signed-in user's own institute.
                if (!getCachedInstituteBranding()) {
                    const [logoUrl, iconUrl] = await Promise.all([
                        getPublicUrl(live.instituteLogoFileId),
                        getPublicUrl(live.tabIconFileId),
                    ]);
                    if (cancelled) return;
                    cacheInstituteBranding(
                        live.instituteId,
                        {
                            ...live,
                            instituteLogoUrl: logoUrl || undefined,
                            tabIconUrl: iconUrl || undefined,
                        },
                        { setSelectedInstitute: false }
                    );
                    if (logoUrl && !useInstituteLogoStore.getState().instituteLogo) {
                        useInstituteLogoStore.getState().setInstituteLogo(logoUrl);
                    }
                }
            } catch {
                // ignore — keep the cached/default flags
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const handlePostLoginRedirect = async (accessToken: string, refreshToken: string) => {
        try {
            // Use centralized login flow
            const result = await handleLoginFlow({
                loginMethod: 'username_password',
                accessToken,
                refreshToken,
                queryClient,
            });

            if (!result.success) {
                // handleLoginFlow already shows a specific toast for its own rejection
                // reasons (admin-role / student / wrong sub-org portal). Don't stack a
                // second — and previously wrong ("Students are not allowed") — toast on
                // top. Only surface a generic message for an unexpected error code.
                if (!isHandledLoginError(result.error)) {
                    toast.error(t('errors.accessDeniedTitle'), {
                        description: t('errors.notAllowedPortal'),
                        className: 'error-toast',
                        duration: 5000,
                    });
                }
                return;
            }

            if (result.shouldShowInstituteSelection) {
                setShowInstituteSelection(true);
                return;
            }

            if (result.shouldShowSubOrgSelection) {
                setShowSubOrgSelection(true);
                return;
            }

            // Navigate to the appropriate URL
            const redirectUrl = result.redirectUrl || '/dashboard';
            navigate({ to: redirectUrl });
        } catch (error) {
            console.error('Login flow error:', error);
            toast.error(t('errors.loginFailedRetry'));
        }
    };

    const mutation = useMutation({
        mutationFn: (values: FormValues) => loginUser(values.username, values.password),
        onSuccess: (response: z.infer<typeof loginResponseSchema>) => {
            if (response) {
                // Track successful login
                amplitudeEvents.signIn('username_password');

                // Add a small delay to ensure tokens are properly set before navigation
                setTimeout(() => {
                    handlePostLoginRedirect(response.accessToken, response.refreshToken);
                }, 100);
            } else {
                // Track failed login
                trackEvent('Login Failed', {
                    login_method: 'username_password',
                    error_reason: 'invalid_credentials',
                    timestamp: new Date().toISOString(),
                });

                toast.error(t('errors.loginErrorTitle'), {
                    description: t('errors.invalidCredentials'),
                    className: 'error-toast',
                    duration: 3000,
                });
            }
        },
        onError: (error: Error) => {
            // Track login error
            trackEvent('Login Failed', {
                login_method: 'username_password',
                error_reason: 'network_error',
                error_message: error?.message || 'Unknown error',
                timestamp: new Date().toISOString(),
            });

            toast.error(t('errors.loginErrorTitle'), {
                description: t('errors.invalidUsernamePassword'),
                className: 'error-toast',
                duration: 3000,
            });
        },
    });

    function onSubmit(values: FormValues) {
        mutation.mutate(values);
    }

    // Demo handoff: an onboarding "Enter as Admin" link arrives as
    // /login?demo=1&demo_username=…&demo_password=…  → prefill + auto sign-in,
    // then scrub the credentials out of the URL/history.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('demo') !== '1') return;
        const demoUsername = params.get('demo_username');
        const demoPassword = params.get('demo_password');
        if (!demoUsername || !demoPassword) return;

        setAuthMethod('USERNAME');
        form.setValue('username', demoUsername);
        form.setValue('password', demoPassword);

        const cleanUrl = new URL(window.location.href);
        ['demo', 'demo_username', 'demo_password'].forEach((k) =>
            cleanUrl.searchParams.delete(k)
        );
        window.history.replaceState({}, '', cleanUrl.toString());

        const timer = setTimeout(
            () => mutation.mutate({ username: demoUsername, password: demoPassword }),
            150
        );
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleNavigateSignup = () => {
        navigate({ to: '/signup' });
    };

    const handleSwitchToEmail = () => {
        setAuthMethod('EMAIL');
    };

    const handleSwitchToUsername = () => {
        setAuthMethod('USERNAME');
    };

    const handleSwitchToPhone = () => {
        setAuthMethod('PHONE');
    };

    const handleInstituteSelect = async (instituteId: string) => {
        setSelectedInstitute(instituteId);
        setShowInstituteSelection(false);

        // Check if we need to show sub-org selection after institute selection
        const { handleInstituteSelection } = await import('@/lib/auth/loginFlowHandler');
        const result = await handleInstituteSelection(instituteId);

        if (result.shouldShowSubOrgSelection) {
            setShowSubOrgSelection(true);
            return;
        }

        // Navigate to the appropriate route returned by the handleInstituteSelection utility
        if (result.redirectUrl) {
            console.log('🔍 LOGIN FORM DEBUG: Final redirect URL from utility:', result.redirectUrl);
            navigate({ to: result.redirectUrl });
            return;
        }

        // Fallback to display settings if for some reason redirectUrl is missing
        try {
            const accessToken = getTokenFromCookie(TokenKey.accessToken);
            const roles = getUserRoles(accessToken);
            const isAdminRole = roles.includes('ADMIN');
            const hasFaculty = hasFacultyAssignedPermission(getInstituteId());
    const roleKey = getActiveRoleDisplaySettingsKey();

            const ds = getDisplaySettingsFromCache(roleKey);

            // If not in cache, we could fetch it, but handleLoginFlow/handleInstituteSelection should have handled it.
            // For safety, fallback to /dashboard if absolutely nothing is found.
            const candidate = ds?.postLoginRedirectRoute || '/dashboard';
            const redirectUrl = resolveEffectivePostLoginRoute(candidate, ds);
            console.log('🔍 LOGIN FORM DEBUG: Fallback redirect URL:', redirectUrl);
            navigate({ to: redirectUrl });
        } catch (error) {
            console.warn('Unexpected error in institute selection handler fallback:', error);
            navigate({ to: '/dashboard' });
        }
    };

    // Show sub-org selection if needed
    if (showSubOrgSelection) {
        return (
            <SubOrgSelection
                onSubOrgSelect={(subOrgId) => {
                    // After sub-org selection, we can finally redirect to dashboard
                    // The sub-org ID is already saved in localStorage by the component
                    handleInstituteSelect(getCachedInstituteBranding()?.instituteId || '');
                }}
            />
        );
    }

    // Show institute selection if needed
    if (showInstituteSelection) {
        return <InstituteSelection onInstituteSelect={handleInstituteSelect} />;
    }

    return (
        <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-neutral-50 px-4 py-6 sm:px-6 sm:py-8">
            {/* Decorative background elements - subtle bars, hidden on mobile */}
            <div className="pointer-events-none absolute inset-0 hidden md:block">
                <div className="absolute left-0 top-20 h-32 w-64 bg-primary-100/20"></div>
                <div className="absolute right-0 top-1/3 h-48 w-72 bg-neutral-200/30"></div>
                <div className="absolute bottom-32 left-1/4 h-24 w-96 bg-primary-50/15"></div>
                <div className="absolute right-1/3 top-1/2 h-40 w-56 bg-neutral-300/20"></div>
            </div>

            <div className="relative z-10 w-full max-w-5xl">
                <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg md:rounded-2xl md:shadow-2xl">
                    <div className="grid grid-cols-1 md:grid-cols-2">
                        {/* Left side - Branding */}
                        <div className="flex flex-col items-center justify-center border-b border-neutral-200 bg-neutral-50/50 p-6 sm:p-8 md:border-b-0 md:border-r md:p-12">
                            {instituteLogo ? (
                                <img
                                    src={instituteLogo}
                                    alt={t('instituteLogoAlt')}
                                    className="mb-4 max-h-16 max-w-40 object-contain sm:mb-6 sm:max-h-20 sm:max-w-52"
                                />
                            ) : null}
                            {instituteName && cachedBranding?.hideInstituteName !== true ? (
                                <div className="mb-2 text-center text-lg font-bold text-neutral-900 sm:mb-4 sm:text-xl">
                                    {instituteName}
                                </div>
                            ) : null}
                        </div>

                        {/* Right side - Login form */}
                        <div className="flex flex-col justify-center p-6 sm:p-8 md:p-12">
                            <div className="flex w-full flex-col gap-4">
                                {providerFlags.allowGoogleAuth && (
                                    <button
                                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 transition-all hover:border-neutral-400 hover:bg-neutral-50"
                                        onClick={() => {
                                            trackEvent('OAuth Login Initiated', {
                                                provider: 'google',
                                                action: 'login',
                                                timestamp: new Date().toISOString(),
                                            });
                                            handleOAuthLogin('google', { isSignup: false });
                                        }}
                                        type="button"
                                    >
                                        <GoogleIcon size={20} />
                                        {t('continueWithGoogle')}
                                    </button>
                                )}
                                {providerFlags.allowGithubAuth && (
                                    <button
                                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 transition-all hover:border-neutral-400 hover:bg-neutral-50"
                                        onClick={() => {
                                            trackEvent('OAuth Login Initiated', {
                                                provider: 'github',
                                                action: 'login',
                                                timestamp: new Date().toISOString(),
                                            });
                                            handleOAuthLogin('github', { isSignup: false });
                                        }}
                                        type="button"
                                    >
                                        <GitHubIcon className="size-5" />
                                        {t('continueWithGithub')}
                                    </button>
                                )}

                                {(providerFlags.allowGoogleAuth ||
                                    providerFlags.allowGithubAuth) && (
                                        <div className="relative my-1 flex items-center justify-center">
                                            <div className="absolute inset-0 flex items-center">
                                                <span className="w-full border-t border-neutral-300" />
                                            </div>
                                            <div className="relative bg-white px-3 text-xs font-medium text-neutral-600">
                                                {t('orContinueWith')}
                                            </div>
                                        </div>
                                    )}

                                {(() => {
                                    const allowEmail = providerFlags.allowEmailOtpAuth;
                                    const allowUserPass = providerFlags.allowUsernamePasswordAuth;
                                    const allowPhone = providerFlags.allowPhoneAuth;

                                    let activeMethod = authMethod;
                                    if (activeMethod === "EMAIL" && !allowEmail) {
                                        activeMethod = allowUserPass ? "USERNAME" : (allowPhone ? "PHONE" : "USERNAME");
                                    } else if (activeMethod === "USERNAME" && !allowUserPass) {
                                        activeMethod = allowEmail ? "EMAIL" : (allowPhone ? "PHONE" : "EMAIL");
                                    } else if (activeMethod === "PHONE" && !allowPhone) {
                                        activeMethod = allowEmail ? "EMAIL" : (allowUserPass ? "USERNAME" : "EMAIL");
                                    }

                                    if (activeMethod === "PHONE" && allowPhone) {
                                        return (
                                            <PhoneLoginForm
                                                onSwitchToUsername={handleSwitchToUsername}
                                                onSwitchToEmail={handleSwitchToEmail}
                                                allowUsernamePasswordAuth={allowUserPass}
                                                allowEmailOtpAuth={allowEmail}
                                            />
                                        );
                                    }

                                    if (activeMethod === "EMAIL" && allowEmail) {
                                        return <EmailLogin
                                            onSwitchToUsername={handleSwitchToUsername}
                                            onSwitchToPhone={handleSwitchToPhone}
                                            allowUsernamePasswordAuth={allowUserPass}
                                            allowPhoneAuth={allowPhone}
                                        />;
                                    }

                                    if (activeMethod === "USERNAME" && allowUserPass) {
                                        return (
                                            <Form {...form}>
                                                <form
                                                    onSubmit={form.handleSubmit(onSubmit)}
                                                    className="w-full space-y-4"
                                                >
                                                    <FormField
                                                        control={form.control}
                                                        name="username"
                                                        render={({
                                                            field: { onChange, value, ...field },
                                                        }) => (
                                                            <FormItem>
                                                                <FormControl>
                                                                    <MyInput
                                                                        inputType="text"
                                                                        inputPlaceholder={t('usernamePlaceholder')}
                                                                        input={value}
                                                                        onChangeFunction={onChange}
                                                                        error={
                                                                            form.formState.errors.username
                                                                                ?.message
                                                                        }
                                                                        required={true}
                                                                        size="large"
                                                                        label={t('usernameLabel')}
                                                                        autoCapitalize="none"
                                                                        autoCorrect="off"
                                                                        spellCheck={false}
                                                                        // This is the real login,
                                                                        // so opt back in to the
                                                                        // saved-credential fill
                                                                        // MyInput suppresses by
                                                                        // default everywhere else.
                                                                        autoComplete="username"
                                                                        {...field}
                                                                        className="w-full sm:w-full"
                                                                    />
                                                                </FormControl>
                                                            </FormItem>
                                                        )}
                                                    />
                                                    <div className="space-y-1">
                                                        <FormField
                                                            control={form.control}
                                                            name="password"
                                                            render={({
                                                                field: { onChange, value, ...field },
                                                            }) => (
                                                                <FormItem>
                                                                    <FormControl>
                                                                        <MyInput
                                                                            inputType="password"
                                                                            inputPlaceholder="••••••••"
                                                                            input={value}
                                                                            onChangeFunction={onChange}
                                                                            error={
                                                                                form.formState.errors
                                                                                    .password?.message
                                                                            }
                                                                            required={true}
                                                                            size="large"
                                                                            label={t('passwordLabel')}
                                                                            autoComplete="current-password"
                                                                            {...field}
                                                                            className="w-full sm:w-full"
                                                                        />
                                                                    </FormControl>
                                                                </FormItem>
                                                            )}
                                                        />
                                                        <div className="flex items-center justify-end">
                                                            <Link to="/login/forgot-password">
                                                                <div className="hover:text-primary-700 cursor-pointer text-xs font-medium text-primary-600 transition-colors">
                                                                    {t('forgotPassword')}
                                                                </div>
                                                            </Link>
                                                        </div>
                                                    </div>

                                                    <div className="flex w-full items-center justify-center gap-4 pt-1">
                                                        {allowEmail && (
                                                            <button
                                                                type="button"
                                                                onClick={handleSwitchToEmail}
                                                                className="hover:text-primary-700 cursor-pointer text-xs font-medium text-primary-600 transition-colors"
                                                            >
                                                                {t('useEmailOtp')}
                                                            </button>
                                                        )}

                                                        {allowPhone && (
                                                            <button
                                                                type="button"
                                                                onClick={handleSwitchToPhone}
                                                                className="hover:text-primary-700 cursor-pointer text-xs font-medium text-primary-600 transition-colors"
                                                            >
                                                                {t('usePhoneOtp')}
                                                            </button>
                                                        )}
                                                    </div>

                                                    <div className="flex flex-col items-center gap-2 pt-2">
                                                        <MyButton
                                                            type="submit"
                                                            scale="large"
                                                            buttonType="primary"
                                                            layoutVariant="default"
                                                            disabled={mutation.isPending}
                                                        >
                                                            {mutation.isPending ? t('loggingIn') : t('login')}
                                                        </MyButton>
                                                        {allowSignup && (
                                                            <p className="text-xs text-neutral-700">
                                                                {t('noAccount')}&nbsp;&nbsp;
                                                                <span
                                                                    className="hover:text-primary-700 cursor-pointer font-medium text-primary-600 transition-colors"
                                                                    onClick={handleNavigateSignup}
                                                                >
                                                                    {t('createOne')}
                                                                </span>
                                                            </p>
                                                        )}
                                                    </div>
                                                </form>
                                            </Form>
                                        );
                                    }

                                    return null;
                                })()}
                            </div>
                        </div>
                    </div>
                </div>

                {Boolean(cachedBranding?.termsAndConditionUrl) ||
                    Boolean(cachedBranding?.privacyPolicyUrl) ? (
                    <div className="mt-4 text-center text-xs text-neutral-600">
                        {cachedBranding?.termsAndConditionUrl ? (
                            <a
                                href={cachedBranding.termsAndConditionUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium transition-colors hover:text-primary-600"
                            >
                                {t('termsAndConditions')}
                            </a>
                        ) : null}
                        {cachedBranding?.termsAndConditionUrl &&
                            cachedBranding?.privacyPolicyUrl ? (
                            <span className="mx-2 text-neutral-400">•</span>
                        ) : null}
                        {cachedBranding?.privacyPolicyUrl ? (
                            <a
                                href={cachedBranding.privacyPolicyUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium transition-colors hover:text-primary-600"
                            >
                                {t('privacyPolicy')}
                            </a>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
