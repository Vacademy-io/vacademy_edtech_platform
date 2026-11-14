/* eslint-disable prettier/prettier */
import { createFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { CaretLeft } from '@phosphor-icons/react';
import { useNavigate } from '@tanstack/react-router';
import { useLiveSessionStore } from './-store/sessionIdstore';
import { useLiveSessionSettings } from '@/hooks/useLiveSessionSettings';

interface ScheduleSearchParams {
    // When present, seeds the batch selection in Step 2 (deep-link from e.g.
    // the Course Details → Live Sessions tab). `returnUrl` is where we go back
    // to after a successful create.
    batchId?: string;
    returnUrl?: string;
}

export const Route = createFileRoute('/study-library/live-session/schedule/')({
    component: RouteComponent,
    validateSearch: (search: Record<string, unknown>): ScheduleSearchParams => ({
        batchId: (search.batchId as string) || undefined,
        returnUrl: (search.returnUrl as string) || undefined,
    }),
});

function RouteComponent() {
    const { t } = useTranslation('studyLibraryLiveSessionSchedule');
    const { setNavHeading } = useNavHeadingStore();
    const { clearSessionId, clearStep1Data, setDeepLink } = useLiveSessionStore();
    const { batchId, returnUrl } = Route.useSearch();
    const navigate = useNavigate();
    const { settings, isLoading } = useLiveSessionSettings();

    const heading = (
        <div className="flex items-center gap-4">
            <CaretLeft
                onClick={() => navigate({ to: '/study-library/live-session' })}
                className="cursor-pointer"
            />
            <div>{t('heading')}</div>
        </div>
    );

    // Pick the right schedule entry point based on what's actually enabled.
    // If single is on → /schedule/step1 (default). If single is off but bulk
    // is on → /schedule/bulk. If both are off → bounce back to the list.
    useEffect(() => {
        if (isLoading) return;
        clearSessionId();
        clearStep1Data();
        // Capture any deep-link context (preselected batch + return URL) before
        // handing off to step1/bulk. Absent params clear stale context so a plain
        // "Schedule" from the list page never inherits an old preselection.
        setDeepLink({
            preselectedBatchIds: batchId ? [batchId] : [],
            returnUrl: returnUrl ?? null,
        });
        if (settings.singleScheduleEnabled) {
            navigate({ to: '/study-library/live-session/schedule/step1' });
        } else if (settings.bulkScheduleEnabled) {
            navigate({ to: '/study-library/live-session/schedule/bulk' });
        } else {
            navigate({ to: '/study-library/live-session' });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isLoading, settings.singleScheduleEnabled, settings.bulkScheduleEnabled, batchId, returnUrl]);

    useEffect(() => {
        setNavHeading(heading);
    }, []);
    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>
        </LayoutContainer>
    );
}
