import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import AdmissionEntryScreen from '../admission-form/-components/AdmissionEntryScreen';

export const Route = createLazyFileRoute('/admissions/admission-list/')({
    component: AdmissionListPage,
});

function AdmissionListPage() {
    const { t } = useTranslation('admissionsAdmissionListIndexLazy');
    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('page.title')}</title>
                <meta name="description" content={t('page.metaDescription')} />
            </Helmet>
            <div className="flex h-full w-full flex-col">
                <AdmissionEntryScreen />
            </div>
        </LayoutContainer>
    );
}
