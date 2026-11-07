import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { ManageBatches } from './-components/manage-batches';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';

export const Route = createLazyFileRoute('/manage-institute/batches/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('manageInstituteBatchesIndexLazy');
    return (
        <LayoutContainer>
            {/* <EmptyDashboard /> */}
            <Helmet>
                <title>{t('pageTitle')}</title>
                <meta name="description" content={t('pageDescription')} />
            </Helmet>
            <ManageBatches />
        </LayoutContainer>
    );
}
