/**
 * First path segments the learner app itself owns ("/login", "/courses",
 * "/privacy-policy", ...). A catalogue mounted at a host's root
 * (institute_domain_routing.root_catalogue_tag) serves its pages at
 * "/<page>", so a page whose route matches one of these can never be reached
 * that way — the static app route wins the match and the visitor lands on,
 * say, Vacademy's own privacy policy instead of the institute's page. Those
 * pages keep the "/<tag>/<page>" address, which a root-mounted host still
 * serves.
 *
 * Fed from the live route tree in main.tsx so a new top-level route can never
 * drift out of sync with a hand-kept list.
 */
let reservedSegments: Set<string> = new Set();

export const registerAppRoutePaths = (paths: Iterable<string>): void => {
  const next = new Set<string>();
  for (const path of paths) {
    const first = path.split("/").filter(Boolean)[0];
    // "$tagName" and friends are params, not reserved names.
    if (!first || first.startsWith("$")) continue;
    next.add(first.toLowerCase());
  }
  reservedSegments = next;
};

/** True when `route`'s first segment is a page the app answers itself. */
export const isReservedAppRoute = (route: string): boolean => {
  const first = route.split("/").filter(Boolean)[0];
  return !!first && reservedSegments.has(first.toLowerCase());
};
