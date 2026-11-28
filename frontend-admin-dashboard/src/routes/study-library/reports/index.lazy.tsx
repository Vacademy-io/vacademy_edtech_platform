import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { createLazyFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import HeaderTabs from './-components/headerTabs';

export const Route = createLazyFileRoute('/study-library/reports/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('studyLibraryReportsIndex');
    const { setNavHeading } = useNavHeadingStore();

    const heading = (
        <div className="flex items-center gap-4">
            <div>{t('pageTitle')}</div>
        </div>
    );

    useEffect(() => {
        setNavHeading(heading);
    }, []);
    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>
            <HeaderTabs />
        </LayoutContainer>
    );
}
