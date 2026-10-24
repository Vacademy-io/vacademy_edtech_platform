import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { SmartErrorPage as RootErrorComponent } from './components/core/SmartErrorPage';
import RootNotFoundComponent from './components/core/default-not-found';
import RootPendingComponent from './components/core/default-pending';
import './index.css';
// import { ThemeProvider } from "./providers/theme-provider";

// Evict service workers left behind by earlier builds (vite-plugin-pwa era).
// A stale Workbox worker serves its precached index.html for every navigation,
// pinning the browser to a dead bundle — reloads included. public/sw.js is the
// network-side kill switch for browsers still running the old bundle; this is
// the in-app half for anyone who reaches the new code with a stray
// registration. The firebase messaging worker (push notifications, no fetch
// handler) is the one registration we keep.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
            registrations.forEach((registration) => {
                const worker =
                    registration.active ?? registration.waiting ?? registration.installing;
                if (worker && !worker.scriptURL.endsWith('/firebase-messaging-sw.js')) {
                    registration.unregister().catch(() => {});
                }
            });
        })
        .catch(() => {});
}
import { SidebarProvider } from './components/ui/sidebar';
import { routeTree } from './routeTree.gen';
import { catalogsReady } from './i18n';
import { Toaster } from './components/ui/sonner';
import { ThemeProvider } from './providers/theme/theme-provider';
import { CourseSettingsProvider } from './providers/course-settings-provider';
import useInstituteLogoStore from '@/components/common/layout-container/sidebar/institutelogo-global-zustand';
import {
    resolveInstituteForCurrentHost,
    resolveInstituteForDomain,
    getPublicUrl,
    cacheInstituteBranding,
    getCachedInstituteBranding,
} from '@/services/domain-routing';
import { OtaUpdateBanner } from '@/components/ota-update/OtaUpdateBanner';
import { PaperReadWatcher } from '@/components/common/paper-reads/PaperReadWatcher';
import { resolveFontStack } from '@/utils/font';
import { useTitleStore } from '@/stores/useTitleStore';
import { getTokenFromCookie, getTokenDecodedData } from '@/lib/auth/sessionUtility';
import { TokenKey } from '@/constants/auth/tokens';
import { useInstituteDetailsStore } from '@/stores/students/students-list/useInstituteDetailsStore';
import { installChunkErrorHandler } from '@/lib/chunk-reload';
import { rememberComponentStack } from '@/lib/error-component-stack';
import { initNative, isNative, getPlatform, shouldForceVimShell, getFlavor } from '@/native';

// Recover stale tabs whose cached chunk URLs 404 after a new deploy.
// Must run before React renders so failures during the first lazy import
// are intercepted at the window level instead of bubbling to an error boundary.
installChunkErrorHandler();

// Initialize native bridges (safe area + keyboard CSS vars are also useful on
// web, so this runs unconditionally; native-only plugins guard internally).
// Also tag <html> with the platform so CSS can target iOS/Android specifically.
void initNative();
document.documentElement.classList.add(`platform-${getPlatform()}`);
if (isNative()) {
    document.documentElement.classList.add('platform-native');

    // Vimotion flavor is product-scoped to the video studio — force the launch
    // URL into the /vim shell on cold start so a stale localStorage path can't
    // surface the admin login. Deep-link handlers (src/native/deepLinks.ts)
    // override this after the router mounts. The Vacademy Admin flavor is the
    // FULL portal, so it does NOT force /vim.
    if (shouldForceVimShell()) {
        const path = window.location.pathname;
        if (!path.startsWith('/vim')) {
            window.history.replaceState({}, '', '/vim');
        }
    }

    // NOTE: the flavor institute (e.g. ca3c… for Vacademy Admin) drives BRANDING /
    // THEME only — see initializeBranding() below. We deliberately do NOT seed it
    // as `selectedInstituteId`: that would scope login + all API calls to the base
    // institute and lock out admins who belong to a different institute. Login must
    // resolve the user's OWN institute(s) (the standard multi-institute flow), so
    // any institute's admin can sign in while the app keeps the ca3c… look.
}

