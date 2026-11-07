import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { CaretLeft, CircleNotch } from '@phosphor-icons/react';
import ScheduleBulkPage from '../-components/scheduleBulkPage';
import { ScheduleErrorBoundary } from '../-components/ScheduleErrorBoundary';
import { useLiveSessionStore } from '../-store/sessionIdstore';
import { useLiveSessionSettings } from '@/hooks/useLiveSessionSettings';

export const Route = createFileRoute('/study-library/live-session/schedule/bulk/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('studyLibraryScheduleBulkIndex');
    const { setNavHeading } = useNavHeadingStore();
    const { clearSessionId, clearStep1Data, clearBulkSessionIds } = useLiveSessionStore();
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

    useEffect(() => {
        setNavHeading(heading);
        // Bulk flow always starts fresh — no edit mode for bulk.
        clearSessionId();
        clearStep1Data();
        clearBulkSessionIds();
    }, [setNavHeading, clearSessionId, clearStep1Data, clearBulkSessionIds]);

    // Route-level guard: if bulk scheduling is disabled (institute setting OR
    // role-level display setting), bounce admins away from the URL even if
    // they typed it directly. Single-class flow is the natural fallback;
    // if THAT is also disabled, send them back to the live-session list.
    useEffect(() => {
        if (isLoading) return;
        if (settings.bulkScheduleEnabled) return;
        navigate({
            to: settings.singleScheduleEnabled
                ? '/study-library/live-session/schedule/step1'
                : '/study-library/live-session',
        });
    }, [isLoading, settings.bulkScheduleEnabled, settings.singleScheduleEnabled, navigate]);

    if (isLoading || !settings.bulkScheduleEnabled) {
        return (
            <LayoutContainer>
                <div className="flex h-64 items-center justify-center">
                    <CircleNotch className="size-8 animate-spin text-neutral-400" />
                </div>
            </LayoutContainer>
        );
    }

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>
            <ScheduleErrorBoundary feature="live-session-bulk-schedule">
                <ScheduleBulkPage />
            </ScheduleErrorBoundary>
        </LayoutContainer>
    );
}
