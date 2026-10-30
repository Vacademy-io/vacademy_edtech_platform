// Standalone entry for the public lead form (/audience-response).
//
// Why this exists: the form is embedded as an iframe on institutes' own
// websites, and every visitor arrives cold. Booting it through main.tsx meant
// downloading and parsing the whole learner app first — ~5.6 MB compressed,
// including excalidraw, mermaid, monaco and pdf-viewer — because every route
// is bundled into the entry chunk. This entry mounts only the form route, so
// the iframe opens in a fraction of the time.
//
// It is built separately (vite.audience-form.config.ts → dist/audience-form.html)
// and served by functions/_middleware.ts for hard loads of /audience-response.
// Everything else — in-app navigation to the form, hosts that don't run the
// middleware, crawlers — still gets the full app through main.tsx, which this
// file does not touch. Keep the provider stack in step with main.tsx and the
// root-route effects in step with __root.tsx (splash, primary colour).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRouter,
  type AnyRoute,
} from "@tanstack/react-router";
import { Preferences } from "@capacitor/preferences";
import { useEffect } from "react";
import ReactDOM from "react-dom/client";

import { SmartErrorPage as RootErrorComponent } from "./components/core/SmartErrorPage";
import RootPendingComponent from "./components/core/default-pending";
import "./index.css";
import { ThemeProvider as ColorThemeProvider, useTheme } from "./providers/theme/theme-provider";
import { ThemeProvider as ModeThemeProvider } from "./providers/theme-provider";
import { SidebarProvider } from "./components/ui/sidebar";
import "./i18n";
import { Toaster } from "./components/ui/sonner";
import { installChunkErrorHandler } from "./lib/chunk-reload";
import { captureUtmOnce } from "@/lib/utm-attribution";
import { HOLISTIC_INSTITUTE_ID } from "@/constants/urls";
import { getCachedInstituteBranding } from "@/services/domain-routing";
import { useInstituteDetailsStore } from "@/stores/study-library/useInstituteDetails";
import { Route as AudienceResponseRoute } from "./routes/audience-response/index";
import { handleGetAudienceCampaign } from "./routes/audience-response/-services/audience-campaign-services";
import { handleGetPublicInstituteDetails } from "./components/common/enroll-by-invite/-services/enroll-invite-services";

installChunkErrorHandler();

// Same reason as main.tsx: bank the first-touch campaign before the router
// strips undeclared search params.
captureUtmOnce();

if (import.meta.env.VITE_ENABLE_SENTRY === "true") {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    sendDefaultPii: true,
    // Same list as main.tsx — see the reasons there.
    ignoreErrors: [
      "Failed to fetch dynamically imported module",
      "Importing a module script failed",
      "error loading dynamically imported module",
      "Unable to preload CSS",
      "ChunkLoadError",
      /Non-Error promise rejection captured with value: Object Not Found Matching Id:\d+, MethodName:\w+, ParamCount:\d+/,
    ],
    initialScope: {
      tags: { entry: "audience-form" },
    },
    // The tags main.tsx's beforeSend adds, so form errors still group by
    // institute. Visitors here are anonymous, so there is no user to attach.
    beforeSend(event) {
      try {
        const branding = getCachedInstituteBranding();
        const storeDetails = useInstituteDetailsStore.getState().instituteDetails;
        event.tags = {
          ...(event.tags ?? {}),
          "institute.id": branding?.instituteId ?? storeDetails?.id ?? "unknown",
          "institute.name":
            branding?.instituteName ?? storeDetails?.institute_name ?? "unknown",
          domain: window.location.hostname,
          app: "learner-dashboard",
        };
        event.contexts = {
          ...(event.contexts ?? {}),
          navigation: { url: window.location.href, domain: window.location.hostname },
        };
      } catch {
        // never block event capture on enrichment failures
      }
      return event;
    },
  });
}

