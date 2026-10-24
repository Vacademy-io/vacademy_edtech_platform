/**
 * Whether a nav entry should be highlighted for `pathname`.
 *
 * Matching stays the historical `pathname.includes(route)`, so every page that
 * lit an entry before still does. The one change: when a longer route of
 * another entry also matches, that entry owns the page. Without it, "All
 * Courses" (/study-library) lit up together with "My Live Class"
 * (/study-library/live-class), and an entry with no route ("/") lit up
 * everywhere.
 */
export const isNavRouteActive = (
  pathname: string,
  route: string | undefined,
  allRoutes: ReadonlyArray<string | undefined>
): boolean => {
  if (!route || !pathname.includes(route)) return false;
  return !allRoutes.some(
    (other) => !!other && other.length > route.length && pathname.includes(other)
  );
};

/**
 * Routes that can claim `pathname` in the sidebar: each plain entry's route,
 * plus a group's sub-item link only when it is exactly the current path —
 * that is the only time the group itself lights up, so a deeper page under a
 * sub-item must not take the highlight away from anything else.
 */
export const collectSidebarNavRoutes = (
  items: ReadonlyArray<{
    to?: string;
    subItems?: ReadonlyArray<{ subItemLink?: string }>;
  }>,
  pathname: string
): string[] =>
  items.flatMap((item) =>
    item.subItems && item.subItems.length > 0
      ? item.subItems.flatMap((s) =>
          s.subItemLink && s.subItemLink === pathname ? [s.subItemLink] : []
        )
      : item.to
        ? [item.to]
        : []
  );
