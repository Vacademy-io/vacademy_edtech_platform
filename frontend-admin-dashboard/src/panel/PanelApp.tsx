/**
 * Vacademy Classroom app shell.
 *
 * PanelRootErrorBoundary > ThemeProvider (reused) > QueryClientProvider >
 * hash-router outlet; sonner Toaster at top-center. Whiteboard / Volt / Lessons
 * are React.lazy chunks (default exports of ./whiteboard, ./volt, ./content).
 *
 * Boot signal (owner decision 1): window.__PANEL_BOOTED__ / __PANEL_BOOT_MS__
 * are set from a useEffect + requestAnimationFrame of the first COMMITTED
 * screen (BootMarker sits inside the screen's Suspense boundary, and inside
 * ScreenFallback so a committed per-screen error state counts as booted too),
 * never synchronously in boot(). A late boot removes the pre-flight card when
 * the watchdog showed it only because of its 20 s timeout.
 */
import { Suspense, lazy, useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ThemeProvider, useTheme } from '@/providers/theme/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { MyButton } from '@/components/design-system/button';
// PostCSS-processed copy of sonner's runtime-injected styles (its 47 :where()
// selectors are dropped by Chrome 66-87; postcss-panel-legacy unwraps them).
import 'sonner/dist/styles.css';
import { PANEL_IDLE_SIGNOUT_MS, PANEL_LEGACY_LOGIN, PANEL_STORAGE_KEYS } from './config';
import { SessionOverlays } from './device/SessionOverlays';
import { useDeviceRecord, usesDeviceAuth } from './device/store';
import { FrozenRouteContext } from './router';
import { subscribeThemeCode } from './lib/branding';
import {
    isSignedIn,
    isVoltSessionIdleExempt,
    readLastActivity,
    recordActivity,
    registerAfterSignOut,
    signOut,
    usePanelSession,
} from './lib/session';
import { readString } from './lib/storage';
import {
    AUTH_REQUIRED_SCREENS,
    navigate,
    redirectToLogin,
    usePanelRoute,
    type PanelRoute,
    type PanelScreen,
} from './router';
import { PanelRootErrorBoundary, PanelScreenErrorBoundary } from './components/PanelErrorBoundary';
import { PanelError, PanelLoading } from './components/PanelScreenState';
import { PanelStage } from './components/PanelStage';
import DiagnosticsScreen from './screens/DiagnosticsScreen';
import HomeScreen from './screens/HomeScreen';

function NoScreen() {
    return null;
}

const SignInScreen = lazy(() => import('./device/SignInScreen'));
const PairScreen = lazy(() => import('./device/PairScreen'));
// Phase 0 only. A release build has no route to login-root, so these are not in it.
const LoginScreen = PANEL_LEGACY_LOGIN ? lazy(() => import('./screens/LoginScreen')) : NoScreen;
const InstitutePickerScreen = PANEL_LEGACY_LOGIN
    ? lazy(() => import('./screens/InstitutePickerScreen'))
    : NoScreen;
const WhiteboardScreen = lazy(() => import('./whiteboard'));
const VoltScreen = lazy(() => import('./volt'));
const LessonsScreen = lazy(() => import('./content'));
const OfflineLayer = lazy(() => import('./offline/OfflineLayer'));

const SCREENS: Record<PanelScreen, ComponentType<Record<string, never>>> = {
    diagnostics: DiagnosticsScreen,
    login: LoginScreen,
    pair: PairScreen,
    signin: SignInScreen,
    institutes: InstitutePickerScreen,
    home: HomeScreen,
    whiteboard: WhiteboardScreen,
    volt: VoltScreen,
    lessons: LessonsScreen,
};

const queryClient = new QueryClient({
    defaultOptions: {
        queries: { retry: 1, refetchOnWindowFocus: false },
    },
});

let bootSignalled = false;

