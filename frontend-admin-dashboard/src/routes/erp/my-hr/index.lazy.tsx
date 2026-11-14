import { useEffect } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { MyHrOverviewMain } from '@/routes/erp/my-hr/-components/MyHrOverviewMain';

export const Route = createLazyFileRoute('/erp/my-hr/')({
    component: () => (
        <LayoutContainer>
            <MyHrOverviewPage />
        </LayoutContainer>
    ),
});

function MyHrOverviewPage() {
    const { t } = useTranslation('erpMyHrIndex');
    const { setNavHeading } = useNavHeadingStore();

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('title')}</h1>);
    }, [setNavHeading, t]);

    return (
        <>
            <Helmet>
                <title>{t('title')}</title>
                <meta name="description" content={t('description')} />
            </Helmet>
            <MyHrOverviewMain />
        </>
    );
}
