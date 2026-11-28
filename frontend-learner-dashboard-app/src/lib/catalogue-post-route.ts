/**
 * A catalogue blog post, /<tag>/<page>/<slug> (routes/$tagName/$pageSlug_.$postSlug).
 *
 * The auth guard (__root) and the domain-routing redirect decide "public" by
 * path shape, and know one- and two-segment catalogue paths only. A
 * three-segment path cannot be told apart from an app page by its shape, so
 * these go by the route the router actually matched: static app routes always
 * outrank this all-dynamic one, so it only matches when no app page does.
 */
export const CATALOGUE_POST_ROUTE_ID = "/$tagName/$pageSlug_/$postSlug";

export const matchesCataloguePost = (matches: ReadonlyArray<{ routeId: string }>): boolean =>
  matches.some((m) => m.routeId === CATALOGUE_POST_ROUTE_ID);
