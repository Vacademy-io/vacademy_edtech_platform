import { createFileRoute, redirect, Navigate } from "@tanstack/react-router";
import { RouteMatcher } from "../-services/route-matcher";
import { CatalogueTagContext } from "../-components/CatalogueTagContext";
import { retainSiteLanguage } from "../-utils/catalogue-route-search";
import { CourseDetailsPage } from "./-components/CourseDetailsPage";
import { CourseSubPage } from "../-components/CourseSubPage";
import { RootMountedSegment } from "../-components/RootMountedSegment";
import { getCachedRootCatalogueTag } from "@/services/domain-routing";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import RootNotFoundComponent from "@/components/core/default-not-found";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { hasActiveLearnerSession } from "@/lib/auth/sessionUtility";

export const Route = createFileRoute("/$tagName/$courseId/")({
  // Keep the visitor's site language (?lang=) across catalogue navigation
  // (sites with languages only; a no-op everywhere else).
  search: { middlewares: [retainSiteLanguage] },
  // Reader mode (iOS always / reader-mode institutes): the public course
  // details / enroll page is a marketplace surface — block it (Apple 3.1.1).
  beforeLoad: async () => {
    if (shouldHidePaidPurchaseUI()) {
      // /dashboard is auth-only: sending a logged-OUT learner there bounces
      // back to the institute landing route, which is reader-blocked again —
      // an infinite loop that hangs the app on the boot splash. See
      // hasActiveLearnerSession().
      throw redirect({
        to: (await hasActiveLearnerSession()) ? "/dashboard" : "/login",
      });
    }
  },
  component: RouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    enrollInviteId: (search.enrollInviteId as string) || undefined,
    packageSessionId: (search.packageSessionId as string) || undefined,
    bannerImage: (search.bannerImage as string) || undefined,
    level: (search.level as string) || undefined,
    price: (search.price as string) || undefined,
    // Set when the visitor arrived from a Product Page offer section: the enrol
    // CTA then re-enters that product page's checkout instead of the
    // standalone enroll-invite dialog, so both routes buy the same way.
    productPageCode: (search.productPageCode as string) || undefined,
    available_slots: search.available_slots !== undefined ? Number(search.available_slots) : undefined,
  }),
});

function RouteComponent() {
  const { t } = useTranslation("coursePlayerB");
  const { courseId, tagName } = Route.useParams() as { courseId: string; tagName: string };
  const { enrollInviteId, packageSessionId, bannerImage, level, price, available_slots, productPageCode } = Route.useSearch();
  const domainRouting = useDomainRouting();
  const [hasRetried, setHasRetried] = useState(false);

  // Handle retry logic if domain routing fails initially
  useEffect(() => {
    if (!domainRouting.isLoading && !domainRouting.instituteId && !hasRetried) {
      console.log("[Course Details] Domain routing failed, attempting retry...");
      setHasRetried(true);
      domainRouting.resolveRouting();
    }
  }, [domainRouting.isLoading, domainRouting.instituteId, hasRetried, domainRouting]);

  // Get route params from TanStack Router
  // Sometimes during SPA navigation, params might be undefined momentarily
  // In that case, fall back to parsing the URL directly
  let resolvedCourseId = courseId;
  let resolvedTagName = tagName;
  
  if (!resolvedCourseId || !resolvedTagName) {
    // Fallback: Parse params from URL directly
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 2) {
      resolvedTagName = pathParts[0] || tagName;
      resolvedCourseId = pathParts[1] || courseId;
    }
  }

  // If still no params after URL fallback, show loading (shouldn't happen in normal flow)
  if (!resolvedCourseId || !resolvedTagName) {
    console.log("[Course Details] Waiting for route params...", { courseId, tagName, resolvedCourseId, resolvedTagName });
    return <DashboardLoader />;
  }

  // "/new/<x>" on a host where `new` is mounted at the root → "/<x>", search
  // params included (enrol links carry ?enrollInviteId=…). Not for a page the
  // learner app reserves (e.g. "courses"): the root-mounted site addresses it
  // as "/<tag>/courses" on purpose, and redirecting would land on the app's own
  // /courses instead of the site's Courses page — the same guard $pageSlug uses.
  if (
    RouteMatcher.isRootMounted(resolvedTagName) &&
    !RouteMatcher.isReservedRootPage(resolvedTagName, resolvedCourseId)
  ) {
    return <Navigate to={`/${resolvedCourseId}` as never} search={true} replace />;
  }

  // Check if courseId looks like a course ID (numeric or UUID)
  const isNumeric = /^\d+$/.test(resolvedCourseId);
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedCourseId);
  const isCourseId = isNumeric || isUUID;

  // If this looks like a page name (not a course ID), render the subpage component
  // Only render after domain routing has resolved to ensure instituteId is available
  if (!isCourseId) {
    // Wait for domain routing before rendering subpage
    if (domainRouting.isLoading) {
      return <DashboardLoader />;
    }
    // If no institute ID after loading, pass empty string (subpage will handle it)
    const subPage = (
      <CatalogueTagContext.Provider value={resolvedTagName}>
        <CourseSubPage tagName={resolvedTagName} page={resolvedCourseId} instituteId={domainRouting.instituteId || ''} instituteThemeCode={domainRouting.instituteThemeCode} />
      </CatalogueTagContext.Provider>
    );
    // Root-mounted host: "/blog/<post-slug>" matches THIS route, not $pageSlug,
    // so read the first segment as a root-catalogue page first (as $pageSlug
    // does); only when the root catalogue has no such page is it another tag.
    const rootTag = getCachedRootCatalogueTag();
    if (rootTag && domainRouting.instituteId && !RouteMatcher.isRootMounted(resolvedTagName)) {
      return (
        <RootMountedSegment
          rootTag={rootTag}
          segment={resolvedTagName}
          instituteId={domainRouting.instituteId}
          instituteThemeCode={domainRouting.instituteThemeCode}
          fallback={subPage}
          pageOnly
        />
      );
    }
    return subPage;
  }

  // Show loading while domain routing is resolving
  if (domainRouting.isLoading) {
    return <DashboardLoader />;
  }

  // If there's an error in domain routing, show error
  if (domainRouting.error) {
    console.error("[Course Details] Domain routing error:", domainRouting.error);
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            {t("courseDetailsRoute.domainResolutionErrorTitle")}
          </h2>
          <p className="text-gray-600 mb-4">
            {domainRouting.error}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary-600 text-white rounded-catalogue-sm hover:bg-primary-700"
          >
            {t("courseDetailsRoute.retry")}
          </button>
        </div>
      </div>
    );
  }

  // If no institute ID found after domain routing completes (and retry), show not found
  if (!domainRouting.instituteId) {
    console.warn("[Course Details] No institute ID found after domain routing (and retry)");
    return <RootNotFoundComponent />;
  }


  return (
    <CatalogueTagContext.Provider value={resolvedTagName}>
    <CourseDetailsPage
      courseId={resolvedCourseId}
      tagName={resolvedTagName}
      instituteId={domainRouting.instituteId}
      instituteThemeCode={domainRouting.instituteThemeCode}
      enrollInviteId={enrollInviteId}
      packageSessionId={packageSessionId}
      bannerImage={bannerImage}
      level={level}
      price={price}
      available_slots={available_slots}
      productPageCode={productPageCode}
    />
    </CatalogueTagContext.Provider>
  );
}
