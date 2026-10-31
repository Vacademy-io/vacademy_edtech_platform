import { createFileRoute, redirect, Navigate } from "@tanstack/react-router";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { getCachedRootCatalogueTag } from "@/services/domain-routing";
import { RouteMatcher } from "./-services/route-matcher";
import { CatalogueTagContext } from "./-components/CatalogueTagContext";
import { retainSiteLanguage } from "./-utils/catalogue-route-search";
import { RootMountedSegment } from "./-components/RootMountedSegment";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import RootNotFoundComponent from "@/components/core/default-not-found";
import { useEffect, useState, lazy, Suspense } from "react";
import { shouldHidePaidPurchaseUI } from "@/utils/ios-iap-compliance";
import { hasActiveLearnerSession } from "@/lib/auth/sessionUtility";

// Code-split the catalogue render tree (JsonRenderer + all section components +
// lead/intro modals) so it loads only when a catalogue route is visited.
const CourseCataloguePage = lazy(() =>
  import("./-components/CourseCataloguePage").then((m) => ({
    default: m.CourseCataloguePage,
  })),
);

const isPreviewUrl = () =>
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("preview") === "true";

export const Route = createFileRoute("/$tagName/")({
  // On a site with languages, the language picked on one page (?lang=hi)
  // follows every link into another catalogue page; on every other site this
  // changes nothing. Catalogue routes only — /login and /dashboard never
  // inherit it.
  search: { middlewares: [retainSiteLanguage] },
  // Reader mode (iOS always / reader-mode institutes): the public course
  // catalogue is a marketplace surface — block it (Apple 3.1.1).
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
});

//console.log("[Course Catalogue] Route file loaded");

function RouteComponent() {
  // console.log("[Course Catalogue] RouteComponent function called");
  const params = Route.useParams() as { tagName: string };
  const domainRouting = useDomainRouting();
  
  // Sometimes during SPA navigation/redirect, params might be undefined momentarily
  // In that case, fall back to parsing the URL directly
  let resolvedTagName = params.tagName || '';
  
  if (!resolvedTagName) {
    // Fallback: Parse params from URL directly
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 1) {
      resolvedTagName = pathParts[0] || '';
    }
  }
    
  // console.log("[Course Catalogue] RouteComponent mounted with tagName:", resolvedTagName);
  const [hasRetried, setHasRetried] = useState(false);

  // Debug logging to track domain routing
  // useEffect(() => {
  //   console.log("[Course Catalogue] Domain routing state:", {
  //     isLoading: domainRouting.isLoading,
  //     instituteId: domainRouting.instituteId,
  //     instituteName: domainRouting.instituteName,
  //     instituteThemeCode: domainRouting.instituteThemeCode,
  //     error: domainRouting.error,
  //   });
  // }, [domainRouting]);

  // Handle retry logic if domain routing fails initially
  useEffect(() => {
    if (!domainRouting.isLoading && !domainRouting.instituteId && !hasRetried) {
      console.log("[Course Catalogue] Domain routing failed, attempting retry...");
      setHasRetried(true);
      domainRouting.resolveRouting();
    }
  }, [domainRouting.isLoading, domainRouting.instituteId, hasRetried, domainRouting]);

  // Guard: If tagName is still not available after URL fallback, show loading
  if (!resolvedTagName) {
    console.log("[Course Catalogue] Waiting for tagName param...", { tagName: params.tagName, resolvedTagName });
    return <DashboardLoader />;
  }

  // Show loading while domain routing is resolving
  // Also show loading if we are in the process of retrying
  if (domainRouting.isLoading || (!domainRouting.instituteId && !hasRetried)) {
   // console.log("[Course Catalogue] Domain routing in progress...");
    return <DashboardLoader />;
  }

  // If there's an error in domain routing, show error
  if (domainRouting.error) {
    //console.error("[Course Catalogue] Domain routing error:", domainRouting.error);
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">
            Domain Resolution Error
          </h2>
          <p className="text-gray-600 mb-4">
            {domainRouting.error}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary-600 text-white rounded-catalogue-sm hover:bg-primary-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // If no institute ID found after domain routing completes, show not found
  if (!domainRouting.instituteId) {
  //  console.warn("[Course Catalogue] No institute ID found after domain routing");
    return <RootNotFoundComponent />;
  }

  // console.log("[Course Catalogue] Rendering course catalogue for:", {
  //   tagName,
  //   instituteId: domainRouting.instituteId,
  //   instituteThemeCode: domainRouting.instituteThemeCode,
  // });

  const classic = (
    <CatalogueTagContext.Provider value={resolvedTagName}>
      <Suspense fallback={<DashboardLoader />}>
        <CourseCataloguePage
          tagName={resolvedTagName}
          instituteId={domainRouting.instituteId}
          instituteThemeCode={domainRouting.instituteThemeCode}
        />
      </Suspense>
    </CatalogueTagContext.Provider>
  );

  // Root-mounted host (institute_domain_routing.root_catalogue_tag): the
  // catalogue answers on "/" so a URL that still carries its tag is a legacy
  // link — forward it to the clean address. Any other single segment is
  // read as a page or course of the root catalogue first, and only then as a
  // second catalogue's tag.
  const rootTag = getCachedRootCatalogueTag();
  if (rootTag) {
    if (RouteMatcher.isRootMounted(resolvedTagName)) {
      // The page editor's preview (?preview=true) must survive the hop, or the
      // root page renders as a normal visit and never answers the editor.
      return isPreviewUrl() ? <Navigate to="/" search={true} replace /> : <Navigate to="/" replace />;
    }
    return (
      <RootMountedSegment
        rootTag={rootTag}
        segment={resolvedTagName}
        instituteId={domainRouting.instituteId}
        instituteThemeCode={domainRouting.instituteThemeCode}
        fallback={classic}
      />
    );
  }

  return classic;
}
