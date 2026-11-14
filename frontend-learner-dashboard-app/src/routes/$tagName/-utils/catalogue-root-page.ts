/**
 * Which catalogue page is the home page — the one the site serves at its root.
 *
 * One rule for everything that asks (the header / mobile-bar CTAs in catalogue-cta.ts and the
 * catalogue listing lookup in catalogue-page-routes.tsx): a page whose route is "homepage", "/"
 * or "" is the root page; only when no page has such a route does the page with id "home" count.
 * Route first, so a site that moved its old home page elsewhere (its route changed, its id did
 * not) resolves to the page actually at the root, not to the old one.
 *
 * Dependency-free so both callers (and their tests) can share it.
 */

/** Routes that put a page at the site root. */
export const ROOT_PAGE_ROUTES: readonly string[] = ["homepage", "/", ""];

export interface RootPageCandidate {
  id?: string | null;
  route?: string | null;
}

/** The page's route puts it at the root. */
export const hasRootRoute = (page: RootPageCandidate | null | undefined): boolean =>
  typeof page?.route === "string" && ROOT_PAGE_ROUTES.includes(page.route);

/**
 * A test for "this page is served at the root" under the rule above, for this page list: by
 * route when any page has a root route, else by id "home".
 */
export const servedAtRootIn = (
  pages: ReadonlyArray<RootPageCandidate | null | undefined> | null | undefined,
): ((page: RootPageCandidate | null | undefined) => boolean) => {
  const byRoute = (pages || []).some(hasRootRoute);
  return (page) => !!page && (byRoute ? hasRootRoute(page) : page.id === "home");
};

/** The page served at the root (the first, should several qualify), or undefined. */
export const findRootPage = <P extends RootPageCandidate>(
  pages: ReadonlyArray<P | null | undefined> | null | undefined,
): P | undefined => {
  const atRoot = servedAtRootIn(pages);
  return (pages || []).find((page): page is P => atRoot(page));
};
