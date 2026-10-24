import { useState, useEffect } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { matchesCataloguePost } from "@/lib/catalogue-post-route";
import { isPasswordlessLandingRoute } from "@/lib/auth/passwordless-landing-routes";
import { Preferences } from "@capacitor/preferences";
import {
  resolveDomainRouting,
  getCurrentDomainInfo,
  DomainRoutingResponse,
  setCachedInstituteBranding,
  setCachedPreferredCountries,
  setCachedPhoneCountryGeoMode,
} from "@/services/domain-routing";
import { useTheme } from "@/providers/theme/theme-provider";
import { useInstituteFeatureStore } from "@/stores/insititute-feature-store";
import { isNullOrEmptyOrUndefined } from "@/lib/utils";
import { applyTabBranding } from "@/utils/branding";
import { getPublicUrlWithoutLogin } from "@/services/upload_file";
import { NAMING_SETTINGS_KEY } from "@/types/naming-settings";
import { notifyNamingSettingsUpdated } from "@/components/common/layout-container/sidebar/utils";
import { upsertInstituteDetails } from "@/services/institute-settings-cache";

export interface DomainRoutingState {
  isLoading: boolean;
  instituteId: string | null;
  instituteName: string | null;
  instituteLogoFileId: string | null;
  instituteThemeCode: string | null;
  redirectPath: string;
  error: string | null;
  homeIconClickRoute: string | null;
  convertUsernamePasswordToLowercase: boolean | null;
  // White-label display overrides. Null = use defaults.
  hideInstituteName: boolean | null;
  logoWidthPx: number | null;
  logoHeightPx: number | null;
  stackNameBelowLogo: boolean | null;
  // Pre-login policy for this portal, straight from domain routing. The login
  // screen must read these from here and NOT from Preferences/localStorage:
  // on a fresh native install neither store has anything yet, and the
  // Preferences read raced the write on every first launch. Null = the
  // backend did not say, callers fall back to their own default.
  allowSignup: boolean | null;
  allowGoogleAuth: boolean | null;
  allowGithubAuth: boolean | null;
  allowEmailOtpAuth: boolean | null;
  allowUsernamePasswordAuth: boolean | null;
  allowPhoneAuth: boolean | null;
}

