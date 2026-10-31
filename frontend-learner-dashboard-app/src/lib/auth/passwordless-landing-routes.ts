/**
 * Passwordless landing routes deeper than two segments. Each one renders for a
 * signed-out visitor and signs them in itself (trusted login, or the `?lc=`
 * login code), so nothing may bounce it to /login before it gets the chance.
 *
 * Two places need this answer and used to keep separate copies: the root
 * route's public-route check, and useDomainRouting's "don't redirect here"
 * checks. The second copy missed /user-profile/edit/<username>, so the hook
 * sent already-signed-in learners to the domain's /login redirect.
 *
 * Two-segment landings (/go/<username>, /subscriptions/<username>,
 * /sub-org-learners/<username>) need no entry: both callers already treat any
 * /<a>/<b> path as public.
 */
const PASSWORDLESS_LANDING_ROUTES: RegExp[] = [
  /^\/study-library\/live-class\/[^/]+\/?$/,
  /^\/user-profile\/edit\/[^/]+\/?$/,
];

export const isPasswordlessLandingRoute = (pathname: string): boolean =>
  PASSWORDLESS_LANDING_ROUTES.some((pattern) => pattern.test(pathname));
