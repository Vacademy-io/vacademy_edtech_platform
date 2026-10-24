import { createFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';
import { useLiveClassDashboardStore } from '../-store/useLiveClassDashboardStore';
import { parseDashboardUrl, type DashboardUrlState } from '../-utils/dashboard-export';

// Recharts and the dashboard load only when this page is opened.
const LiveClassDashboard = lazy(() => import('../-components/dashboard/live-class-dashboard'));

const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value ? value : undefined;

/**
 * Live Session Dashboard (sidebar: Live Sessions → Dashboard). The optional
 * search params mirror the filters, so a refresh or a bookmarked URL reopens the same
 * range, batches and teachers.
 */
export const Route = createFileRoute('/study-library/live-session/dashboard/')({
    validateSearch: (search: Record<string, unknown>): DashboardUrlState => ({
        from: text(search.from),
        to: text(search.to),
        batches: text(search.batches),
        teachers: text(search.teachers),
    }),
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('studyLibraryLiveClassDashboard');
    const { setNavHeading } = useNavHeadingStore();
    const search = Route.useSearch();
    const title = t('hero.title', {
        term: getTerminology(ContentTerms.LiveSession, SystemTerms.LiveSession),
    });

    // Filters in the URL are applied once, before the dashboard's first request.
    useState(() => {
        const linked = parseDashboardUrl(search);
        if (linked.range || linked.batchIds.length || linked.teacherIds.length) {
            useLiveClassDashboardStore.setState({
                ...(linked.range
                    ? { startDate: linked.range.start, endDate: linked.range.end }
                    : {}),
                batchIds: linked.batchIds,
                teacherIds: linked.teacherIds,
            });
        }
        return null;
    });

    useEffect(() => {
        setNavHeading(title);
    }, [setNavHeading, title]);

    return (
        <LayoutContainer>
            <Helmet>
                <title>{title}</title>
                <meta name="description" content={t('page.description')} />
            </Helmet>
            <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
                <LiveClassDashboard />
            </Suspense>
        </LayoutContainer>
    );
}