const NO_AUTH_POLICY = {
  allowSignup: null,
  allowGoogleAuth: null,
  allowGithubAuth: null,
  allowEmailOtpAuth: null,
  allowUsernamePasswordAuth: null,
  allowPhoneAuth: null,
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Institute named by the admin page editor's preview iframe, else null.
 *  Framed only: a top-level visit always resolves by domain as before. */
const getPreviewInstituteId = (): string | null => {
  if (typeof window === "undefined" || window.self === window.top) return null;
  const params = new URLSearchParams(window.location.search);
  const id = params.get("instituteId");
  return params.get("preview") === "true" && id && UUID_RE.test(id) ? id : null;
};

const boolOrNull = (v: unknown): boolean | null =>
  typeof v === "boolean" ? v : null;

const authPolicyFrom = (data: DomainRoutingResponse) => ({
  allowSignup: boolOrNull(data.allowSignup),
  allowGoogleAuth: boolOrNull(data.allowGoogleAuth),
  allowGithubAuth: boolOrNull(data.allowGithubAuth),
  allowEmailOtpAuth: boolOrNull(data.allowEmailOtpAuth),
  allowUsernamePasswordAuth: boolOrNull(data.allowUsernamePasswordAuth),
  allowPhoneAuth: boolOrNull(data.allowPhoneAuth),
});

// Global state to prevent multiple simultaneous domain routing calls
let isResolvingGlobally = false;
let globalDomainRoutingState: DomainRoutingState | null = null;

export const useDomainRouting = () => {
  const navigate = useNavigate();
  const router = useRouter();
  const { setPrimaryColor } = useTheme();
  const { setInstituteId } = useInstituteFeatureStore();

  const [state, setState] = useState<DomainRoutingState>(() => {
    // Initialize from cached global state if available to prevent flash on navigation
    if (globalDomainRoutingState && globalDomainRoutingState.instituteId) {
      return {
        ...globalDomainRoutingState,
        isLoading: false,
      };
    }
    // Default initial state
    return {
      isLoading: true,
      instituteId: null,
      instituteName: null,
      instituteLogoFileId: null,
      instituteThemeCode: null,
      redirectPath: "/login",
      error: null,
      homeIconClickRoute: null,
      convertUsernamePasswordToLowercase: null,
      hideInstituteName: null,
      logoWidthPx: null,
      logoHeightPx: null,
      stackNameBelowLogo: null,
      ...NO_AUTH_POLICY,
    };
  });

  const applyInstituteTheme = (themeCode: string | null) => {
    // Use the existing theme system - the themeCode from API should match the codes in theme.json
    if (themeCode) {
      setPrimaryColor(themeCode);
    } else {
      // If no theme code provided, use default primary theme
      setPrimaryColor("primary");
    }
  };

  const storeInstituteData = async (data: DomainRoutingResponse) => {
    try {
      // Store institute ID in preferences for future use
      await Preferences.set({
        key: "InstituteId",
        value: data.instituteId,
      });

      // Merge-write so we don't clobber institute_settings_json or other
      // fields owned by other writers (enroll-form, useSidebar, the settings
      // cache). This hook runs on every page nav and previously wiped any
      // settings the invite flow had populated.
      await upsertInstituteDetails({
        id: data.instituteId,
        name: data.instituteName,
        logo_file_id: data.instituteLogoFileId,
        institute_logo_file_id: data.instituteLogoFileId,
        institute_theme_code: data.instituteThemeCode,
        home_icon_click_route: data.homeIconClickRoute ?? null,
        homeIconClickRoute: data.homeIconClickRoute ?? null,
        playStoreAppLink: data.playStoreAppLink ?? null,
        appStoreAppLink: data.appStoreAppLink ?? null,
        windowsAppLink: data.windowsAppLink ?? null,
        macAppLink: data.macAppLink ?? null,
        learnerPortalUrl: data.learnerPortalUrl ?? null,
        instructorPortalUrl: data.instructorPortalUrl ?? null,
        hideInstituteName:
          typeof data.hideInstituteName === "boolean"
            ? data.hideInstituteName
            : null,
        logoWidthPx:
          typeof data.logoWidthPx === "number" ? data.logoWidthPx : null,
        logoHeightPx:
          typeof data.logoHeightPx === "number" ? data.logoHeightPx : null,
        stackNameBelowLogo:
          typeof data.stackNameBelowLogo === "boolean"
            ? data.stackNameBelowLogo
            : null,
      });

      // Hand the app/portal links to the sidebar directly as well. The cache
      // write above is not enough on its own: the sidebar fills itself from the
      // navbar's institute-details query, which can resolve before this one and
      // does not look again afterwards.
      try {
        const { default: useSidebarStore } = await import(
          "@/components/common/layout-container/sidebar/useSidebar"
        );
        useSidebarStore.getState().setAppLinks(data as unknown as Record<string, unknown>);
      } catch {
        // Best-effort: the cache write above still covers the common ordering.
      }

      // Store per-institute learner settings for quick access
      // Key: LEARNER_<instituteId>, Values: privacyPolicyUrl, termsAndConditionUrl
      const learnerKey = `LEARNER_${data.instituteId}`;
      const learnerSettings = {
        privacyPolicyUrl: data.privacyPolicyUrl || null,
        termsAndConditionUrl: data.termsAndConditionUrl || null,
        theme: data.theme || data.instituteThemeCode || null,
        fontFamily: data.fontFamily || null,
        allowSignup:
          typeof data.allowSignup === "boolean" ? data.allowSignup : null,
        tabText: data.tabText || null,
        tabIconFileId: data.tabIconFileId || null,
        allowGoogleAuth:
          typeof data.allowGoogleAuth === "boolean"
            ? data.allowGoogleAuth
            : null,
        allowGithubAuth:
          typeof data.allowGithubAuth === "boolean"
            ? data.allowGithubAuth
            : null,
        allowEmailOtpAuth:
          typeof data.allowEmailOtpAuth === "boolean"
            ? data.allowEmailOtpAuth
            : null,
        allowUsernamePasswordAuth:
          typeof data.allowUsernamePasswordAuth === "boolean"
            ? data.allowUsernamePasswordAuth
            : null,
        allowPhoneAuth:
          typeof data.allowPhoneAuth === "boolean"
            ? data.allowPhoneAuth
            : null,
        convertUsernamePasswordToLowercase:
          typeof data.convertUsernamePasswordToLowercase === "boolean"
            ? data.convertUsernamePasswordToLowercase
            : null,
      } as const;
      await Preferences.set({
        key: learnerKey,
        value: JSON.stringify(learnerSettings),
      });

      // Seed a minimal namingSettings entry in localStorage so pre-login
      // screens (e.g. login page) can render institute-specific terminology.
      // This is overwritten with the full set by fetchAndStoreInstituteDetails
      // after the user logs in.
      try {
        const overrides = data.namingOverrides;
        const seed: { key: string; customValue: string }[] = [];
        if (overrides?.course) {
          seed.push({ key: "Course", customValue: overrides.course });
        }
        if (overrides?.coursePlural) {
          seed.push({
            key: "Course_plural",
            customValue: overrides.coursePlural,
          });
        }
        if (overrides?.level) {
          seed.push({ key: "Level", customValue: overrides.level });
        }
        if (overrides?.session) {
          seed.push({ key: "Session", customValue: overrides.session });
        }
        if (overrides?.popularTag) {
          seed.push({ key: "PopularTag", customValue: overrides.popularTag });
        }
        if (seed.length > 0) {
          localStorage.setItem(NAMING_SETTINGS_KEY, JSON.stringify(seed));
          // Terms feed the translation catalogs too (i18n/naming-terms.ts).
          notifyNamingSettingsUpdated();
        }
      } catch (error) {
        console.error("[Domain Routing] Error seeding naming settings:", error);
      }

      // Update tab title and favicon immediately after storing
      await applyTabBranding(document.title);

      // Mirror branding into localStorage for earliest-possible application on next load
      try {
        const tabIconUrl = data.tabIconFileId
          ? await getPublicUrlWithoutLogin(data.tabIconFileId)
          : null;
        const brandingMirror = {
          tabText: data.tabText || null,
          tabIconUrl,
        };
        localStorage.setItem("TabBranding", JSON.stringify(brandingMirror));
      } catch (error) {
        console.error("[Domain Routing] Error storing tab branding:", error);
      }

      setCachedInstituteBranding({
        instituteId: data.instituteId,
        instituteName: data.instituteName,
        instituteLogoFileId: data.instituteLogoFileId,
        instituteThemeCode: data.instituteThemeCode,
        homeIconClickRoute: data.homeIconClickRoute ?? null,
        hideInstituteName:
          typeof data.hideInstituteName === "boolean"
            ? data.hideInstituteName
            : null,
        logoWidthPx:
          typeof data.logoWidthPx === "number" ? data.logoWidthPx : null,
        logoHeightPx:
          typeof data.logoHeightPx === "number" ? data.logoHeightPx : null,
        stackNameBelowLogo:
          typeof data.stackNameBelowLogo === "boolean"
            ? data.stackNameBelowLogo
            : null,
      });

      // Cache preferred countries for synchronous access by phone inputs
      setCachedPreferredCountries(data.commaSeparatedPreferredCountry ?? null);
      // ...and the portal's rule for when the visitor's own country may win.
      setCachedPhoneCountryGeoMode(data.phoneCountryGeoMode ?? null);

      // Update global state
      setInstituteId(data.instituteId);
    } catch (error) {
      console.error("[Domain Routing] Error storing institute data:", error);
    }
  };

  const getFallbackInstituteId = async (): Promise<string | null> => {
    try {
      // Try to get institute ID from localStorage (current logic)
      const { value } = await Preferences.get({ key: "InstituteId" });
      if (!isNullOrEmptyOrUndefined(value)) {
        return value;
      }

      // Try to get from InstituteDetails
      const instituteDetails = await Preferences.get({
        key: "InstituteDetails",
      });
      if (!isNullOrEmptyOrUndefined(instituteDetails.value)) {
        try {
          const parsed = JSON.parse(instituteDetails.value);
          if (parsed.id) {
            return parsed.id;
          }
        } catch (e) {
          console.error("[Domain Routing] Error parsing institute details:", e);
        }
      }

      return null;
    } catch (error) {
      console.error(
        "[Domain Routing] Error getting fallback institute ID:",
        error
      );
      return null;
    }
  };

  const resolveRouting = async () => {
    // Admin page-editor preview (`?preview=true&instituteId=…` in an iframe):
    // the editor names the institute, because one without its own domain
    // would otherwise resolve to the host's institute and its course blocks
    // would show the wrong data. Never persisted or cached — preview only.
    const previewInstituteId = getPreviewInstituteId();
    if (previewInstituteId) {
      setState({
        isLoading: false,
        instituteId: previewInstituteId,
        instituteName: null,
        instituteLogoFileId: null,
        instituteThemeCode: null,
        redirectPath: "/login",
        error: null,
        homeIconClickRoute: null,
        convertUsernamePasswordToLowercase: null,
        hideInstituteName: null,
        logoWidthPx: null,
        logoHeightPx: null,
        stackNameBelowLogo: null,
        ...NO_AUTH_POLICY,
      });
      return;
    }

    // If already resolving globally, use the cached result
    if (isResolvingGlobally && globalDomainRoutingState) {
      setState(globalDomainRoutingState);
      return;
    }

    // If we already have a cached result, use it
    if (globalDomainRoutingState && globalDomainRoutingState.instituteId) {
      setState(globalDomainRoutingState);
      return;
    }

    isResolvingGlobally = true;
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const { domain, subdomain } = await getCurrentDomainInfo();

      // Use actual domain and subdomain (or "*" if no subdomain)
      const testSubdomain = subdomain || "*";
      const testDomain = domain;

      // Resolving with domain: ${testDomain} subdomain: ${testSubdomain}

      // Try API first
      const apiResult = await resolveDomainRouting(testDomain, testSubdomain);

      if (apiResult) {
        // API returned valid institute data
        // API resolved institute successfully

        await storeInstituteData(apiResult);
        applyInstituteTheme(apiResult.instituteThemeCode);

        const newState: DomainRoutingState = {
          isLoading: false,
          instituteId: apiResult.instituteId,
          instituteName: apiResult.instituteName,
          instituteLogoFileId: apiResult.instituteLogoFileId,
          instituteThemeCode: apiResult.instituteThemeCode,
          redirectPath: apiResult.redirect || "/login",
          error: null,
          homeIconClickRoute: apiResult.homeIconClickRoute ?? null,
          convertUsernamePasswordToLowercase: apiResult.convertUsernamePasswordToLowercase ?? null,
          hideInstituteName:
            typeof apiResult.hideInstituteName === "boolean"
              ? apiResult.hideInstituteName
              : null,
          logoWidthPx:
            typeof apiResult.logoWidthPx === "number"
              ? apiResult.logoWidthPx
              : null,
          logoHeightPx:
            typeof apiResult.logoHeightPx === "number"
              ? apiResult.logoHeightPx
              : null,
          stackNameBelowLogo:
            typeof apiResult.stackNameBelowLogo === "boolean"
              ? apiResult.stackNameBelowLogo
              : null,
          ...authPolicyFrom(apiResult),
        };

        // Cache the result globally
        globalDomainRoutingState = newState;
        isResolvingGlobally = false;
        setState(newState);

        return;
      }

      // API returned 404, trying fallback
      const fallbackInstituteId = await getFallbackInstituteId();

      if (fallbackInstituteId) {
        // Using fallback institute ID
        const newState: DomainRoutingState = {
          isLoading: false,
          instituteId: fallbackInstituteId,
          instituteName: null,
          instituteLogoFileId: null,
          instituteThemeCode: null,
          redirectPath: "/login",
          error: null,
          homeIconClickRoute: null,
          convertUsernamePasswordToLowercase: null,
          hideInstituteName: null,
          logoWidthPx: null,
          logoHeightPx: null,
          stackNameBelowLogo: null,
          ...NO_AUTH_POLICY,
        };

        globalDomainRoutingState = newState;
        isResolvingGlobally = false;
        setState(newState);
        return;
      }

      // No institute found anywhere
      const isInvitationRoute = window.location.pathname.startsWith("/learner-invitation-response");
      const newState: DomainRoutingState = {
        isLoading: false,
        instituteId: null,
        instituteName: null,
        instituteLogoFileId: null,
        instituteThemeCode: null,
        // Stay on page for invitation route; otherwise fall back to /login
        redirectPath: isInvitationRoute ? "" : "/login",
        error: null,
        homeIconClickRoute: null,
        convertUsernamePasswordToLowercase: null,
        hideInstituteName: null,
        logoWidthPx: null,
        logoHeightPx: null,
        ...NO_AUTH_POLICY,
      };

      globalDomainRoutingState = newState;
      isResolvingGlobally = false;
      setState(newState);
    } catch (error: unknown) {
      console.error("[Domain Routing] Error in resolveRouting:", error);

      // On API error, try fallback
      try {
        const fallbackInstituteId = await getFallbackInstituteId();

        if (fallbackInstituteId) {
          // Using fallback after API error
          const newState: DomainRoutingState = {
            isLoading: false,
            instituteId: fallbackInstituteId,
            instituteName: null,
            instituteLogoFileId: null,
            instituteThemeCode: null,
            redirectPath: "/login",
            error: null,
            homeIconClickRoute: null,
            convertUsernamePasswordToLowercase: null,
            hideInstituteName: null,
            logoWidthPx: null,
            logoHeightPx: null,
            ...NO_AUTH_POLICY,
          };

          globalDomainRoutingState = newState;
          isResolvingGlobally = false;
          setState(newState);
          return;
        }
      } catch (fallbackError) {
        console.error("[Domain Routing] Fallback also failed:", fallbackError);
      }

      // All fallbacks failed
      const isInvitationRoute = window.location.pathname.startsWith("/learner-invitation-response");
      const newState: DomainRoutingState = {
        isLoading: false,
        instituteId: null,
        instituteName: null,
        instituteLogoFileId: null,
        instituteThemeCode: null,
        // Stay on page for invitation route; otherwise fall back to /login
        redirectPath: isInvitationRoute ? "" : "/login",
        error: error instanceof Error ? error.message : "Unknown error",
        homeIconClickRoute: null,
        convertUsernamePasswordToLowercase: null,
        hideInstituteName: null,
        logoWidthPx: null,
        logoHeightPx: null,
        ...NO_AUTH_POLICY,
      };

      globalDomainRoutingState = newState;
      isResolvingGlobally = false;
      setState(newState);
    }
  };

  const redirectToResolvedPath = () => {
    if (state.redirectPath) {
      // Redirecting to resolved path: ${state.redirectPath}
      navigate({ to: state.redirectPath as never });
    } else if (state.instituteId) {
      // Don't automatically redirect to courses if we're on a public route or course details page
      const currentPath = window.location.pathname;
      const publicRoutes = [
        "/login",
        "/signup",
        "/register",
        "/privacy-policy",
        "/terms-and-conditions",
        "/learner-invitation-response",
        "/payment-result",
        "/un",
        // Public shareable leaderboard (course + institute) — don't redirect away.
        "/leaderboard",
        // Public certificate verification — where a scanned certificate QR
        // lands. Whoever scans it is almost never logged in, so bouncing them
        // to the courses page would break verification entirely.
        "/verify",
      ];
      const isOnPublicRoute = publicRoutes.some((route) =>
        currentPath.startsWith(route)
      );

      // Don't redirect if we're on course details page
      const isOnCourseDetailsPage = currentPath.startsWith(
        "/courses/course-details"
      ) || /^\/[^/]+\/[^/]+\/?$/.test(currentPath);

      // Don't redirect on a passwordless landing (live-class, profile edit):
      // it signs the learner in itself, then moves on.
      const isOnPasswordlessLanding = isPasswordlessLandingRoute(currentPath);

      if (
        isOnPublicRoute ||
        isOnCourseDetailsPage ||
        isOnPasswordlessLanding ||
        matchesCataloguePost(router.state.matches)
      ) {
        return;
      }

      // Redirecting to courses catalog for institute
      navigate({ to: "/courses" });
    } else {
      // Redirecting to default login
      navigate({ to: "/login" });
    }
  };

  useEffect(() => {
    // Only resolve routing if we haven't already resolved it or if we don't have institute data
    if (!state.instituteId && state.isLoading) {
      resolveRouting();
    }
  }, []);

  // Handle redirect when state changes
  useEffect(() => {
    if (!state.isLoading && state.redirectPath) {
      // State updated, redirecting to: ${state.redirectPath}

      // Don't redirect if we're on public routes or course details page
      const currentPath = window.location.pathname;
      const publicRoutes = [
        "/login",
        "/signup",
        "/register",
        "/privacy-policy",
        "/terms-and-conditions",
        "/learner-invitation-response",
        "/payment-result",
        "/un",
        // Public shareable leaderboard (course + institute) — don't redirect away.
        "/leaderboard",
        // Public certificate verification — where a scanned certificate QR
        // lands. Whoever scans it is almost never logged in, so bouncing them
        // to the courses page would break verification entirely.
        "/verify",
      ];
      const isOnPublicRoute = publicRoutes.some((route) =>
        currentPath.startsWith(route)
      );

      // Don't redirect if we're on course details page
      const isOnCourseDetailsPage = currentPath.startsWith(
        "/courses/course-details"
      ) || /^\/[^/]+\/[^/]+\/?$/.test(currentPath);

      // Don't redirect on a passwordless landing (live-class, profile edit):
      // it signs the learner in itself, then moves on.
      const isOnPasswordlessLanding = isPasswordlessLandingRoute(currentPath);

      // Don't redirect if we're on my-files routes
      const isOnMyFilesRoute = currentPath.startsWith("/my-files");

      if (
        isOnPublicRoute ||
        // A blog post on a tagged catalogue site, /<tag>/<page>/<slug>.
        matchesCataloguePost(router.state.matches) ||
        isOnCourseDetailsPage ||
        isOnPasswordlessLanding ||
        isOnMyFilesRoute
      ) {
        return;
      }

      // Only redirect if we're not on the root route (to avoid conflicts with root route logic)
      // and not on a public route like /{tagName}
      const currentPathForRedirect = window.location.pathname;
      const isPublicRouteForRedirect = /^\/[^/]+\/?$/.test(currentPathForRedirect) &&
        !currentPathForRedirect.startsWith('/login') &&
        !currentPathForRedirect.startsWith('/signup') &&
        !currentPathForRedirect.startsWith('/register') &&
        !currentPathForRedirect.startsWith('/privacy-policy') &&
        !currentPathForRedirect.startsWith('/terms-and-conditions') &&
        !currentPathForRedirect.startsWith('/referral') &&
        !currentPathForRedirect.startsWith('/live-class-guest') &&
        !currentPathForRedirect.startsWith('/study-library') &&
        !currentPathForRedirect.startsWith('/learner-invitation-response') &&
        !currentPathForRedirect.startsWith('/institute-selection') &&
        !currentPathForRedirect.startsWith('/delete-user') &&
        !currentPathForRedirect.startsWith('/change-password') &&
        !currentPathForRedirect.startsWith('/logout') &&
        !currentPathForRedirect.startsWith('/un') &&
        !currentPathForRedirect.startsWith('/courses') &&
        !currentPathForRedirect.startsWith('/assessment') &&
        !currentPathForRedirect.startsWith('/dashboard') &&
        !currentPathForRedirect.startsWith('/homework') &&
        !currentPathForRedirect.startsWith('/learning-centre') &&
        !currentPathForRedirect.startsWith('/user-profile') &&
        !currentPathForRedirect.startsWith('/my-files') &&
        !currentPathForRedirect.startsWith('/Coursetile');

      if (window.location.pathname !== "/" && !isPublicRouteForRedirect) {
        // Executing redirect to: ${state.redirectPath}
        redirectToResolvedPath();
      } else if (isPublicRouteForRedirect) {
        console.log("[Domain Routing] On public route, skipping redirect to:", state.redirectPath);
      }
    }
  }, [state.isLoading, state.redirectPath]);

  return {
    ...state,
    resolveRouting,
    redirectToResolvedPath,
  };
};