// Amplitude, exactly as main.tsx starts it: after first paint, off the
// critical path. Its autocapture is what records form views and clicks.
const initAnalytics = async () => {
  // When a chunk fails to load, chunk-reload.ts cancels Vite's preloadError
  // to reload the page — and Vite then resolves the import with undefined
  // instead of throwing. Bail quietly; the reload is already on its way.
  const analytics = await import("./lib/analytics");
  const session = await import("@/lib/auth/sessionUtility");
  if (!analytics || !session) return;
  const { initializeAnalytics, identifyUser } = analytics;
  const { getDecodedAccessTokenFromStorage } = session;

  initializeAnalytics();

  try {
    const decoded = await getDecodedAccessTokenFromStorage();
    const uid = decoded?.user;
    if (uid) {
      identifyUser(uid, { username: decoded?.username, email: decoded?.email });
    }
  } catch {
    // Anonymous visitor or unreadable token: nothing to identify.
  }
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// The form's two reads used to run back to back: the route suspended on the
// campaign, and only then did the form mount and ask for the institute. Start
// both now, before React has even rendered, so they travel together.
const startFormQueries = () => {
  const params = new URLSearchParams(window.location.search);
  const instituteId = params.get("instituteId");
  const audienceId = params.get("audienceId");
  if (!instituteId || !audienceId) return;
  void queryClient.prefetchQuery(
    handleGetAudienceCampaign({ instituteId, audienceId })
  );
  void queryClient.prefetchQuery(
    handleGetPublicInstituteDetails({ instituteId })
  );
};
startFormQueries();

// Mirrors the parts of __root.tsx's RootComponent that a public page relies on.
function FormRoot() {
  const { setPrimaryColor } = useTheme();

  useEffect(() => {
    const splash = document.getElementById("boot-splash");
    if (!splash) return;
    splash.style.opacity = "0";
    const t = window.setTimeout(() => splash.remove(), 250);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    void (async () => {
      const details = await Preferences.get({ key: "InstituteDetails" });
      const parsed = details.value ? JSON.parse(details.value) : null;
      if (parsed?.id === HOLISTIC_INSTITUTE_ID) {
        setPrimaryColor("holistic");
      } else {
        setPrimaryColor(
          parsed?.institute_theme_code ??
            import.meta.env.VITE_DEFAULT_THEME_COLOR ??
            "neutral"
        );
      }
    })();
    // Once on mount, as in __root.tsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <Outlet />;
}

// This bundle knows one page. If anything navigates elsewhere, load that URL
// for real so the full app handles it. Only once per path: Pages also serves
// this page at its own file URL (/audience-form), where a reload would land
// right back here — go to the app's root instead of reloading forever.
function LeaveFormBundle() {
  useEffect(() => {
    const { pathname } = window.location;
    if (pathname.startsWith("/audience-response")) return;
    const key = `audience-form-left:${pathname}`;
    let triedBefore = true;
    try {
      triedBefore = sessionStorage.getItem(key) === "1";
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage blocked: assume we were here before rather than risk a loop.
    }
    if (triedBefore) window.location.replace("/");
    else window.location.reload();
  }, []);
  return null;
}

const rootRoute = createRootRoute({
  component: FormRoot,
  notFoundComponent: LeaveFormBundle,
});

// The same file route the full app registers in routeTree.gen.ts. Its types
// are bound to that tree, hence the casts.
const formRoute = AudienceResponseRoute.update({
  id: "/audience-response/",
  path: "/audience-response/",
  getParentRoute: () => rootRoute,
} as never) as unknown as AnyRoute;

const router = createRouter({
  routeTree: rootRoute.addChildren([formRoute]),
  defaultErrorComponent: RootErrorComponent,
  defaultPendingComponent: RootPendingComponent,
  defaultNotFoundComponent: LeaveFormBundle,
});

const rootElement = document.getElementById("root")!;
if (!rootElement.innerHTML) {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => void initAnalytics());
  } else {
    setTimeout(() => void initAnalytics(), 2000);
  }

  ReactDOM.createRoot(rootElement).render(
    <ModeThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <ColorThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SidebarProvider defaultOpen={true}>
            <RouterProvider router={router as never} />
            <Toaster />
          </SidebarProvider>
        </QueryClientProvider>
      </ColorThemeProvider>
    </ModeThemeProvider>
  );
}
