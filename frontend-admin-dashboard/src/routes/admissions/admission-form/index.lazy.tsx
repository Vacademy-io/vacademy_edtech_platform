import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import AdmissionFormWizard from './-components/AdmissionFormWizard';

export const Route = createLazyFileRoute('/admissions/admission-form/')({
    component: AdmissionFormPage,
});

export function AdmissionFormPage() {
    const { t } = useTranslation('admissionsAdmissionFormIndexLazy');
    return (
        <LayoutContainer>
            <Helmet>
                <title>{t('page.title')}</title>
                <meta name="description" content={t('page.metaDescription')} />
            </Helmet>
            <div className="flex h-full w-full flex-col">
                <AdmissionFormWizard />
            </div>
        </LayoutContainer>
    );
}
