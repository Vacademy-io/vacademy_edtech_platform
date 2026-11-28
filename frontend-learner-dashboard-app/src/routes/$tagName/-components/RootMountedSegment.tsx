import React, { lazy, Suspense, useEffect, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import { CourseCatalogueService } from "../-services/course-catalogue-service";
import { RouteMatcher } from "../-services/route-matcher";
import { CatalogueTagContext } from "./CatalogueTagContext";
import type { CourseCatalogueData } from "../-types/course-catalogue-types";

const CourseCataloguePage = lazy(() =>
  import("./CourseCataloguePage").then((m) => ({ default: m.CourseCataloguePage })),
);
const CourseDetailsPage = lazy(() =>
  import("../$courseId/-components/CourseDetailsPage").then((m) => ({
    default: m.CourseDetailsPage,
  })),
);

const looksLikeCourseId = (segment: string) =>
  /^\d+$/.test(segment) ||
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment);

/**
 * Decides what a single URL segment means on a host whose root is a catalogue.
 *
 * With `new` mounted at the root, "/about" no longer says which catalogue it
 * belongs to — the `$tagName` route sees "about" as a tag. Three readings are
 * possible and they are checked in this order:
 *
 *   1. a page of the root catalogue      → render that page  ("/about")
 *   2. a course/book id                  → course details    ("/<uuid>")
 *   3. neither                           → `fallback`: the segment really is
 *      another catalogue's tag on the same host ("/CourseCollections"), which
 *      keeps its classic "/<tag>/..." routing untouched.
 *
 * Only reading 1 needs data — the root catalogue's page list — and it comes
 * through the memoised fetch, so the page that then renders reuses the same
 * request instead of downloading the catalogue twice.
 */
export const RootMountedSegment: React.FC<{
  rootTag: string;
  segment: string;
  instituteId: string;
  instituteThemeCode?: string | null;
  fallback: React.ReactNode;
  /**
   * Only readings 1 and 3: the URL has a further segment after this one
   * ("/blog/<post-slug>"), which a course details page has no meaning for.
   */
  pageOnly?: boolean;
}> = ({ rootTag, segment, instituteId, instituteThemeCode, fallback, pageOnly = false }) => {
  // The `/$tagName/` route validates no search params, so read them loosely —
  // a root-mounted course link carries the same ?enrollInviteId=… the tagged
  // one does.
  const search = useSearch({ strict: false }) as Record<string, string | undefined>;
  const [verdict, setVerdict] = useState<"loading" | "page" | "course" | "other">(
    !pageOnly && looksLikeCourseId(segment) ? "course" : "loading",
  );

  useEffect(() => {
    if (!pageOnly && looksLikeCourseId(segment)) {
      setVerdict("course");
      return;
    }
    let cancelled = false;
    setVerdict("loading");
    CourseCatalogueService.getCourseCatalogueByTagMemo(instituteId, rootTag)
      .then((data: CourseCatalogueData) => {
        if (cancelled) return;
        const wanted = RouteMatcher.normalizeRoute(segment);
        const isPage = (data.pages || []).some(
          (p) =>
            RouteMatcher.normalizeRoute(p.route || "") === wanted ||
            RouteMatcher.normalizeRoute(p.id || "") === wanted,
        );
        setVerdict(isPage ? "page" : "other");
      })
      .catch(() => {
        // If the root catalogue cannot be read, behave exactly as before the
        // feature existed rather than blanking a URL that used to work.
        if (!cancelled) setVerdict("other");
      });
    return () => {
      cancelled = true;
    };
  }, [instituteId, rootTag, segment, pageOnly]);

  if (verdict === "loading") return <DashboardLoader />;
  if (verdict === "other") return <>{fallback}</>;

  return (
    <CatalogueTagContext.Provider value={rootTag}>
      <Suspense fallback={<DashboardLoader />}>
        {verdict === "course" ? (
          <CourseDetailsPage
            courseId={segment}
            tagName={rootTag}
            instituteId={instituteId}
            instituteThemeCode={instituteThemeCode}
            enrollInviteId={search.enrollInviteId}
            packageSessionId={search.packageSessionId}
            bannerImage={search.bannerImage}
            level={search.level}
            price={search.price}
            available_slots={
              search.available_slots !== undefined ? Number(search.available_slots) : undefined
            }
            productPageCode={search.productPageCode}
          />
        ) : (
          <CourseCataloguePage
            tagName={rootTag}
            instituteId={instituteId}
            instituteThemeCode={instituteThemeCode}
            pageSlug={segment}
          />
        )}
      </Suspense>
    </CatalogueTagContext.Provider>
  );
};
