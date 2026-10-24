// jQuery must be on window BEFORE the quill chunk loads MathQuill (mathquill
// reads window.jQuery at module-eval time). Importing the wrapper here at the
// top of the main bundle entry guarantees this — the wrapper sets window.jQuery
// synchronously when this module's import graph initializes, well before any
// lazy chunk that contains MathQuill is fetched. See vite.config.ts for the
// chunking rationale.
import "./components/quill/jquery";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";

import { SmartErrorPage as RootErrorComponent } from "./components/core/SmartErrorPage";
import RootNotFoundComponent from "./components/core/default-not-found";
import RootPendingComponent from "./components/core/default-pending";
import "./index.css";
import { ThemeProvider as ColorThemeProvider } from "./providers/theme/theme-provider";
import { ThemeProvider as ModeThemeProvider } from "./providers/theme-provider";
import { SidebarProvider } from "./components/ui/sidebar";
import { routeTree } from "./routeTree.gen";
import { registerAppRoutePaths } from "./services/reserved-app-routes";
import "./i18n";
import { Toaster } from "./components/ui/sonner";
import "./lib/debug";
import {
  installChunkErrorHandler,
  isChunkLoadError,
  reloadForChunkError,
} from "./lib/chunk-reload";
import {
  getTokenFromCookie,
  getTokenDecodedData,
} from "@/lib/auth/sessionUtility";
import { captureUtmOnce } from "@/lib/utm-attribution";
import { TokenKey } from "@/constants/auth/tokens";
import { getCachedInstituteBranding } from "@/services/domain-routing";
import { useInstituteDetailsStore } from "@/stores/study-library/useInstituteDetails";

// Recover stale tabs whose cached chunk URLs 404 after a new deploy.
// Must run before React renders so failures during the first lazy import
// are intercepted at the window level instead of bubbling to an error boundary.
installChunkErrorHandler();

// First-touch campaign capture, at boot rather than in a React effect.
//
// Every capture route validates its search params with a plain `z.object`,
// which STRIPS unknown keys — so `?instituteId=…&audienceId=…&utm_source=meta`
// is normalised by the router down to the two keys it declares, and the
// campaign is gone from the URL before any component effect could read it.
// Reading window.location.search here, synchronously at module evaluation,
// happens before the router is even created, so the value is banked whatever
// the route then does with the URL.
captureUtmOnce();

/**
 * Read the current access token synchronously from the fastest available
 * source. Learner dashboard stores tokens in Capacitor Preferences (async),
 * localStorage (sync), and cookies (sync) — we try the two sync sources so
 * Sentry's beforeSend can run without awaiting Capacitor.
 */
const readAccessTokenSync = (): string | null => {
  try {
    if (typeof localStorage !== "undefined") {
      const fromLs = localStorage.getItem(TokenKey.accessToken);
      if (fromLs) return fromLs;
    }
  } catch {
    // localStorage may be blocked in some WebViews — fall through
  }
  return getTokenFromCookie(TokenKey.accessToken);
};

