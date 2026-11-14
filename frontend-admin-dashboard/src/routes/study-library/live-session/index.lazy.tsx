import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import SessionListPage from './-components/sessions-list-page';

export const Route = createLazyFileRoute('/study-library/live-session/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('studyLibraryLiveSessionIndexLazy');
    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>
            <SessionListPage />
        </LayoutContainer>
    );
}
