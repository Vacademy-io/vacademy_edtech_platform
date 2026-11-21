import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { SessionsPage } from './-components/sessionsPage';
import { Helmet } from 'react-helmet';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getTerminology } from '@/components/common/layout-container/sidebar/utils';
import { ContentTerms, SystemTerms } from '@/routes/settings/-components/NamingSettings';

export const Route = createLazyFileRoute('/manage-institute/sessions/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('manageInstituteSessionsIndex');
    const { setNavHeading } = useNavHeadingStore();

    useEffect(() => {
        setNavHeading(
            <div className="flex items-center gap-4">
                <div>{t('learningCenter')}</div>
            </div>
        );
    }, [t]);
    return (
        <LayoutContainer>
            <Helmet>
                <title>{getTerminology(ContentTerms.Session, SystemTerms.Session)}</title>
                <meta name="description" content={t('metaDescription')} />
            </Helmet>
            <SessionsPage />
        </LayoutContainer>
    );
}
