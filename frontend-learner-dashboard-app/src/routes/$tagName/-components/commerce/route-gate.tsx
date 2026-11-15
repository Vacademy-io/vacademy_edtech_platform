/**
 * The only commerce code outside the commerce chunk, part 2: the gate the hosted-site route
 * files use. Small, and it loads the commerce chunk only for a shop route of a site that has
 * a shop.
 */
import React, { Suspense, lazy, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DashboardLoader } from '@/components/core/dashboard-loader';
import { CourseCatalogueService } from '../../-services/course-catalogue-service';
import { isCommerceEnabled } from './config';
import { parseCommerceRoute } from './routes';

const loadEntry = () => import('./entry');
const CommerceRoutePage = lazy(() => loadEntry().then((m) => ({ default: m.CommerceRoutePage })));

/**
 * The commerce branch of the hosted-site routes. `segments` are the path segments after the
 * site's base. When they do not name a shop route, `fallback` renders at once and nothing is
 * fetched: every existing address behaves exactly as before. When they do, the site's
 * catalogue is read (the same cached request the page itself makes) and the shop page renders
 * only if that site has a shop; otherwise `fallback`.
 */
export const CommerceRouteGate: React.FC<{
    instituteId: string;
    /** The catalogue the path belongs to: the root-mounted tag, or the tag in the URL. */
    tagName: string;
    segments: readonly string[];
    fallback: React.ReactNode;
    /** The institute's name, for the titles of shop pages. */
    siteName?: string | null;
}> = ({ instituteId, tagName, segments, fallback, siteName }) => {
    const route = parseCommerceRoute(segments);
    // A "/p/<slug>" or "/c/<slug>" address is a shop page almost by definition: start
    // downloading the shop's code alongside the catalogue request instead of after it. Not
    // for "/cart" and "/search", which are ordinary authored pages on sites without a shop.
    const shopOnly = !!route && (route.kind === 'product' || route.kind === 'collection');
    useEffect(() => {
        if (shopOnly) void loadEntry().catch(() => undefined);
    }, [shopOnly]);
    const { data, isPending } = useQuery({
        // Shared with CatalogueChrome, which draws the header and footer around the shop page.
        queryKey: ['COURSE_CATALOGUE_BY_TAG', instituteId, tagName],
        // The memoised call: on a site WITHOUT a shop the old page mounts next and asks for
        // the same catalogue, and gets this answer instead of a second request.
        queryFn: () => CourseCatalogueService.getCourseCatalogueByTagMemo(instituteId, tagName),
        enabled: !!route && !!instituteId && !!tagName,
        staleTime: 5 * 60 * 1000,
        retry: 1,
    });
    if (!route) return <>{fallback}</>;
    if (isPending) return <DashboardLoader />;
    const globalSettings = data?.globalSettings as unknown;
    if (!data || !isCommerceEnabled(globalSettings)) return <>{fallback}</>;
    return (
        <Suspense fallback={<DashboardLoader />}>
            <CommerceRoutePage instituteId={instituteId} tagName={tagName} globalSettings={globalSettings} siteName={siteName} route={route} />
        </Suspense>
    );
};
