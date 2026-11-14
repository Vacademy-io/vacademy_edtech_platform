/**
 * Page addresses that links must not hard-code.
 *
 * - The catalogue (the book / course listing) is not always the home page: a
 *   site can give it a page of its own (e.g. "library") and put something else
 *   at the root. Links that mean "go to the catalogue" resolve its page here
 *   instead of assuming the root. A site whose catalogue IS the home page (or
 *   that has none) gets the root, exactly as before.
 * - A renamed page can keep its former route as an alias (`page.aliases`);
 *   PageAliasRedirect forwards a visit to that old address to the page.
 */
import React, { useEffect, useState } from "react";
import { Navigate } from "@tanstack/react-router";
import { RouteMatcher } from "../-services/route-matcher";
import { CourseCatalogueService } from "../-services/course-catalogue-service";
import type { Page } from "../-types/course-catalogue-types";
import { getCachedRootCatalogueTag } from "@/services/domain-routing";
import { servedAtRootIn } from "./catalogue-root-page";

/** Section types that list what the site sells. */
export const CATALOGUE_LISTING_TYPES: readonly string[] = ["bookCatalogue", "courseCatalog"];

interface ListingPageLike {
  id?: string | null;
  route?: string | null;
  components?: ReadonlyArray<{ type?: string; enabled?: unknown } | null | undefined> | null;
}

const listsCatalogue = (page: ListingPageLike, types: readonly string[]) =>
  (page.components || []).some(
    (c) => !!c && types.includes(c.type ?? "") && c.enabled !== false && c.enabled !== "false",
  );

/**
 * Route of the page that hosts the catalogue ("library"), or "" (the root)
 * when the home page hosts one or no page does. The home page is the one the
 * header resolves too (catalogue-root-page.ts): routed at the root, or with
 * id "home" only when no page is — so a former home page that kept its id but
 * moved to "library" is not mistaken for the root.
 */
export const findCatalogueListingRoute = (
  pages: ReadonlyArray<ListingPageLike | null | undefined> | null | undefined,
  types: readonly string[] = CATALOGUE_LISTING_TYPES,
): string => {
  const hosts = (pages || []).filter(
    (page): page is ListingPageLike => !!page && listsCatalogue(page, types),
  );
  if (hosts.length === 0 || hosts.some(servedAtRootIn(pages))) return "";
  return (hosts[0].route || "").trim().replace(/^\/+|\/+$/g, "");
};

/** The catalogue's path on this host ("/<tag>/library", "/library" root-mounted, or the base). */
export const catalogueListingPath = (
  tagName: string,
  pages: ReadonlyArray<ListingPageLike | null | undefined> | null | undefined,
  types: readonly string[] = CATALOGUE_LISTING_TYPES,
): string => RouteMatcher.pagePath(tagName, findCatalogueListingRoute(pages, types));

/**
 * catalogueListingPath for a section that has no catalogue config in hand:
 * reads the catalogue through the memoised fetch (normally a cache hit — the
 * page that renders the section has just loaded it). Returns the base until
 * that resolves, or when it fails.
 */
export const useCatalogueListingPath = (
  tagName: string,
  instituteId: string | null | undefined,
  types: readonly string[] = CATALOGUE_LISTING_TYPES,
): string => {
  const [route, setRoute] = useState("");
  const typesKey = types.join(",");
  useEffect(() => {
    if (!instituteId || !tagName) return;
    let cancelled = false;
    CourseCatalogueService.getCourseCatalogueByTagMemo(instituteId, tagName)
      .then((data) => {
        if (!cancelled) setRoute(findCatalogueListingRoute(data?.pages, typesKey.split(",")));
      })
      .catch(() => {
        // Keep the base: the link still leads somewhere sensible.
      });
    return () => {
      cancelled = true;
    };
  }, [instituteId, tagName, typesKey]);
  return RouteMatcher.pagePath(tagName, route);
};

/**
 * The catalogue tag a landing path belongs to: the host's root-mounted catalogue when there is
 * one, else the path's first segment ("/collections/x" → "collections"). "" when there is none.
 */
export const catalogueTagOfLandingPath = (landingPath: string, rootTag: string | null): string => {
  if (rootTag) return rootTag;
  const path = (landingPath || "").split(/[?#]/)[0];
  return path.split("/").filter(Boolean)[0] || "";
};

/**
 * Where an "Explore <courses>" button outside the catalogue (the login page) should lead: the
 * catalogue's own listing page when the site gives it one ("/collections/library"), otherwise
 * `landingPath` unchanged — so a site whose catalogue is its home page, or whose landing path is
 * not a catalogue at all, behaves exactly as before. Starts as `landingPath` and switches once the
 * (memoised) catalogue fetch answers; a failed fetch keeps `landingPath`.
 */
export const useCatalogueEntryPath = (
  landingPath: string,
  instituteId: string | null | undefined,
): string => {
  const [resolved, setResolved] = useState<{ from: string; to: string } | null>(null);
  useEffect(() => {
    const tagName = catalogueTagOfLandingPath(landingPath, getCachedRootCatalogueTag());
    if (!instituteId || !tagName || !landingPath || landingPath === "/login") return;
    let cancelled = false;
    CourseCatalogueService.getCourseCatalogueByTagMemo(instituteId, tagName)
      .then((data) => {
        const route = findCatalogueListingRoute(data?.pages);
        if (!cancelled && route) {
          setResolved({ from: landingPath, to: RouteMatcher.pagePath(tagName, route) });
        }
      })
      .catch(() => {
        // Keep the landing path: the button still leads somewhere sensible.
      });
    return () => {
      cancelled = true;
    };
  }, [landingPath, instituteId]);
  return resolved && resolved.from === landingPath ? resolved.to : landingPath;
};

/** A course / book id segment ("/<uuid>", "/123") — never a page, so never an alias. */
export const looksLikeCourseIdSegment = (segment: string): boolean =>
  /^\d+$/.test(segment) ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment);

/**
 * Forwards "<base>/<slug>" to the page that lists `slug` in its `aliases`
 * (keeping the query string). Renders `children` meanwhile and in every other
 * case, so a site without aliases renders exactly as before: the page list
 * comes from the same memoised fetch the page itself makes, and nothing waits
 * on it. Off in the page editor's preview, which addresses pages its own way.
 */
export const PageAliasRedirect: React.FC<{
  instituteId: string;
  tagName: string;
  slug: string;
  enabled?: boolean;
  children: React.ReactNode;
}> = ({ instituteId, tagName, slug, enabled = true, children }) => {
  const [isPreview] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("preview") === "true",
  );
  const active = enabled && !isPreview && !!slug && !!instituteId && !!tagName;
  const key = `${instituteId}::${tagName}`;
  const [loaded, setLoaded] = useState<{ key: string; pages: Page[] } | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    CourseCatalogueService.getCourseCatalogueByTagMemo(instituteId, tagName)
      .then((data) => {
        if (!cancelled) setLoaded({ key: `${instituteId}::${tagName}`, pages: data?.pages ?? [] });
      })
      .catch(() => {
        // The page reports the failure itself; no alias is resolved.
      });
    return () => {
      cancelled = true;
    };
  }, [active, instituteId, tagName]);

  const aliased =
    active && loaded?.key === key ? RouteMatcher.findPageByAlias(slug, loaded.pages) : undefined;
  if (aliased) {
    return <Navigate to={RouteMatcher.pagePath(tagName, aliased.route) as never} search={true} replace />;
  }
  return <>{children}</>;
};
