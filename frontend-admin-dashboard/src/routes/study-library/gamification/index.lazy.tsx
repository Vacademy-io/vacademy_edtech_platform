import { useEffect } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { GamificationOverview } from './-components/GamificationOverview';

export const Route = createLazyFileRoute('/study-library/gamification/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('sidebar');
    const { setNavHeading } = useNavHeadingStore();
    const title = t('gamificationPoints');

    useEffect(() => {
        setNavHeading(<div>{title}</div>);
    }, [setNavHeading, title]);

    return (
        <LayoutContainer>
            <Helmet>
                <title>{title}</title>
            </Helmet>
            <GamificationOverview />
        </LayoutContainer>
    );
}
