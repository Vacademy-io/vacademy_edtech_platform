import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { CommunityPage } from './-components/CommunityPage';
import { useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';

export const Route = createLazyFileRoute('/community/')({
    component: () => (
        <LayoutContainer intrnalMargin={false}>
            <CommunityLayoutPage />
        </LayoutContainer>
    ),
});

function CommunityLayoutPage() {
    const { t } = useTranslation('communityIndex');
    const { setNavHeading } = useNavHeadingStore();
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('community')}</h1>);
    }, [t]);
    return (
        <>
            <Helmet>
                <title>{t('community')}</title>
                <meta name="description" content={t('metaDescription')} />
            </Helmet>
            <CommunityPage />
        </>
    );
}
