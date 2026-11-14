import { createFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useAssessmentDashboardStore } from './-store/useAssessmentDashboardStore';
import {
    parseAssessmentDashboardUrl,
    type AssessmentDashboardUrlState,
} from './-utils/assessment-dashboard-utils';

// Recharts and the dashboard load only when this page is opened.
const AssessmentDashboard = lazy(() => import('./-components/assessment-dashboard'));

const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value ? value : undefined;

/**
 * Assessment Dashboard (sidebar: Assessments and Tests → Assessment Dashboard).
 * The optional search params mirror the filters, so a refresh or a bookmarked
 * URL reopens the same range, batches and test types.
 */
export const Route = createFileRoute('/assessment/dashboard/')({
    validateSearch: (search: Record<string, unknown>): AssessmentDashboardUrlState => ({
        from: text(search.from),
        to: text(search.to),
        batches: text(search.batches),
        types: text(search.types),
    }),
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('assessmentDashboard');
    const { setNavHeading } = useNavHeadingStore();
    const search = Route.useSearch();
    const title = t('hero.title');

    // Filters in the URL are applied once, before the dashboard's first request.
    useState(() => {
        const linked = parseAssessmentDashboardUrl(search);
        if (linked.range || linked.batchIds.length || linked.playModes.length) {
            useAssessmentDashboardStore.setState({
                ...(linked.range
                    ? { startDate: linked.range.start, endDate: linked.range.end }
                    : {}),
                batchIds: linked.batchIds,
                playModes: linked.playModes,
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
                <AssessmentDashboard />
            </Suspense>
        </LayoutContainer>
    );
}