// Initialize Amplitude as early as possible on client
if (typeof window !== 'undefined') {
    import('./lib/amplitude')
        .then((m) => m.initializeAmplitude())
        .catch(() => {
            // Ignore analytics failures
        });
}

const queryClient = new QueryClient();

// Create a new router instance
const router = createRouter({
    routeTree,
    context: {
        queryClient,
    },
    defaultNotFoundComponent: RootNotFoundComponent,
    defaultErrorComponent: RootErrorComponent,
    defaultPendingComponent: RootPendingComponent,
    // No route sets its own onCatch, so this sees every render error the
    // error pages show; it keeps the component stack for "Report Issue".
    defaultOnCatch: rememberComponentStack,
});

// Register the router instance for type safety
declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}

if (import.meta.env.VITE_ENABLE_SENTRY === 'true') {
    Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        sendDefaultPii: true,
        // Session Replay. Defaults mask all text/inputs and block all media so
        // student PII and grades on the admin dashboard are not captured as
        // readable content — keep these on unless a specific element is
        // explicitly opted in via data-sentry-unmask.
        integrations: [
            Sentry.replayIntegration({
                maskAllText: false,
                maskAllInputs: false,
                blockAllMedia: true,
            }),
        ],
        // 0 = no continuous recording. We only spin up the replay buffer when
        // an error fires (see replaysOnErrorSampleRate). Bump this once quota
        // usage is understood.
        replaysSessionSampleRate: 0,
        // Replay on 10% of errors, not 100%. The 50-replay plan cap was being
        // exhausted instantly because a replay fired on every captured error.
        // Now that expected 4xx no longer capture (see report-api-error.ts),
        // the errors that do reach here are genuine bugs; 0.1 keeps replays a
        // trickle of actionable sessions under the cap. Raise back toward 1.0
        // once measured error volume is low.
        replaysOnErrorSampleRate: 0.1,
        ignoreErrors: [
            // Known non-fatal Slate/Yoopta race condition: toDOMNode / toDOMPoint
            // is called before React commits the new DOM after setEditorValue,
            // paste, or a block-type transform that leaves editor.selection stale.
            // The editor remains fully functional — this is cosmetic noise.
            'Cannot resolve a DOM node from Slate node',
            'Cannot resolve a DOM point from Slate point',
            // React DOM reconciliation error caused by external DOM mutations
            // (browser extensions, autofill, translation, etc.) — not actionable.
            "Failed to execute 'removeChild' on 'Node'",
            "Failed to execute 'insertBefore' on 'Node'",
            // Stale-tab chunk load failures. We auto-reload via installChunkErrorHandler,
            // so these are self-healing and should not reach Sentry.
            'Failed to fetch dynamically imported module',
            'Importing a module script failed',
            'error loading dynamically imported module',
            'Unable to preload CSS',
            'ChunkLoadError',
        ],
        beforeSend(event) {
            try {
                const token = getTokenFromCookie(TokenKey.accessToken);
                const tokenData = token ? getTokenDecodedData(token) : undefined;
                if (tokenData) {
                    event.user = {
                        ...(event.user ?? {}),
                        id: tokenData.user ?? tokenData.sub,
                        username: tokenData.username,
                        email: tokenData.email,
                    };
                }
                const branding = getCachedInstituteBranding();
                const storeDetails = useInstituteDetailsStore.getState().instituteDetails;
                const instituteId = branding?.instituteId ?? storeDetails?.id ?? null;
                const instituteName =
                    branding?.instituteName ?? storeDetails?.institute_name ?? null;
                if (instituteId || instituteName) {
                    event.tags = {
                        ...(event.tags ?? {}),
                        'institute.id': instituteId ?? 'unknown',
                        'institute.name': instituteName ?? 'unknown',
                    };
                }

                const username = tokenData?.username ?? tokenData?.email ?? 'unknown';
                const suffix = ` — user: ${username}, institute: ${instituteName ?? 'unknown'}`;
                const exc = event.exception?.values?.[0];
                if (exc?.value) {
                    const originalValue = exc.value;
                    event.fingerprint = [exc.type ?? 'Error', originalValue];
                    exc.value = `${originalValue}${suffix}`;
                } else if (event.message) {
                    const originalMessage = String(event.message);
                    event.fingerprint = ['message', originalMessage];
                    event.message = `${originalMessage}${suffix}`;
                }
            } catch {
                // never block event capture on enrichment failures
            }
            return event;
        },
    });
}

