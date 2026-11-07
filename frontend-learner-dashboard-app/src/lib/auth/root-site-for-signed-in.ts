import { Capacitor } from "@capacitor/core";
import { create } from "zustand";

/**
 * True when the learner app runs as an app rather than a browser tab: native
 * (Android/iOS), Electron, or an installed PWA. All of them start at "/"
 * (the manifest's start_url), so "/" must keep sending a signed-in learner to
 * their dashboard there. Any detection error counts as an app, which keeps the
 * old redirect.
 */
export const isAppShell = (): boolean => {
  try {
    if (Capacitor.getPlatform() !== "web") return true;
    if (typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent)) {
      return true;
    }
    if (typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)")?.matches) {
      return true;
    }
    // iOS Safari's non-standard flag for home-screen launches.
    return (
      typeof navigator !== "undefined" &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return true;
  }
};

/**
 * Whether the institute's logo / Home link (domain routing's
 * home_icon_click_route) points at this host's own root, i.e. the institute
 * explicitly sends learners from the app to the website at "/".
 */
export const homeLinkTargetsSiteRoot = (
  homeIconClickRoute: string | null | undefined,
  origin: string,
): boolean => {
  const raw = (homeIconClickRoute || "").trim();
  if (!raw) return false;
  try {
    const url = new URL(raw, origin);
    return url.origin === origin && (url.pathname === "/" || url.pathname === "");
  } catch {
    return false;
  }
};

/**
 * Whether "/" should render the host's root-mounted website for a signed-in
 * learner instead of the usual landing redirect. Deliberately narrow, so no
 * other institute's "/" changes:
 * - the host has a root catalogue (its website lives at "/");
 * - the institute set its logo / Home link to that root, so "/" is meant to
 *   be the website for its learners too;
 * - a browser tab, not an app shell (they start at "/");
 * - not reader mode (it keeps its landing route);
 * - a live access token; an expired one keeps the redirect, where the app
 *   refreshes it (the site header would otherwise show "logged out").
 * Logging in still lands on the dashboard: the login flows navigate to the
 * post-login route themselves, never to "/".
 */
export const shouldServeRootSiteToSignedIn = (opts: {
  rootCatalogueTag: string | null | undefined;
  homeLinksToSite: boolean;
  appShell: boolean;
  readerMode: boolean;
  accessTokenValid: boolean;
}): boolean =>
  !opts.appShell &&
  !opts.readerMode &&
  opts.accessTokenValid &&
  opts.homeLinksToSite &&
  !!(opts.rootCatalogueTag || "").trim();

/**
 * Set by the root route's "/" check: true only while "/" is showing the
 * website to a signed-in learner, so app-only chrome (full-screen overlays)
 * stays off it. A store, so the root layout re-renders when it flips. Every
 * other host never sets it, so nothing changes there.
 */
export const useRootSiteServed = create<{ served: boolean }>(() => ({
  served: false,
}));
export const setRootSiteServed = (served: boolean): void => {
  if (useRootSiteServed.getState().served !== served) {
    useRootSiteServed.setState({ served });
  }
};
export const isRootSiteServed = (): boolean => useRootSiteServed.getState().served;

/**
 * A `?lc=` login link on "/" reloads "/" once signed in, and that reload must
 * still land on the dashboard as it always did. The login-code handler marks
 * the reload; the "/" check consumes the mark.
 */
const LOGIN_CODE_LANDING_KEY = "vacademy:lc-landing";
export const markLoginCodeLanding = (): void => {
  try {
    sessionStorage.setItem(LOGIN_CODE_LANDING_KEY, "1");
  } catch {
    // storage blocked: the site may show instead of the dashboard, nothing else
  }
};
export const consumeLoginCodeLanding = (): boolean => {
  try {
    const marked = sessionStorage.getItem(LOGIN_CODE_LANDING_KEY) !== null;
    if (marked) sessionStorage.removeItem(LOGIN_CODE_LANDING_KEY);
    return marked;
  } catch {
    return false;
  }
};