/** Marks the app as booted after the first real screen has committed and painted. */
function BootMarker() {
    useEffect(() => {
        if (bootSignalled) return;
        bootSignalled = true;
        window.requestAnimationFrame(() => {
            window.__PANEL_BOOTED__ = true;
            window.__PANEL_BOOT_MS__ = Math.round(performance.now());
            const preflight = document.getElementById('panel-preflight');
            if (!preflight) return;
            if (!preflight.className) {
                preflight.innerHTML = '';
            } else if (window.__PANEL_BOOT_TIMED_OUT__ && !window.__PANEL_BOOT_FAILED__) {
                // The watchdog gave up before this first commit (slow or hidden start):
                // the app is fine, so take its card down again.
                preflight.className = '';
                preflight.innerHTML = '';
                const root = document.getElementById('root');
                if (root) root.style.display = '';
            }
        });
    }, []);
    return null;
}

/** Forwards background branding refreshes into the reused ThemeProvider. */
function PanelBrandingSync() {
    const { setPrimaryColor } = useTheme();
    useEffect(() => subscribeThemeCode(setPrimaryColor), [setPrimaryColor]);
    return null;
}

/**
 * Phase 0 only (paired mode uses SessionOverlays): signs the teacher out after
 * PANEL_IDLE_SIGNOUT_MS without input (not during a fresh live Volt session). The
 * last-activity time is persisted (throttled) so boot.tsx can enforce the same limit
 * across reboots (enforceIdleSignOutAtBoot).
 */
function PanelIdleSignOut() {
    const { t } = useTranslation('panel');
    useEffect(() => {
        // Boot already signed out a session idle past the limit, so start from the
        // persisted time when there is one (it is never in the future by design).
        let lastActivity = Math.min(Date.now(), readLastActivity() ?? Date.now());
        const mark = () => {
            lastActivity = Date.now();
            recordActivity(); // throttled to one localStorage write a minute
        };
        const events = ['pointerdown', 'keydown', 'wheel'];
        events.forEach((name) => window.addEventListener(name, mark, { passive: true }));
        const timer = window.setInterval(() => {
            if (usesDeviceAuth() || !isSignedIn()) {
                lastActivity = Date.now();
                return;
            }
            if (isVoltSessionIdleExempt()) {
                // A live class is running: activity counts, also across a restart.
                lastActivity = Date.now();
                recordActivity();
                return;
            }
            if (Date.now() - lastActivity >= PANEL_IDLE_SIGNOUT_MS) {
                void signOut().then(() => {
                    toast.info(t('idle.signedOut'));
                    navigate('home', undefined, { replace: true });
                });
            }
        }, 60 * 1000);
        return () => {
            events.forEach((name) => window.removeEventListener(name, mark));
            window.clearInterval(timer);
        };
    }, [t]);
    return null;
}

function ScreenFallback({ error, reset }: { error: string; reset: () => void }) {
    const { t } = useTranslation('panel');
    return (
        <PanelStage className="items-center justify-center">
            {/* A committed error state is a booted app (its Home/Retry work). */}
            <BootMarker />
            <PanelError
                title={t('errors.screenTitle')}
                description={t('errors.screenBody')}
                detail={error}
                onRetry={reset}
                action={
                    <MyButton
                        buttonType="secondary"
                        scale="large"
                        className="h-16 px-8"
                        onClick={() => {
                            reset();
                            navigate('home', undefined, { replace: true });
                        }}
                    >
                        {t('common.home')}
                    </MyButton>
                }
            />
        </PanelStage>
    );
}

/** The screens an unpaired panel may use. Everything else needs a device. */
const WORKS_UNPAIRED: readonly PanelScreen[] = ['pair', 'diagnostics', 'whiteboard'];

