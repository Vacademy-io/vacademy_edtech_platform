import { useEffect } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { ProvisionsMain } from '@/routes/erp/compliance/-components/ProvisionsMain';

export const Route = createLazyFileRoute('/erp/compliance/provisions/')({
    component: () => (
        <LayoutContainer>
            <CompliancePage />
        </LayoutContainer>
    ),
});

function CompliancePage() {
    const { t } = useTranslation('erpComplianceProvisionsIndex');
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
            <ProvisionsMain />
        </>
    );
}