if (import.meta.env.VITE_ENABLE_SENTRY === "true") {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    sendDefaultPii: true,
    ignoreErrors: [
      // Stale-tab chunk load failures. We auto-reload via installChunkErrorHandler,
      // so these are self-healing and should not reach Sentry.
      "Failed to fetch dynamically imported module",
      "Importing a module script failed",
      "error loading dynamically imported module",
      "Unable to preload CSS",
      "ChunkLoadError",
      // Junk from CEFSharp — a .NET library that embeds Chromium in Windows
      // desktop apps. The host app's own script rejects with a bare string, so
      // Sentry wraps it as a non-Error rejection; nothing here is ours and
      // there is nothing to fix. The SDK already denies this by default, but
      // its built-in regex hardcodes `MethodName:simulateEvent`, so the
      // `MethodName:update` variant slips through. Match the whole family, and
      // leave the end unanchored because beforeSend appends a
      // " — user: …, institute: …" suffix to the value.
      /Non-Error promise rejection captured with value: Object Not Found Matching Id:\d+, MethodName:\w+, ParamCount:\d+/,
    ],
    beforeSend(event) {
      try {
        const token = readAccessTokenSync();
        const tokenData = token ? getTokenDecodedData(token) : undefined;
        if (tokenData?.user || tokenData?.email || tokenData?.username) {
          event.user = {
            ...(event.user ?? {}),
            id: tokenData.user ?? tokenData.sub,
            username: tokenData.username,
            email: tokenData.email,
          };
        }

        const branding = getCachedInstituteBranding();
        const storeDetails =
          useInstituteDetailsStore.getState().instituteDetails;
        const instituteId =
          branding?.instituteId ?? storeDetails?.id ?? null;
        const instituteName =
          branding?.instituteName ?? storeDetails?.institute_name ?? null;

        // Domain context
        const domain = typeof window !== "undefined" ? window.location.hostname : "unknown";
        const fullUrl = typeof window !== "undefined" ? window.location.href : "unknown";

        event.tags = {
          ...(event.tags ?? {}),
          "institute.id": instituteId ?? "unknown",
          "institute.name": instituteName ?? "unknown",
          "domain": domain,
          "app": "learner-dashboard",
        };

        event.contexts = {
          ...(event.contexts ?? {}),
          navigation: {
            url: fullUrl,
            domain,
          },
        };

        const username =
          tokenData?.username ?? tokenData?.email ?? "unknown";
        const suffix = ` — user: ${username}, institute: ${
          instituteName ?? "unknown"
        }`;
        const exc = event.exception?.values?.[0];
        if (exc?.value) {
          const originalValue = exc.value;
          event.fingerprint = [exc.type ?? "Error", originalValue];
          exc.value = `${originalValue}${suffix}`;
        } else if (event.message) {
          const originalMessage = String(event.message);
          event.fingerprint = ["message", originalMessage];
          event.message = `${originalMessage}${suffix}`;
        }
      } catch {
        // never block event capture on enrichment failures
      }
      return event;
    },
  });
}

// Lazy load analytics initialization (deferred to after first paint)
const initAnalytics = async () => {
  const { initializeAnalytics, identifyUser } = await import("./lib/analytics");
  const { getDecodedAccessTokenFromStorage } = await import("@/lib/auth/sessionUtility");

  initializeAnalytics();

  try {
    const decoded = await getDecodedAccessTokenFromStorage();
    const uid = decoded?.user;
    if (uid) {
      identifyUser(uid, { username: decoded?.username, email: decoded?.email });
    }
  } catch { }
};

// Initialize analytics after initial render using requestIdleCallback
const initializeServices = () => {
  if ('requestIdleCallback' in window) {
    (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(() => {
      initAnalytics();
    });
  } else {
    setTimeout(() => {
      initAnalytics();
    }, 2000);
  }
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Optimize query behavior
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes (was: cacheTime, renamed in v5)
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Lazy load push notification hook to avoid Firebase initialization blocking render.
// Only chunk-load failures (stale tab whose hashed chunk no longer exists on the CDN)
// are intercepted: trigger a reload, and if the reload budget is exhausted fall back
// to a no-op so notifications fail open instead of taking down the whole app.
// Any other import rejection (a real bug in the module) is re-thrown so it surfaces
// to Sentry and behaves the same as before this guard was added.
const LazyNotificationInitializer = lazy(() =>
  import("./components/lazy/NotificationInitializer").catch((err) => {
    if (!isChunkLoadError(err)) throw err;
    reloadForChunkError(err);
    return { default: () => null };
  })
);

// Render the lazy notification initializer in its own Suspense so a stalled
// or failed import cannot suspend the whole app subtree (router included)
// and produce a silent white screen.
const NotificationWrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      <Suspense fallback={null}>
        <LazyNotificationInitializer />
      </Suspense>
      {children}
    </>
  );
};

// Create a new router instance
const router = createRouter({
  routeTree,
  context: {
    queryClient,
  },
  defaultNotFoundComponent: RootNotFoundComponent,
  defaultErrorComponent: RootErrorComponent,
  defaultPendingComponent: RootPendingComponent,
  // Enable preloading for better perceived performance
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
});

// Catalogue link builders need to know which first segments the app owns —
// see reserved-app-routes.ts for why a root-mounted catalogue page named
// "privacy-policy" would otherwise open the app's own page.
registerAppRoutePaths(Object.keys(router.routesByPath));

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Render the app
const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);

  // Initialize analytics after first paint
  initializeServices();

  root.render(
    <>
      <ModeThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
        <ColorThemeProvider>
          <QueryClientProvider client={queryClient}>
            <NotificationWrapper>
              <SidebarProvider defaultOpen={true}>
                <RouterProvider router={router} />
                <Toaster />
              </SidebarProvider>
            </NotificationWrapper>
          </QueryClientProvider>
        </ColorThemeProvider>
      </ModeThemeProvider>
    </>
  );
}