function PanelRouterOutlet() {
    const route = usePanelRoute();
    const { isSignedIn: signedIn } = usePanelSession();
    const device = useDeviceRecord();
    const deviceMode = !PANEL_LEGACY_LOGIN || device !== null;
    const paired = !!device && !device.revoked_at;
    const needsPairing = deviceMode && !paired && WORKS_UNPAIRED.indexOf(route.screen) < 0;
    const donePairing = paired && route.screen === 'pair';
    // The Phase 0 screens do not exist in device mode; #/login goes to the QR.
    const oldLogin = deviceMode && route.screen === 'login';
    const oldPicker = deviceMode && route.screen === 'institutes';
    const needsAuth = AUTH_REQUIRED_SCREENS.indexOf(route.screen) >= 0;
    const firstRun = readString(PANEL_STORAGE_KEYS.firstRunDone) === null;
    const redirectFirstRun = firstRun && route.screen !== 'diagnostics';

    useEffect(() => {
        if (redirectFirstRun) {
            navigate('diagnostics', { firstRun: '1' }, { replace: true });
        } else if (needsPairing) {
            navigate('pair', undefined, { replace: true });
        } else if (donePairing || oldPicker) {
            navigate('home', undefined, { replace: true });
        } else if (oldLogin) {
            navigate('signin', route.params, { replace: true });
        } else if (needsAuth && !signedIn) {
            redirectToLogin(route);
        }
        // route identity changes every render; screen + flags are what matter.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        redirectFirstRun,
        needsPairing,
        donePairing,
        oldLogin,
        oldPicker,
        needsAuth,
        signedIn,
        route.screen,
    ]);

    // A signed-in teacher opening the sign-in card keeps the current screen, and its
    // state, mounted underneath: a rescan by the same teacher must not reset it.
    // Only when already signed in on the way in: signing in on the plain screen must
    // not swap it for the overlay in the moment before it navigates away.
    const lastScreenRoute = useRef<PanelRoute>({ screen: 'home', params: {} });
    const enteredSignedIn = useRef(false);
    if (route.screen !== 'signin') {
        lastScreenRoute.current = route;
        enteredSignedIn.current = signedIn;
    }
    const overSignIn = route.screen === 'signin' && signedIn && enteredSignedIn.current;
    const shownRoute = overSignIn ? lastScreenRoute.current : route;

    if (
        redirectFirstRun ||
        needsPairing ||
        donePairing ||
        oldLogin ||
        oldPicker ||
        (needsAuth && !signedIn)
    ) {
        return (
            <PanelStage className="items-center justify-center">
                <PanelLoading />
            </PanelStage>
        );
    }

    const Screen = SCREENS[shownRoute.screen];
    return (
        <PanelScreenErrorBoundary
            key={shownRoute.screen}
            fallback={(error, reset) => <ScreenFallback error={error} reset={reset} />}
        >
            <Suspense
                fallback={
                    <PanelStage className="items-center justify-center">
                        <PanelLoading />
                    </PanelStage>
                }
            >
                <FrozenRouteContext.Provider value={overSignIn ? shownRoute : null}>
                    <Screen />
                </FrozenRouteContext.Provider>
                {overSignIn && <SignInScreen overlay />}
                <BootMarker />
            </Suspense>
        </PanelScreenErrorBoundary>
    );
}

function PanelProviders({ children }: { children: ReactNode }) {
    useEffect(
        () =>
            registerAfterSignOut(() => {
                queryClient.clear();
            }),
        []
    );
    return (
        <ThemeProvider>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </ThemeProvider>
    );
}

export function PanelApp() {
    return (
        <PanelRootErrorBoundary>
            <PanelProviders>
                <PanelBrandingSync />
                {PANEL_LEGACY_LOGIN && <PanelIdleSignOut />}
                <PanelRouterOutlet />
                <SessionOverlays />
                {usesDeviceAuth() && (
                    <Suspense fallback={null}>
                        <OfflineLayer />
                    </Suspense>
                )}
                <Toaster theme="light" position="top-center" />
            </PanelProviders>
        </PanelRootErrorBoundary>
    );
}

export default PanelApp;
