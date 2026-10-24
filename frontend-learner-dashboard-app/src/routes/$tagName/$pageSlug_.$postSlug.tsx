/**
 * A blog post on a catalogue page: /<tag>/<blog-page>/<slug>.
 *
 * The page itself is looked up exactly as /<tag>/<blog-page> is; the trailing
 * segment is read by the page's `blog` section (BlogComponent) to show one
 * article instead of the list. The `_` in the file name keeps this route from
 * nesting under $pageSlug.tsx, which renders no <Outlet/>.
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { RouteMatcher } from "./-services/route-matcher";
import { CatalogueTagContext } from "./-components/CatalogueTagContext";
import { retainSiteLanguage } from "./-utils/catalogue-route-search";
import { CourseCataloguePage } from "./-components/CourseCataloguePage";
import { useDomainRouting } from "@/hooks/use-domain-routing";
import { DashboardLoader } from "@/components/core/dashboard-loader";
import RootNotFoundComponent from "@/components/core/default-not-found";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/$tagName/$pageSlug_/$postSlug")({
  // Keep the visitor's site language (?lang=) across catalogue navigation
  // (sites with languages only; a no-op everywhere else).
  search: { middlewares: [retainSiteLanguage] },
  component: RouteComponent,
});

function RouteComponent() {
  const params = Route.useParams() as { tagName: string; pageSlug: string; postSlug: string };
  const domainRouting = useDomainRouting();
  const [hasRetried, setHasRetried] = useState(false);

  const tagName = params.tagName || "";
  const pageSlug = params.pageSlug || "";
  const postSlug = params.postSlug || "";

  useEffect(() => {
    if (!domainRouting.isLoading && !domainRouting.instituteId && !hasRetried) {
      setHasRetried(true);
      domainRouting.resolveRouting();
    }
  }, [domainRouting.isLoading, domainRouting.instituteId, hasRetried, domainRouting]);

  if (!tagName || !pageSlug) return <DashboardLoader />;
  if (domainRouting.isLoading || (!domainRouting.instituteId && !hasRetried)) return <DashboardLoader />;
  if (!domainRouting.instituteId) return <RootNotFoundComponent />;

  // "/new/blog/<slug>" on a host where `new` is mounted at the root → "/blog/<slug>".
  if (RouteMatcher.isRootMounted(tagName) && !RouteMatcher.isReservedRootPage(tagName, pageSlug)) {
    return (
      <Navigate
        to={`/${pageSlug}/${encodeURIComponent(postSlug)}` as never}
        search={true}
        replace
      />
    );
  }

  return (
    <CatalogueTagContext.Provider value={tagName}>
      <CourseCataloguePage
        tagName={tagName}
        instituteId={domainRouting.instituteId}
        instituteThemeCode={domainRouting.instituteThemeCode}
        pageSlug={pageSlug}
      />
    </CatalogueTagContext.Provider>
  );
}
