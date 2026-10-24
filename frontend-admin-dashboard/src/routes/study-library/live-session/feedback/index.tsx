import { createFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import FeedbackListPage from './-components/feedback-list-page';

export const Route = createFileRoute('/study-library/live-session/feedback/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('studyLibraryFeedbackIndex');
    const { setNavHeading } = useNavHeadingStore();

    useEffect(() => {
        setNavHeading(t('pageTitle'));
    }, [setNavHeading, t]);

    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>
            <FeedbackListPage />
        </LayoutContainer>
    );
}
