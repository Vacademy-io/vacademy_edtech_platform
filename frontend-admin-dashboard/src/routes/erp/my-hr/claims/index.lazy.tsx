import { useEffect } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { MyClaimsMain } from '@/routes/erp/my-hr/-components/MyClaimsMain';

export const Route = createLazyFileRoute('/erp/my-hr/claims/')({
    component: () => (
        <LayoutContainer>
            <MyClaimsPage />
        </LayoutContainer>
    ),
});

function MyClaimsPage() {
    const { t } = useTranslation('erpMyHrClaimsIndex');
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
            <MyClaimsMain />
        </>
    );
}