// Render the app
const rootElement = document.getElementById('root')!;
if (!rootElement.innerHTML) {
    // Dev-only: filter noisy DOMNodeInserted deprecation warning from third-party libs
    if (!import.meta.env.PROD) {
        const originalWarn = console.warn.bind(console);
        console.warn = (...args: unknown[]) => {
            const first = args?.[0];
            if (
                typeof first === 'string' &&
                first.includes("Listener added for a 'DOMNodeInserted' mutation event")
            ) {
                return;
            }
            originalWarn(...args);
        };
    }

    const initializeBranding = async () => {
        try {
            const titleStore = useTitleStore.getState();

            const cached = getCachedInstituteBranding();
            if (cached) {
                // Set title from cached data with fallback to "Admin Dashboard"
                const tabText = cached.tabText;
                const title = tabText && tabText.trim() ? tabText.trim() : 'Admin Dashboard';
                titleStore.setGlobalTitle(title);
                const themeCode = cached.instituteThemeCode ?? cached.theme;
                if (themeCode) {
                    localStorage.setItem('theme-code', themeCode);
                }
                if (cached.fontFamily) {
                    const stack = resolveFontStack(cached.fontFamily);
                    if (stack) {
                        document.documentElement.style.setProperty('--app-font-family', stack);
                        document.body.style.fontFamily = stack;
                    }
                }
                if (cached.instituteLogoUrl) {
                    const store = useInstituteLogoStore.getState();
                    if (store && store.setInstituteLogo) {
                        store.setInstituteLogo(cached.instituteLogoUrl);
                    }
                }
                {
                    const store = useInstituteLogoStore.getState();
                    if (store && store.setBrandingDisplay) {
                        store.setBrandingDisplay({
                            hideInstituteName: cached.hideInstituteName === true,
                            logoWidthPx:
                                typeof cached.logoWidthPx === 'number' ? cached.logoWidthPx : null,
                            logoHeightPx:
                                typeof cached.logoHeightPx === 'number'
                                    ? cached.logoHeightPx
                                    : null,
                            stackNameBelowLogo: cached.stackNameBelowLogo === true,
                        });
                    }
                }
                if (cached.tabIconFileId && !cached.tabIconUrl) {
                    const iconUrl = await getPublicUrl(cached.tabIconFileId || '');
                    if (iconUrl) {
                        titleStore.setGlobalFavicon(iconUrl);
                    }
                } else if (cached.tabIconUrl) {
                    titleStore.setGlobalFavicon(cached.tabIconUrl);
                }
            }

            // Native flavors resolve branding by a FIXED domain/subdomain (their
            // institute_domain_routing row, e.g. vacademy.io/admin-app → ca3c…);
            // the web build resolves by the request host.
            //
            // The isNative() guard is load-bearing: the web build has no
            // VITE_CAP_FLAVOR, so getFlavor() falls back to DEFAULT_FLAVOR_KEY
            // ('vacademy-admin'), which carries a fixed brandingDomain. Without
            // this guard EVERY web host (e.g. admin.shikshanation.com) would
            // resolve vacademy.io/admin-app → Vacademy CRM instead of its own
            // domain. Only real native apps use fixed-domain flavor branding.
            const flavor = getFlavor();
            const useFlavorBranding =
                isNative() && !!(flavor.brandingDomain && flavor.brandingSubdomain);
            const data = useFlavorBranding
                ? await resolveInstituteForDomain(flavor.brandingDomain!, flavor.brandingSubdomain!)
                : await resolveInstituteForCurrentHost();
            if (!data) {
                // If no data from API, ensure we have a fallback title
                titleStore.setGlobalTitle('Admin Dashboard');
                return;
            }

            const [logoUrl, iconUrl] = await Promise.all([
                getPublicUrl(data.instituteLogoFileId),
                getPublicUrl(data.tabIconFileId),
            ]);

            // For a fixed-institute flavor (e.g. Vacademy Admin → ca3c…) this is
            // BRANDING ONLY: don't set it as selectedInstituteId, so login still
            // resolves the signed-in user's own institute.
            cacheInstituteBranding(
                data.instituteId,
                {
                    ...data,
                    instituteLogoUrl: logoUrl || undefined,
                    tabIconUrl: iconUrl || undefined,
                },
                useFlavorBranding ? { setSelectedInstitute: false } : undefined
            );

            // Set title from API response with fallback to "Admin Dashboard"
            const tabText = data.tabText;
            const title = tabText && tabText.trim() ? tabText.trim() : 'Admin Dashboard';
            titleStore.setGlobalTitle(title);

            // Set favicon from API response
            if (iconUrl) {
                titleStore.setGlobalFavicon(iconUrl);
            }

            if (logoUrl) {
                const store = useInstituteLogoStore.getState();
                if (store && store.setInstituteLogo) {
                    store.setInstituteLogo(logoUrl);
                }
            }

            {
                const store = useInstituteLogoStore.getState();
                if (store && store.setBrandingDisplay) {
                    store.setBrandingDisplay({
                        hideInstituteName: data.hideInstituteName === true,
                        logoWidthPx: typeof data.logoWidthPx === 'number' ? data.logoWidthPx : null,
                        logoHeightPx:
                            typeof data.logoHeightPx === 'number' ? data.logoHeightPx : null,
                        stackNameBelowLogo: data.stackNameBelowLogo === true,
                    });
                }
            }

            // Apply theme code if provided
            const themeCode = data.instituteThemeCode ?? data.theme;
            if (themeCode) {
                localStorage.setItem('theme-code', themeCode);
            }

            // Apply font if provided
            if (data.fontFamily) {
                const stack = resolveFontStack(data.fontFamily);
                if (stack) {
                    document.documentElement.style.setProperty('--app-font-family', stack);
                    document.body.style.fontFamily = stack;
                }
            }
        } catch {
            // ignore branding failures - but ensure we have a fallback title
            const titleStore = useTitleStore.getState();
            titleStore.setGlobalTitle('Admin Dashboard');
        }
    };

    await initializeBranding();

    // Hold first render until the active language's catalogs are seeded (see
    // src/i18n.ts) — otherwise components that freeze t() output (useMemo with
    // [] deps, react-query fetchers) capture raw keys for good. The timeout is
    // the escape hatch: a CDN hiccup degrades to the old flash-of-keys
    // behaviour instead of a blank page.
    await Promise.race([catalogsReady, new Promise((resolve) => setTimeout(resolve, 4000))]);

    const root = ReactDOM.createRoot(rootElement);
    const app = (
        // <ThemeProvider defaultTheme="light" storageKey="ui-theme">
        <ThemeProvider>
            <QueryClientProvider client={queryClient}>
                <CourseSettingsProvider>
                    <SidebarProvider>
                        <RouterProvider router={router} />
                        <OtaUpdateBanner />
                        <PaperReadWatcher onOpen={(path) => router.history.push(path)} />
                        <Toaster />
                    </SidebarProvider>
                </CourseSettingsProvider>
            </QueryClientProvider>
        </ThemeProvider>
        // </ThemeProvider>
    );

    // Disable StrictMode in development to suppress noisy library warnings (e.g., findDOMNode)
    root.render(import.meta.env.PROD ? <StrictMode>{app}</StrictMode> : app);
}
