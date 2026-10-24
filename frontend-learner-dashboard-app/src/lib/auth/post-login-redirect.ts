import { getStudentDisplaySettings } from "@/services/student-display-settings";

export const DEFAULT_POST_LOGIN_ROUTE = "/dashboard";

/**
 * Fired on window by /institute-selection once a multi-institute learner's
 * institute is chosen and stored. The root layout loads some institute-keyed
 * settings once on mount; if that mount happened before the pick they were
 * resolved for the token's first institute, so it reloads them on this event.
 */
export const INSTITUTE_SELECTED_EVENT = "vacademy:institute-selected";

/**
 * TanStack's `navigate({ to })` only accepts routes it knows about, so every
 * call site in this app already passes `as never`. Accepting `to: never` here
 * lets any `useNavigate()` result be handed to these helpers unchanged.
 */
type PostLoginNavigate = (opts: { to: never; replace?: boolean }) => unknown;

const isAbsoluteUrl = (route: string) => /^https?:\/\//.test(route);

/**
 * `navigate({ to })` drops query strings and cannot leave the origin, so those
 * two shapes need a real page navigation to survive verbatim.
 */
const needsFullPageLoad = (route: string) =>
  isAbsoluteUrl(route) || route.includes("?");

/**
 * The institute's configured landing route (STUDENT_DISPLAY_SETTINGS →
 * postLoginRedirectRoute), applied only at the moment a learner logs in.
 *
 * An explicit deep-link redirect wins over the institute's landing route.
 */
export async function resolvePostLoginRoute(opts?: {
  explicitRedirect?: string | null;
}): Promise<string> {
  const explicit = opts?.explicitRedirect?.trim();
  if (explicit && explicit !== "/login/" && explicit !== "/login") {
    return explicit;
  }

  try {
    // Force-refresh: the institute was only just resolved, and a cached value
    // can be up to a day stale.
    const settings = await getStudentDisplaySettings(true);
    return (
      settings?.postLoginRedirectRoute?.trim() || DEFAULT_POST_LOGIN_ROUTE
    );
  } catch {
    return DEFAULT_POST_LOGIN_ROUTE;
  }
}

/** Send a just-logged-in learner to wherever they belong. */
export async function navigateAfterLogin(
  navigate: PostLoginNavigate,
  opts?: {
    explicitRedirect?: string | null;
    replace?: boolean;
  },
): Promise<void> {
  const route = await resolvePostLoginRoute(opts);

  // Replace the history entry by default so /login is not left in the back
  // stack. On native (Android hardware back), pressing back on the landing
  // screen must exit/minimize the app — not walk history back to /login. This
  // gives first-login the same behaviour as the SSO/auto-login path, which
  // already uses window.location.replace (see __root.tsx). Callers can still
  // opt into a pushed entry with { replace: false }.
  const replace = opts?.replace ?? true;

  if (needsFullPageLoad(route)) {
    if (replace) window.location.replace(route);
    else window.location.assign(route);
    return;
  }

  navigate({ to: route as never, replace });
}
