import { CourseCatalogueData, Page } from "../-types/course-catalogue-types";
import { getCachedRootCatalogueTag } from "@/services/domain-routing";
import { isReservedAppRoute } from "@/services/reserved-app-routes";

/**
 * Route matcher utility for handling dynamic page routing
 * Checks if a route is external, matches it with pages object, and returns normalized route path
 */
export class RouteMatcher {
  /**
   * Check if a route is an external link (http:// or https://)
   */
  static isExternalLink(route: string): boolean {
    return route.startsWith("http://") || route.startsWith("https://");
  }

  /**
   * Normalize a route string for comparison
   * e.g., "homepage" -> "home", "/courses" -> "courses", etc.
   */
  static normalizeRoute(route: string): string {
    return route
      .toLowerCase()
      .replace(/^\//, "") // Remove leading slash
      .replace(/\/$/, "") // Remove trailing slash
      .replace(/^homepage$/, "home") // Map homepage to home
      .trim();
  }

  /**
   * True when `tagName` is the catalogue mounted at this host's ROOT — see
   * `institute_domain_routing.root_catalogue_tag`. A root-mounted catalogue
   * answers on "/" and "/<page>" with no tag segment, so every URL the site
   * builds for itself has to drop the "/<tag>" prefix. Any other catalogue on
   * the same host (a second tag) keeps classic routing untouched.
   */
  static isRootMounted(tagName: string | undefined | null): boolean {
    const root = getCachedRootCatalogueTag();
    if (!root || !tagName) return false;
    return this.normalizeRoute(root) === this.normalizeRoute(tagName);
  }

  /** "/<tag>" for a classic catalogue, "" for the root-mounted one. */
  static basePath(tagName: string): string {
    if (!tagName || this.isRootMounted(tagName)) return "";
    return `/${tagName}`;
  }

  /**
   * The ONE place that turns (tag, page-route) into a path. Home collapses to
   * the base ("/" when root-mounted); everything else is "<base>/<route>".
   */
  static pagePath(tagName: string, route?: string | null): string {
    const base = this.basePath(tagName);
    // Trim slashes but keep the author's casing: the page component matches
    // `page.route === pageSlug` exactly, so lowercasing here would turn a
    // route like "Toddler-Reset" into a link to a page that reports not found.
    const clean = (route || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
    if (this.normalizeRoute(clean) === "home" || clean === "") return base || "/";
    // Root-mounted, but the page is named like one of the app's own routes
    // ("privacy-policy", "courses", "login"...): "/<page>" would open the
    // app's page, not the catalogue's. Keep the tagged address, which the
    // root-mounted host still serves (see isReservedRootPage).
    if (!base && tagName && this.isReservedRootPage(tagName, clean)) {
      return `/${tagName}/${clean}`;
    }
    return `${base}/${clean}`;
  }

  /**
   * A page of the root-mounted catalogue that cannot live at "/<page>"
   * because the learner app answers that path itself. Such a page is
   * addressed as "/<tag>/<page>" instead, and the "/<tag>/..." →
   * "/<page>" canonical redirect must leave it alone.
   */
  static isReservedRootPage(tagName: string, pageSlug: string): boolean {
    return this.isRootMounted(tagName) && isReservedAppRoute(pageSlug);
  }

  /**
   * Path segments AFTER the catalogue base: ["about"] for both "/new/about"
   * and, when `new` is root-mounted, "/about". Callers that need "which page
   * am I on" read this instead of counting segments themselves.
   */
  static segmentsAfterBase(pathname: string, tagName: string): string[] {
    const segs = pathname.split("/").filter(Boolean);
    if (this.isRootMounted(tagName)) {
      // A legacy "/<tag>/..." URL on a root-mounted host still means the same page.
      return segs[0] && this.normalizeRoute(segs[0]) === this.normalizeRoute(tagName)
        ? segs.slice(1)
        : segs;
    }
    const idx = segs.indexOf(tagName);
    return idx >= 0 ? segs.slice(idx + 1) : segs.slice(1);
  }

  /**
   * Find a matching page in the catalogue pages array
   * Matches by route, id, or normalized names
   */
  static findMatchingPage(
    route: string,
    pages: Page[]
  ): Page | undefined {
    if (!pages || pages.length === 0) {
      return undefined;
    }

    const normalizedRoute = this.normalizeRoute(route);

    // Exact route match
    let matchedPage = pages.find(
      (page) => this.normalizeRoute(page.route) === normalizedRoute
    );

    if (matchedPage) {
      return matchedPage;
    }

    // Exact id match
    matchedPage = pages.find(
      (page) => this.normalizeRoute(page.id) === normalizedRoute
    );

    if (matchedPage) {
      return matchedPage;
    }

    // Partial match (useful for pages like "course-list" matching "courses")
    matchedPage = pages.find(
      (page) =>
        this.normalizeRoute(page.route).includes(normalizedRoute) ||
        normalizedRoute.includes(this.normalizeRoute(page.route)) ||
        this.normalizeRoute(page.id).includes(normalizedRoute) ||
        normalizedRoute.includes(this.normalizeRoute(page.id))
    );

    if (matchedPage) {
      return matchedPage;
    }
    return undefined;
  }

  /**
   * Get the navigation route for a given page
   * Returns either the page id or route, depending on what's defined
   */
  static getPageNavigationRoute(page: Page, tagName: string): string {
    // Use the page route/id that is defined
    const routeId = page.route || page.id;
    
    // If it's already a full path, return as-is
    if (routeId.startsWith("/")) {
      return routeId;
    }

    // "/<tag>/<route>" — or "/<route>" when this catalogue is mounted at the
    // host's root. pagePath() owns that rule so no caller re-derives it.
    return this.pagePath(tagName, routeId);
  }

  /**
   * Process navigation routes from catalogue data
   * Checks each route and returns valid navigation items with matched pages
   */
  static processNavigationRoutes(
    navigationItems: Array<{ label: string; route: string }>,
    catalogueData: CourseCatalogueData,
    tagName: string
  ): Array<{
    label: string;
    route: string;
    isExternal: boolean;
    matchedPage?: Page;
  }> {
    return navigationItems.map((item) => {
      const isExternal = this.isExternalLink(item.route);
      
      if (isExternal) {
        return {
          label: item.label,
          route: item.route,
          isExternal: true,
        };
      }

      // Try to find a matching page
      const matchedPage = this.findMatchingPage(item.route, catalogueData.pages);

      if (matchedPage) {
        const finalRoute = this.pagePath(tagName, item.route);

        return {
          label: item.label,
          route: finalRoute,
          isExternal: false,
          matchedPage,
        };
      }

      // If no matching page, but route looks like an internal route, keep it
      // This allows for routes to pages not yet loaded
      return {
        label: item.label,
        route: item.route,
        isExternal: false,
      };
    });
  }

  /**
   * Process footer links with route matching
   */
  static processFooterLinks(
    links: Array<{ label: string; route: string }>,
    catalogueData: CourseCatalogueData,
    tagName: string
  ): Array<{
    label: string;
    route: string;
    isExternal: boolean;
    matchedPage?: Page;
  }> {
    return this.processNavigationRoutes(links, catalogueData, tagName);
  }

  /**
   * Validate if a current pathname matches a page route
   * Useful for highlighting active navigation items
   */
  static isRouteActive(
    currentPath: string,
    navRoute: string,
    tagName: string
  ): boolean {
    const normalizedCurrent = this.normalizeRoute(currentPath);
    const normalizedNav = this.normalizeRoute(navRoute);

    // Remove tagName from current path for comparison
    const pathWithoutTag = normalizedCurrent
      .replace(new RegExp(`^${this.normalizeRoute(tagName)}`), "")
      .replace(/^\//, "");

    // Check various matches
    return (
      normalizedCurrent === normalizedNav ||
      normalizedNav === normalizedCurrent ||
      pathWithoutTag === normalizedNav ||
      `${this.normalizeRoute(tagName)}/${pathWithoutTag}` === normalizedNav
    );
  }

  /**
   * Extract route information from a pathname
   */
  static extractRouteInfo(
    pathname: string,
    tagName: string
  ): {
    tagName: string;
    pageRoute: string | null;
    isHomePage: boolean;
  } {
    const segments = pathname.split("/").filter(Boolean);

    // If only one segment, it's the tagName
    if (segments.length === 1) {
      return {
        tagName: segments[0],
        pageRoute: null,
        isHomePage: true,
      };
    }

    // If two segments, first is tagName, second is page route
    if (segments.length >= 2) {
      return {
        tagName: segments[0],
        pageRoute: segments.slice(1).join("/"),
        isHomePage: false,
      };
    }

    return {
      tagName,
      pageRoute: null,
      isHomePage: true,
    };
  }
}

