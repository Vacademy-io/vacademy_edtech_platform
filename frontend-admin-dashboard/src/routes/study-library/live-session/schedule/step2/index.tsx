import { createFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import ScheduleStep2 from '../-components/scheduleStep2';
import { ScheduleErrorBoundary } from '../-components/ScheduleErrorBoundary';
import { InitStudyLibraryProvider } from '@/providers/study-library/init-study-library-provider';

export const Route = createFileRoute('/study-library/live-session/schedule/step2/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('studyLibraryScheduleStep2');
    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="step2" content={t('metaDescription')} />
            </Helmet>
            <InitStudyLibraryProvider>
                <ScheduleErrorBoundary feature="live-session-schedule">
                    <ScheduleStep2 />
                </ScheduleErrorBoundary>
            </InitStudyLibraryProvider>
        </LayoutContainer>
    );
}
