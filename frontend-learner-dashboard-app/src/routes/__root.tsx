import { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router";
import * as Sentry from "@sentry/react";
import { useEffect, useRef, useState } from "react";
import {
  AppUpdate,
  AppUpdateAvailability,
} from "@capawesome/capacitor-app-update";

import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { toast } from "sonner";
import { runBackGuard } from "@/lib/back-guard";
import { useUpdate } from "@/stores/useUpdate";
import { useOtaUpdate } from "@/stores/useOtaUpdate";
import {
  checkForOtaUpdate,
  downloadAndApplyUpdate,
  getOtaUpdateMode,
  notifyUpdateSuccess,
} from "@/services/ota-update";
import { Preferences } from "@capacitor/preferences";
import { useTheme } from "@/providers/theme/theme-provider";
import { HOLISTIC_INSTITUTE_ID } from "@/constants/urls";
import { applyTabBranding } from "@/utils/branding";
import { useInstituteFeatureStore } from "@/stores/insititute-feature-store";
import { hasLearnerSession } from "@/lib/auth/session-guard";
import { isPasswordlessLandingRoute } from "@/lib/auth/passwordless-landing-routes";
import { getSubdomain } from "@/helpers/helper";
import { getStudentDisplaySettings } from "@/services/student-display-settings";
import { loadLearnerTrackingSettings } from "@/services/learner-tracking-settings";
import {
  INSTITUTE_SELECTED_EVENT,
  resolvePostLoginRoute,
} from "@/lib/auth/post-login-redirect";
import type { StudentUIType } from "@/types/student-display-settings";
import {
  resolveDomainRouting,
  getCurrentDomainInfo,
} from "@/services/domain-routing";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { ChatbotPanel } from "@/components/chatbot/ChatbotPanel";
import { ChatbotProvider } from "@/components/chatbot/ChatbotContext";
import { getChatbotSettings } from "@/services/chatbot-settings";
import { ChatbotFloatingButton } from "@/components/chatbot/ChatbotFloatingButton";
import { OtaUpdateBanner } from "@/components/ota-update/OtaUpdateBanner";
import { ChildViewBanner } from "@/components/parent/ChildViewBanner";
import { GetAppBanner } from "@/components/common/get-app-banner";
import { AppOverlayHost } from "@/components/announcements/AppOverlayHost";
import { getUserId } from "@/constants/getUserId";
import { useOfflineInit } from "@/hooks/offline/useOfflineInit";
import { RevokedDeviceDialog } from "@/components/common/offline/revoked-device-dialog";
import { useLiveTestStore } from "@/stores/live-test-store";
import { resolveUiSkin } from "@/utils/institute-theme-roles";
import { matchesCataloguePost } from "@/lib/catalogue-post-route";

// Define public routes that don't require authentication
const PUBLIC_ROUTES = [
  "/try", // Public demo tutor lesson (tutezy.ai)
  "/login",
  "/signup",
  "/register",
  "/login/forgot-password",
  "/login/oauth",
  "/signup/oauth",
  "/privacy-policy",
  "/terms-and-conditions",
  "/referral",
  "/planning/planning-logs",
  "/planning/activity-logs",
  "/live-class-guest",
  "/study-library/live-class/",
  "/learner-invitation-response",
  "/payment-result",
  "/audience-response",
  "/booking-response", // Public Calendly-style booking page
  "/booking-manage", // Public manage-booking page (token link)
  "/sub-org-registration", // Public sub-org self-registration wizard
  "/kyc-complete", // DigiLocker redirect landing (sub-org registration KYC)
  "/institute-selection",
  "/delete-user",
  "/change-password",
  "/logout",
  "/session-terminated",
  "/courses", // Course catalog should be public
  "/courses/course-details", // Course details should be public for browsing
  "/un", // Public unsubscribe links
  "/m", // Public media hosting page
  "/admission/payment", // Public admission payment links shared by institutes
  "/pay/invoice", // Shareable invoice payment links
  "/leaderboard", // Public shareable course leaderboard
  "/site-assistant-embed", // Site Assistant iframe on institutes' own websites
];

// Marketplace / external-payment route prefixes that are hidden when the app
// is in App-Store "reader mode" (native iOS always, or a reader-mode
// institute). Apple Guideline 3.1.1 — no external-gateway purchases in-app.
// These overlap with PUBLIC_ROUTES, so the reader-mode guard in beforeLoad
// must run BEFORE the public-route bypass. The dynamic catalogue routes
// (/{tagName}, /{tagName}/{courseId}) are guarded at the component level
// instead to avoid path-matching false positives.
const READER_BLOCKED_PATH_PREFIXES = [
  "/courses",
  "/product-pages",
  "/admission/payment",
  "/pay",
  "/payment-result",
  // Sub-org self-registration ends in a Razorpay/Cashfree checkout wizard
  // (and /sub-org-registration/payment-result) — an external-gateway purchase.
  "/sub-org-registration",
  // Parent portal "Payment" tab embeds Razorpay for admission/fee payment.
  // Only the payment sub-route is blocked; the rest of /parent stays reachable.
  "/parent/payment",
];

const isReaderBlockedPath = (pathname: string): boolean =>
  READER_BLOCKED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

// Shared with the per-route guards that need the same check (see
// lib/auth/session-guard) so "is this learner signed in?" has one definition.
const isAuthenticated = hasLearnerSession;

// The ?lc= login code this page load has already exchanged (see beforeLoad).
let exchangedLoginCode: string | null = null;

// Helper function to check if a route is public
const isPublicRoute = (pathname: string): boolean => {
  // Explicitly exclude /my-files routes - they always require authentication
  if (pathname.startsWith("/my-files")) {
    return false;
  }

  // Public shareable leaderboard — course (/leaderboard/{id}) AND institute
  // (/leaderboard/institute/{id}). Explicit so 3-segment institute links don't
  // fall through to the auth redirect (the 2-segment "course details" fallback
  // only covered the course link).
  if (pathname === "/leaderboard" || pathname.startsWith("/leaderboard/")) {
    return true;
  }

  // Check for exact matches and startsWith matches
  const directMatch = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  // Passwordless landings deeper than two segments (live-class, profile edit).
  // They sign the learner in themselves, so they must render signed out.
  // Shared with useDomainRouting so the two checks cannot drift apart.
  const isPasswordlessLanding = isPasswordlessLandingRoute(pathname);

  // Course catalogue dynamic routes - any single path segment (tagName)
  const isCourseCatalogueRoute =
    /^\/[^/]+\/?$/.test(pathname) &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/signup") &&
    !pathname.startsWith("/register") &&
    !pathname.startsWith("/privacy-policy") &&
    !pathname.startsWith("/terms-and-conditions") &&
    !pathname.startsWith("/referral") &&
    !pathname.startsWith("/live-class-guest") &&
    !pathname.startsWith("/study-library") &&
    !pathname.startsWith("/learner-invitation-response") &&
    !pathname.startsWith("/institute-selection") &&
    !pathname.startsWith("/delete-user") &&
    !pathname.startsWith("/change-password") &&
    !pathname.startsWith("/logout") &&
    !pathname.startsWith("/courses") &&
    !pathname.startsWith("/assessment") &&
    !pathname.startsWith("/dashboard") &&
    !pathname.startsWith("/homework") &&
    !pathname.startsWith("/learning-centre") &&
    !pathname.startsWith("/user-profile") &&
    !pathname.startsWith("/study-library") &&
    !pathname.startsWith("/Coursetile") &&
    !pathname.startsWith("/planning") &&
    !pathname.startsWith("/my-files") &&
    !pathname.startsWith("/parent-portal");

  // Course details dynamic routes - /{tagName}/{courseId}
  // Check if it's exactly two path segments and not a system route
  const pathSegments = pathname
    .split("/")
    .filter((segment) => segment.length > 0);
  const isCourseDetailsRoute =
    pathSegments.length === 2 &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/signup") &&
    !pathname.startsWith("/register") &&
    !pathname.startsWith("/privacy-policy") &&
    !pathname.startsWith("/terms-and-conditions") &&
    !pathname.startsWith("/referral") &&
    !pathname.startsWith("/live-class-guest") &&
    !pathname.startsWith("/study-library") &&
    !pathname.startsWith("/learner-invitation-response") &&
    !pathname.startsWith("/institute-selection") &&
    !pathname.startsWith("/delete-user") &&
    !pathname.startsWith("/change-password") &&
    !pathname.startsWith("/logout") &&
    !pathname.startsWith("/courses") &&
    !pathname.startsWith("/assessment") &&
    !pathname.startsWith("/dashboard") &&
    !pathname.startsWith("/homework") &&
    !pathname.startsWith("/learning-centre") &&
    !pathname.startsWith("/user-profile") &&
    !pathname.startsWith("/planning") &&
    !pathname.startsWith("/my-files") &&
    !pathname.startsWith("/reports") &&
    !pathname.startsWith("/my-reports") &&
    !pathname.startsWith("/parent-portal");

  const result =
    directMatch ||
    isPasswordlessLanding ||
    isCourseCatalogueRoute ||
    isCourseDetailsRoute;

  console.log("[isPublicRoute] Debug:", {
    pathname,
    pathSegments,
    directMatch,
    isPasswordlessLanding,
    isCourseCatalogueRoute,
    isCourseDetailsRoute,
    result,
  });

  return result;
};

const RootComponent = () => {
  const { setUpdateAvailable } = useUpdate();
  const { setOtaUpdate, setOtaDownloading, setOtaAutoUpdating } =
    useOtaUpdate();
  const { setPrimaryColor } = useTheme();
  const { setInstituteId } = useInstituteFeatureStore();
  const [isChatbotEnabled, setIsChatbotEnabled] = useState(false);
  const [offlineUserId, setOfflineUserId] = useState<string | null>(null);

  // Resolve the logged-in learner's userId so the offline subsystem
  // (download manager resume + event flusher, see useOfflineInit) can be
  // partitioned per-user. Re-resolved on every navigation, not just mount:
  // on a fresh install the shell mounts on the LOGIN screen (no token yet),
  // and without a re-check after login the offline subsystem would stay
  // dormant until the next full app restart. Identical ids are a no-op.
  const offlinePathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    let cancelled = false;
    getUserId().then((id) => {
      if (!cancelled) setOfflineUserId((prev) => (prev === id ? prev : id));
    });
    return () => {
      cancelled = true;
    };
  }, [offlinePathname]);
  useOfflineInit(offlineUserId);

  // Dismiss the index.html boot splash once the app has actually mounted.
  // (It lives OUTSIDE #root — main.tsx refuses to mount into a non-empty root —
  // so the app must remove it explicitly.)
  useEffect(() => {
    const splash = document.getElementById("boot-splash");
    if (!splash) return;
    splash.style.opacity = "0";
    const t = window.setTimeout(() => splash.remove(), 250);
    return () => window.clearTimeout(t);
  }, []);

  const setPrimaryColorFromStorage = async () => {
    const details = await Preferences.get({ key: "InstituteDetails" });
    const parsedDetails = details.value ? JSON.parse(details.value) : null;
    const themeCode = parsedDetails?.institute_theme_code;
    const instituteId = parsedDetails?.id;
    setInstituteId(instituteId);
    if (instituteId === HOLISTIC_INSTITUTE_ID) {
      setPrimaryColor("holistic");
    } else {
      setPrimaryColor(
        themeCode ?? import.meta.env.VITE_DEFAULT_THEME_COLOR ?? "neutral",
      );
    }
  };

  useEffect(() => {
    // Apply tab branding from Preferences (tabText and tabIconFileId) with fallback title
    applyTabBranding(document.title);
    const checkForUpdate = async () => {
      if (Capacitor.getPlatform() === "web") return;

      try {
        const result = await AppUpdate.getAppUpdateInfo();
        if (
          result.updateAvailability === AppUpdateAvailability.UPDATE_AVAILABLE
        ) {
          toast.warning("Update available, please update app...");
          setUpdateAvailable(true);
          if (result.immediateUpdateAllowed) {
            await AppUpdate.performImmediateUpdate();
          }
        }
      } catch (error) {
        console.error("Error checking app update:", error);
      }
    };

    checkForUpdate();

    // OTA live update: confirm current bundle is healthy, then check for updates
    const checkOtaUpdate = async () => {
      const platform = Capacitor.getPlatform();
      if (platform !== "android" && platform !== "ios") return;

      try {
        // Signal that this bundle loaded successfully (prevents auto-rollback)
        await notifyUpdateSuccess();
      } catch (e) {
        console.error("OTA notifyAppReady failed:", e);
      }

      try {
        const result = await checkForOtaUpdate();
        if (result.update_available && result.bundle_download_url) {
          const mode = await getOtaUpdateMode();

          // AUTO mode (fleet default): show a non-dismissible "Updating app…"
          // loader dialog, then download + apply the bundle in place. This runs
          // at launch ONLY, so the set() reload can never wipe a learner's
          // in-progress exam attempt (the reason the old silent path existed).
          // Applies for both optional and force updates.
          if (mode === "auto") {
            try {
              setOtaAutoUpdating(true, result.version ?? null);
              await downloadAndApplyUpdate(
                result.bundle_download_url,
                result.version!,
                result.checksum!,
              );
              // set() reloads the WebView — the line below only runs if it fails.
              setOtaAutoUpdating(false);
            } catch (autoErr) {
              console.error("OTA auto update failed:", autoErr);
              setOtaAutoUpdating(false);
            }
            return;
          }

          // BANNER mode: dismissible banner (optional) or blocking overlay (force).
          setOtaUpdate({
            otaUpdateAvailable: true,
            otaVersion: result.version ?? null,
            otaDownloadUrl: result.bundle_download_url,
            otaChecksum: result.checksum ?? null,
            otaForceUpdate: result.force_update ?? false,
            otaReleaseNotes: result.release_notes ?? null,
          });

          if (result.force_update) {
            try {
              setOtaDownloading(true);
              await downloadAndApplyUpdate(
                result.bundle_download_url,
                result.version!,
                result.checksum!,
              );
              // set() reloads the app — this line only runs if it doesn't
              setOtaDownloading(false);
            } catch (downloadErr) {
              console.error("OTA force update download failed:", downloadErr);
              setOtaDownloading(false);
            }
          } else {
            toast.info(`Update ${result.version} available`);
          }
        }
      } catch (e) {
        console.error("OTA update check failed:", e);
      }
    };
    checkOtaUpdate();

    setPrimaryColorFromStorage();

    // Fetch chatbot settings and enable floating button if enabled in settings
    getChatbotSettings(false)
      .then((settings) => setIsChatbotEnabled(settings?.enable === true))
      .catch(() => setIsChatbotEnabled(false));
    // Apply global ui-vibrant class based on override/settings and expose debug helpers
    const applyUiType = (t: StudentUIType) => {
      const root = document.documentElement;
      root.classList.remove(
      "ui-vibrant",
      "ui-play",
      "ui-cleaner-play",
      "ui-corporate"
    );
      if (t === "vibrant") root.classList.add("ui-vibrant");
      else if (t === "play") root.classList.add("ui-play");
      else if (t === "cleanerPlay") root.classList.add("ui-cleaner-play");
      else if (t === "corporate") root.classList.add("ui-corporate");
    };

    const DEBUG_KEY = "DEBUG_UI_TYPE";
    try {
      const override = (localStorage.getItem(DEBUG_KEY) || "") as StudentUIType;
      if (
        override === "vibrant" ||
        override === "default" ||
        override === "play" ||
        override === "cleanerPlay" ||
        override === "corporate"
      ) {
        applyUiType(override);
      } else {
        getStudentDisplaySettings(false)
          // THEME_SETTING.roles.skin wins; ui.type is the pre-migration
          // fallback (see resolveUiSkin — there is no migration job).
          .then((s) =>
            applyUiType(
              resolveUiSkin((s?.ui?.type as StudentUIType) ?? null) as StudentUIType
            )
          )
          .catch(() => {
            /* ignore */
          });
      }
      // Warm the learner-activity tracking config cache (dwell times, idle
      // popup timers, completion threshold) so the slide viewers can read it
      // synchronously. Fire-and-forget; defaults apply until it lands.
      void loadLearnerTrackingSettings().catch(() => {});
    } catch (e) {
      console.warn("Failed to read DEBUG_UI_TYPE", e);
    }

    // Debug console helpers
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      w.setStudentUIType = (type: StudentUIType) => {
        try {
          localStorage.setItem(DEBUG_KEY, type);
        } catch (e) {
          console.warn("setStudentUIType: failed to persist", e);
        }
        applyUiType(type);
      };
      w.getStudentUIType = () => {
        try {
          return localStorage.getItem(DEBUG_KEY) || "(using settings)";
        } catch (e) {
          console.warn("getStudentUIType: failed", e);
          return "(using settings)";
        }
      };
      w.clearStudentUIType = () => {
        try {
          localStorage.removeItem(DEBUG_KEY);
        } catch (e) {
          console.warn("clearStudentUIType: failed to clear", e);
        }
        getStudentDisplaySettings(false)
          // THEME_SETTING.roles.skin wins; ui.type is the pre-migration
          // fallback (see resolveUiSkin — there is no migration job).
          .then((s) =>
            applyUiType(
              resolveUiSkin((s?.ui?.type as StudentUIType) ?? null) as StudentUIType
            )
          )
          .catch(() => applyUiType("default"));
      };
    } catch (e) {
      console.warn("Failed to initialize UI debug helpers", e);
    }

    // The loads above ran once, on mount. If that mount came before a
    // multi-institute learner picked an institute (full page load onto
    // /institute-selection), getInstituteId() answered the token's first
    // institute. Reload the same institute-keyed settings for the pick.
    const onInstituteSelected = () => {
      getChatbotSettings(false)
        .then((settings) => setIsChatbotEnabled(settings?.enable === true))
        .catch(() => setIsChatbotEnabled(false));
      let override = "";
      try {
        override = localStorage.getItem(DEBUG_KEY) || "";
      } catch {
        /* ignore */
      }
      if (
        !["vibrant", "default", "play", "cleanerPlay", "corporate"].includes(
          override
        )
      ) {
        getStudentDisplaySettings(false)
          .then((s) =>
            applyUiType(
              resolveUiSkin((s?.ui?.type as StudentUIType) ?? null) as StudentUIType
            )
          )
          .catch(() => {
            /* ignore */
          });
      }
      void loadLearnerTrackingSettings().catch(() => {});
    };
    window.addEventListener(INSTITUTE_SELECTED_EVENT, onInstituteSelected);
    return () =>
      window.removeEventListener(INSTITUTE_SELECTED_EVENT, onInstituteSelected);
    // We intentionally skip deps here to avoid re-running in StrictMode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Android hardware back button handler (native mobile only)
  // Prevents the default WebView back behavior from navigating to an empty
  // page (which triggers the auth guard and logs the user out). On root-level
  // screens like /dashboard, minimize the app instead of navigating back.
  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;

    const ROOT_ROUTES = [
      "/dashboard",
      "/learning-centre",
      "/user-profile",
      "/homework",
      "/my-files",
      "/courses",
      "/login",
      "/",
    ];

    // The institute may configure a custom post-login landing route
    // (STUDENT_DISPLAY_SETTINGS.postLoginRedirectRoute) that isn't one of the
    // built-in root routes above. Treat that landing route as an exit route
    // too, so hardware back on the learner's home screen minimizes the app
    // instead of walking history back toward /login. Read from cache (already
    // populated at login); a missing/failed lookup just leaves ROOT_ROUTES.
    let landingRoute: string | null = null;
    getStudentDisplaySettings()
      .then((s) => {
        const r = s?.postLoginRedirectRoute?.trim();
        if (r && !/^https?:\/\//.test(r)) {
          landingRoute = r.split("?")[0].split("#")[0];
        }
      })
      .catch(() => {});

    const isRootRoute = (path: string) => {
      const routes = landingRoute
        ? [...ROOT_ROUTES, landingRoute]
        : ROOT_ROUTES;
      return routes.some(
        (r) => path === r || path === `${r}/` || path.startsWith(`${r}?`),
      );
    };

    let handle: { remove: () => void } | null = null;

    App.addListener("backButton", ({ canGoBack }) => {
      // A screen that must not be backed out of (e.g. a live test) registers a
      // guard. Capacitor runs every listener, so without this check we would
      // navigate away underneath that screen's own warning modal.
      if (runBackGuard()) return;

      const currentPath = window.location.pathname;
      if (!canGoBack || isRootRoute(currentPath)) {
        App.minimizeApp();
      } else {
        window.history.back();
      }
    }).then((h) => {
      handle = h;
    });

    return () => {
      if (handle) handle.remove();
    };
  }, []);

  // Native OAuth deep-link listener (Android/iOS)
  // When the system browser completes OAuth and redirects to our public URL,
  // the deep link fires appUrlOpen with the tokens in the URL.
  useEffect(() => {
    const platform = Capacitor.getPlatform();
    if (platform !== "android" && platform !== "ios") return;

    let listenerHandle: { remove: () => void } | null = null;

    const setup = async () => {
      listenerHandle = await App.addListener("appUrlOpen", async (event) => {
        console.log("[OAuth DeepLink] appUrlOpen:", event.url);
        try {
          const url = new URL(event.url);
          const accessToken = url.searchParams.get("accessToken");
          const refreshToken = url.searchParams.get("refreshToken");

          if (accessToken && refreshToken) {
            // Close the in-app browser that was opened for OAuth
            try {
              const { closeSystemBrowser } = await import(
                "@/lib/auth/nativeOAuth"
              );
              await closeSystemBrowser();
            } catch {
              /* browser may already be closed */
            }

            // Perform full auth cycle (store tokens, fetch details)
            const { performFullAuthCycle } = await import(
              "@/services/auth-cycle-service"
            );
            const { getTokenDecodedData } = await import(
              "@/lib/auth/sessionUtility"
            );
            const decoded = getTokenDecodedData(accessToken);
            // Several institutes on the token: open this app's own institute,
            // not whichever one the backend happened to list first.
            const { pickLoginInstituteId } = await import(
              "@/lib/auth/pick-login-institute"
            );
            const pickedInstituteId = await pickLoginInstituteId(
              decoded?.authorities,
              decoded?.user,
              url.searchParams.get("instituteId"),
            );
            const instituteId =
              pickedInstituteId ||
              (decoded?.authorities &&
                Object.keys(decoded.authorities)[0]);

            if (instituteId) {
              await performFullAuthCycle(
                { accessToken, refreshToken },
                instituteId,
              );
              // getInstituteId() reads this first: pin it to the institute just
              // hydrated so a pick (or a stale value from an earlier login on
              // this device) can never disagree with InstituteDetails.
              await Preferences.set({
                key: "selectedInstituteId",
                value: instituteId,
              });
              console.log(
                "[OAuth DeepLink] Auth cycle complete, navigating to dashboard",
              );
              // Navigate to dashboard (use replace so back button doesn't go to login)
              window.location.replace(
                `${window.location.origin}/dashboard`,
              );
            } else {
              console.warn(
                "[OAuth DeepLink] Could not extract instituteId from token",
              );
              if (import.meta.env.VITE_ENABLE_SENTRY === "true") {
                Sentry.captureMessage(
                  "OAuth deep link: no instituteId in token",
                  {
                    level: "warning",
                    tags: { feature: "auth", "auth.stage": "oauth_deeplink" },
                  },
                );
              }
              toast.error("Login failed. Please try again.");
            }
          } else if (url.searchParams.get("error")) {
            // OAuth error or signup-needed scenario
            const message =
              url.searchParams.get("message") || "Authentication failed";
            console.warn("[OAuth DeepLink] OAuth error:", message);
            toast.error(message);
          }
        } catch (err) {
          console.error("[OAuth DeepLink] Error processing deep link:", err);
          if (import.meta.env.VITE_ENABLE_SENTRY === "true") {
            Sentry.captureException(err, {
              tags: { feature: "auth", "auth.stage": "oauth_deeplink" },
            });
          }
          toast.error("Login failed. Please try again.");
        }
      });
    };

    setup();

    return () => {
      if (listenerHandle) listenerHandle.remove();
    };
  }, []);

  // Global OAuth completion listener (storage/BroadcastChannel) to redirect parent
  useEffect(() => {
    // Skip in popup windows to avoid navigating inside the popup
    const isPopupWindow = (() => {
      try {
        if (window.opener && !window.opener.closed) return true;
      } catch {}
      try {
        if (window.name && window.name.toLowerCase() === "oauth_popup")
          return true;
      } catch {}
      try {
        const q = new URLSearchParams(window.location.search);
        if (q.get("popup") === "1") return true;
      } catch {}
      return false;
    })();

    if (isPopupWindow) {
      return;
    }

    let processed = false;

    const redirectWithTokens = (accessToken: string, refreshToken: string) => {
      if (processed) return;
      processed = true;
      try {
        const next = new URL("/login", window.location.origin);
        next.searchParams.set("accessToken", accessToken);
        next.searchParams.set("refreshToken", refreshToken);
        window.location.assign(next.toString());
      } catch (err) {
        void err;
      }
    };

    const storageHandler = (e: StorageEvent) => {
      if (!e) return;
      if (e.key === "OAUTH_RESULT" && e.newValue) {
        let parsed: {
          isModalLogin?: boolean;
          type?: string;
          data?: { accessToken?: string; refreshToken?: string };
        } | null = null;
        try {
          parsed = JSON.parse(e.newValue);
          // Only process page-level OAuth (isModalLogin === false), NOT modal OAuth
          if (
            parsed?.isModalLogin === false &&
            parsed?.type === "oauth_success" &&
            parsed?.data
          ) {
            const data: { accessToken?: string; refreshToken?: string } =
              parsed.data || {};
            const { accessToken, refreshToken } = data;
            if (accessToken && refreshToken) {
              redirectWithTokens(accessToken, refreshToken);
            }
          }
        } catch {
          // ignore
        } finally {
          // Clean up if it was a page-level login
          if (parsed?.isModalLogin === false) {
            try {
              localStorage.removeItem("OAUTH_RESULT");
            } catch (err) {
              void err;
            }
          }
        }
      }
    };

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        bc = new BroadcastChannel("OAUTH_CHANNEL");
        bc.onmessage = (ev: MessageEvent) => {
          const msg = ev?.data;
          if (!msg || typeof msg !== "object") return;
          // Only process page-level OAuth (isModalLogin === false), NOT modal OAuth
          if (
            msg.isModalLogin === false &&
            msg.type === "oauth_success" &&
            msg.data
          ) {
            const data: { accessToken?: string; refreshToken?: string } =
              msg.data || {};
            const { accessToken, refreshToken } = data;
            if (accessToken && refreshToken) {
              redirectWithTokens(accessToken, refreshToken);
            }
          }
        };
      }
    } catch (err) {
      void err;
    }

    // Immediate check in case popup wrote before listeners attached
    try {
      const existing = localStorage.getItem("OAUTH_RESULT");
      if (existing) {
        const parsed = JSON.parse(existing);
        // Only process page-level OAuth (isModalLogin === false), NOT modal OAuth
        if (
          parsed?.isModalLogin === false &&
          parsed?.type === "oauth_success" &&
          parsed?.data
        ) {
          const data: { accessToken?: string; refreshToken?: string } =
            parsed.data || {};
          const { accessToken, refreshToken } = data;
          if (accessToken && refreshToken) {
            redirectWithTokens(accessToken, refreshToken);
          }
        }
        // Only remove if it was a page-level login
        if (parsed?.isModalLogin === false) {
          localStorage.removeItem("OAUTH_RESULT");
        }
      }
    } catch (err) {
      void err;
    }

    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener("storage", storageHandler);
      try {
        if (bc) bc.close();
      } catch (err) {
        void err;
      }
    };
  }, []);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onCataloguePost = useRouterState({ select: (s) => matchesCataloguePost(s.matches) });

  // A live assessment attempt owns the viewport. The chatbot is suppressed for
  // the whole attempt on every device — it is an AI assistant sitting on top of
  // a proctored paper, and its launcher covers the exam's own bottom-right
  // controls. Banners and full-screen announcements follow the institute's
  // "hide app navigation" toggle, since those only push the exam's safe zone
  // around rather than posing an integrity problem.
  const isLiveTestActive = useLiveTestStore((s) => s.isActive);
  const hideLiveTestChrome = useLiveTestStore((s) => s.hideAppChrome);
  // The Site Assistant iframe (public/site-assistant.js) sits on someone
  // else's website: nothing of the app's own chrome may paint in it.
  const isSiteAssistantEmbed = pathname.startsWith("/site-assistant-embed");
  const suppressAppChrome = (isLiveTestActive && hideLiveTestChrome) || isSiteAssistantEmbed;
  const hideChatbot = pathname.startsWith("/admission") || isLiveTestActive || isSiteAssistantEmbed;

  // ── Sentry: tag events with the current route. Navigation breadcrumbs
  // come from the SDK's built-in history instrumentation; a custom one here
  // just duplicated them. ──
  const prevPathRef = useRef(pathname);
  useEffect(() => {
    if (import.meta.env.VITE_ENABLE_SENTRY !== "true") return;
    if (pathname !== prevPathRef.current) {
      Sentry.setTag("route", pathname);
      prevPathRef.current = pathname;
    }
  }, [pathname]);

  return (
    <ChatbotProvider>
      {!suppressAppChrome && <ChildViewBanner />}
      {!suppressAppChrome && <OtaUpdateBanner />}
      {!suppressAppChrome && <GetAppBanner />}
      <Outlet />
      {/* Full-screen APP_OVERLAY announcements — authenticated app surfaces only */}
      {!isPublicRoute(pathname) && !onCataloguePost && !suppressAppChrome && <AppOverlayHost />}
      {!hideChatbot && <ChatbotPanel />}
      {!hideChatbot && isChatbotEnabled && <ChatbotFloatingButton />}
      <RevokedDeviceDialog />
    </ChatbotProvider>
  );
};

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  beforeLoad: async ({ location, matches }) => {
    const isPublic = isPublicRoute(location.pathname) || matchesCataloguePost(matches);
    console.log("[__root] Checking route:", location.pathname);
    console.log("[__root] Is public route:", isPublic);

    // Global Auto-Login Support via URL Tokens (?sso=true&accessToken=...&refreshToken=...&redirect=/dashboard)
    // Read from both window and router location so params are found on first load
    const searchString =
      (typeof window !== "undefined" && window.location.search) ||
      location.search ||
      "";
    const urlParams = new URLSearchParams(searchString);
    const urlAccessToken = urlParams.get("accessToken");
    const urlRefreshToken = urlParams.get("refreshToken");
    const redirectPath = urlParams.get("redirect");

    if (urlAccessToken && urlRefreshToken) {
      console.log("[__root] Detected tokens in URL, performing auto-login...");
      try {
        const { performFullAuthCycle } =
          await import("@/services/auth-cycle-service");
        const { getTokenDecodedData } =
          await import("@/lib/auth/sessionUtility");
        const decoded = getTokenDecodedData(urlAccessToken);
        // Several institutes on the token: open the link's / this host's own
        // institute, not whichever one the backend happened to list first.
        const { pickLoginInstituteId } =
          await import("@/lib/auth/pick-login-institute");
        const pickedInstituteId = await pickLoginInstituteId(
          decoded?.authorities,
          decoded?.user,
          urlParams.get("instituteId"),
        );
        // Institute ID is the first key in JWT authorities, or fallback to institute_id claim
        const instituteId =
          pickedInstituteId ||
          (decoded?.authorities && Object.keys(decoded.authorities)[0]) ||
          (decoded as { institute_id?: string })?.institute_id;

        if (instituteId) {
          await performFullAuthCycle(
            { accessToken: urlAccessToken, refreshToken: urlRefreshToken },
            instituteId,
          );
          // getInstituteId() reads this first: pin it to the institute just
          // hydrated so a pick (or a stale value from an earlier login on this
          // device) can never disagree with InstituteDetails.
          await Preferences.set({
            key: "selectedInstituteId",
            value: instituteId,
          });

          // Honor redirect param (e.g. ?redirect=%2Fdashboard -> /dashboard);
          // otherwise land on the institute's configured post-login route.
          const isSafeRedirectParam =
            !!redirectPath &&
            redirectPath.startsWith("/") &&
            !redirectPath.startsWith("//");
          const resolvedPath = await resolvePostLoginRoute({
            explicitRedirect: isSafeRedirectParam ? redirectPath : null,
          });
          // Can't external-redirect from beforeLoad (same rule as the '/' handler
          // below), so an absolute landing URL falls back to the internal default.
          const targetPath = /^https?:\/\//.test(resolvedPath)
            ? "/dashboard"
            : resolvedPath;

          console.log(
            "[__root] Auto-login complete, redirecting to:",
            targetPath,
          );
          // Full page redirect so the next load sees auth state and no token params in URL
          const origin =
            typeof window !== "undefined" ? window.location.origin : "";
          window.location.replace(`${origin}${targetPath}`);
          throw redirect({ to: targetPath as never });
        } else {
          console.warn("[__root] SSO: could not get instituteId from token", {
            hasAuthorities: !!decoded?.authorities,
            authorityKeys: decoded?.authorities
              ? Object.keys(decoded.authorities)
              : [],
          });
        }
      } catch (error) {
        if (error instanceof Response) throw error;
        console.error("[__root] Auto-login via URL failed:", error);
      }
    }

    // Login code from a passwordless link (?lc=<code>), minted by our services or
    // an institute's own server (auth-service login-codes). Works on any route:
    // exchange it for tokens, then reload the same URL without it. The backend
    // honours a code only for an institute that has switched on "require a login
    // code" (off by default). Otherwise, or if the code fails, it is dropped and
    // the route behaves exactly as it would without one: the username routes fall
    // back to their own trusted-login form (which shows "link expired" once the
    // institute requires a code).
    const loginCode = urlParams.get("lc");
    if (
      loginCode &&
      loginCode !== exchangedLoginCode &&
      typeof window !== "undefined" &&
      !(urlAccessToken && urlRefreshToken)
    ) {
      // Once per page. The redirect thrown below re-runs this beforeLoad while
      // the URL still carries ?lc= (location.replace has not landed yet), and a
      // second exchange is a second trusted login, which deletes the refresh
      // token the first one just stored.
      exchangedLoginCode = loginCode;
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("lc");
      const cleanPath = `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`;
      try {
        const { default: axios } = await import("axios");
        const { LOGIN_BY_USERNAME_TRUSTED } = await import("@/constants/urls");
        const response = await axios.post(LOGIN_BY_USERNAME_TRUSTED, {
          code: loginCode,
        });
        const accessToken: string | undefined = response.data?.accessToken;
        const refreshToken: string | undefined = response.data?.refreshToken;
        if (accessToken && refreshToken) {
          const { performFullAuthCycle } =
            await import("@/services/auth-cycle-service");
          const { getTokenDecodedData } =
            await import("@/lib/auth/sessionUtility");
          const { pickLoginInstituteId } =
            await import("@/lib/auth/pick-login-institute");
          const decoded = getTokenDecodedData(accessToken);
          const instituteId =
            (await pickLoginInstituteId(
              decoded?.authorities,
              decoded?.user,
              urlParams.get("instituteId"),
            )) ||
            (decoded?.authorities && Object.keys(decoded.authorities)[0]);
          if (instituteId) {
            await performFullAuthCycle({ accessToken, refreshToken }, instituteId);
            await Preferences.set({
              key: "selectedInstituteId",
              value: instituteId,
            });
            console.log("[__root] Login code accepted, reloading:", cleanPath);
            window.location.replace(`${window.location.origin}${cleanPath}`);
            throw redirect({ to: cleanUrl.pathname as never });
          }
        }
      } catch (error) {
        if (error instanceof Response) throw error;
        console.warn("[__root] Login code was not accepted:", error);
      }
      window.history.replaceState(window.history.state, "", cleanPath);
    }

    // Reader-mode guard: on native iOS (always) or a reader-mode institute,
    // marketplace + external-payment routes must never render (Apple 3.1.1).
    // Runs before the public-route bypass because those routes are "public".
    if (
      isReaderBlockedPath(location.pathname) &&
      shouldHidePaidPurchaseUI()
    ) {
      console.log(
        "[__root] Reader mode active — blocking marketplace/payment route:",
        location.pathname,
      );
      const authed = await isAuthenticated();
      throw redirect({ to: authed ? "/dashboard" : "/login" });
    }

    // The public tutor lesson reuses the tutor route with a guest token.
    // During a client-side navigate, window.location.search still holds the PREVIOUS
    // url, so the parsed location.search is checked too. And the router's default
    // stringifier JSON-encodes values that are themselves valid JSON, so the flag
    // arrives as demo="1" (quoted) from /try and as demo=1 when typed by hand —
    // getting this wrong sends a guest to the login screen, which is what the
    // "no sign-up" lesson promises will never happen.
    const demoFlagIsSet = (value: unknown): boolean =>
      value === 1 || (typeof value === "string" && value.replace(/^"|"$/g, "") === "1");
    const rawDemoParam =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("demo")
        : null;
    const parsedDemoParam =
      location.search && typeof location.search === "object"
        ? (location.search as Record<string, unknown>).demo
        : null;
    const isGuestTutor =
      location.pathname.startsWith("/study-library/courses/course-details/tutor") &&
      (demoFlagIsSet(rawDemoParam) || demoFlagIsSet(parsedDemoParam));
    // Skip all logic for public routes - they should work without any redirects
    if (isPublic || isGuestTutor) {
      console.log("[__root] Route is public, skipping authentication check");
      return;
    }

    // Handle root path redirect
    if (location.pathname === "/") {
      try {
        // If already authenticated, redirect to settings.postLoginRedirectRoute
        const authenticated = await isAuthenticated();
        if (authenticated) {
          const settings = await getStudentDisplaySettings(true);
          await getChatbotSettings(true);
          const route = settings?.postLoginRedirectRoute || "/dashboard";
          // Support external absolute URLs
          if (/^https?:\/\//.test(route)) {
            // Can't external-redirect from beforeLoad; fall back to internal default
            throw redirect({ to: "/dashboard" });
          }
          throw redirect({ to: route as never });
        }
      } catch (error) {
        // Re-throw redirects so the router can handle them
        if (error instanceof Response) throw error;
        // fallthrough to public handling
      }

      // New domain routing logic for unauthenticated users
      try {
        const { domain, subdomain } = await getCurrentDomainInfo();

        // Use actual domain and subdomain (or "*" if no subdomain)
        const testSubdomain = subdomain || "*";

        // Try to resolve domain routing
        const domainRoutingResult = await resolveDomainRouting(
          domain,
          testSubdomain,
        );

        if (domainRoutingResult) {
          // A host with a root-mounted catalogue serves it right here at "/"
          // (routes/index.tsx) — bouncing to "/<tag>" is exactly what that
          // flag exists to stop. resolveDomainRouting has already cached the
          // tag for the route component and every link builder.
          if ((domainRoutingResult.rootCatalogueTag || "").trim()) {
            return;
          }
          // API returned valid institute data, use the redirect field from API response
          const redirectPath = domainRoutingResult.redirect || "/courses";
          throw redirect({ to: redirectPath as never });
        }

        // Fallback to old logic for backward compatibility
        const fallbackSubdomain = getSubdomain(window.location.hostname);
        if (fallbackSubdomain === "code-circle") {
          throw redirect({ to: "/courses" });
        }
      } catch (error) {
        if (
          error instanceof Response &&
          [301, 302, 303, 307, 308].includes(error.status)
        ) {
          console.log(
            "[__root] Caught redirect Response in root block. Rethrowing.",
            {
              status: error.status,
            },
          );
          throw error;
        }
        console.error("Error resolving domain routing:", error);
        // Domain routing error, continuing to fallback logic
      }

      console.log("[__root] Redirecting unauthenticated user to /login");
      throw redirect({ to: "/login" });
    }

    // NOTE: postLoginRedirectRoute is a *landing* route, applied when a learner
    // logs in (see the login forms and the '/' redirect above). It must not be
    // enforced as a standing guard on /dashboard — that made the Dashboard nav
    // item permanently unreachable for any institute that changed the setting.

    // Check authentication for all other routes
    const authenticated = await isAuthenticated();
    if (!authenticated) {
      // For deep links (non-root paths), preserve the URL through the auth flow
      // so the user lands back on the page after login. Domain routing redirects
      // shouldn't strip the deep-link target.
      const isDeepLink = location.pathname && location.pathname !== "/";
      const deepLinkRedirectUrl = isDeepLink ? location.href : null;

      // New domain routing logic for unauthenticated users
      try {
        const { domain, subdomain } = await getCurrentDomainInfo();

        // Use actual domain and subdomain (or "*" if no subdomain)
        const testSubdomain = subdomain || "*";

        // Try to resolve domain routing
        const domainRoutingResult = await resolveDomainRouting(
          domain,
          testSubdomain,
        );

        if (domainRoutingResult) {
          // API returned valid institute data, use the redirect field from API response
          const redirectPath = domainRoutingResult.redirect || "/courses";

          // If the domain routing sends us to an auth/onboarding route AND the
          // user originally hit a deep link, preserve that deep link as the
          // post-login redirect target. Otherwise the user loses their context.
          if (deepLinkRedirectUrl && /\/(login|signup|register|institute-selection)/i.test(redirectPath)) {
            throw redirect({
              to: redirectPath as never,
              search: { redirect: deepLinkRedirectUrl } as never,
            });
          }

          throw redirect({ to: redirectPath as never });
        }

        // Fallback to old logic for backward compatibility
        const fallbackSubdomain = getSubdomain(window.location.hostname);
        if (fallbackSubdomain === "code-circle") {
          throw redirect({ to: "/courses" });
        }
      } catch (error) {
        if (
          error instanceof Response &&
          [301, 302, 303, 307, 308].includes(error.status)
        ) {
          console.log(
            "[__root] (protected) Caught redirect Response. Rethrowing.",
            {
              status: error.status,
            },
          );
          throw error;
        }
        console.error("Error resolving domain routing:", error);
        // Domain routing error for protected route, continuing to fallback logic
      }

      // Fallback: no domain routing matched. Store the current path as redirect
      // URL for after login. location.href is pathname + searchStr + hash
      // (already serialised). Do NOT use location.pathname + location.search —
      // `search` is the parsed object, concat would produce "[object Object]".
      const redirectUrl = location.href;
      throw redirect({
        to: "/login",
        search: { redirect: redirectUrl } as never,
      });
    }
  },
  component: RootComponent,
});
