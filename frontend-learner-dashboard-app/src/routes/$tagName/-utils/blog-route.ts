import { RouteMatcher } from "../-services/route-matcher";

/**
 * Which blog post (if any) a catalogue URL addresses, for the blog section on
 * the page at `pageRoute`.
 *
 *   /<site>/<page>/<slug>   the post's own address
 *   /<site>/?post=<slug>    a blog placed on the home page, where a trailing
 *                           segment would collide with page and course routes
 *
 * Shared by BlogComponent (list vs. article), JobOpeningsComponent (cards vs.
 * one job, same address shape) and CourseCataloguePage, which
 * shows only the blog section while an article is open so the article reads as
 * a page of its own instead of one band among the page's other sections.
 */
export const isHomeRoute = (route: string) => {
  const r = RouteMatcher.normalizeRoute(route || "");
  return r === "" || r === "home";
};

export function blogPostSlugFor(
  pathname: string,
  searchStr: string,
  tagName: string,
  pageRoute: string,
  /** The home-page query key: `post` for the blog, `job` for job openings. */
  queryKey = "post"
): string | null {
  const fromQuery = new URLSearchParams(searchStr || "").get(queryKey);
  if (fromQuery) return fromQuery;
  if (isHomeRoute(pageRoute)) return null;
  const segs = RouteMatcher.segmentsAfterBase(pathname, tagName);
  if (segs.length >= 2 && RouteMatcher.normalizeRoute(segs[0]) === RouteMatcher.normalizeRoute(pageRoute)) {
    try {
      return decodeURIComponent(segs[1]);
    } catch {
      return segs[1];
    }
  }
  return null;
}
