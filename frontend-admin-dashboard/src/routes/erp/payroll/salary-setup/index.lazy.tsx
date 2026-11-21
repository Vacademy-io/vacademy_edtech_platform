import { useEffect } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { SalarySetupMain } from './-components/SalarySetupMain';

export const Route = createLazyFileRoute('/erp/payroll/salary-setup/')({
    component: () => (
        <LayoutContainer>
            <SalarySetupPage />
        </LayoutContainer>
    ),
});

function SalarySetupPage() {
    const { t } = useTranslation('erpPayrollSalarySetupIndex');
    const { setNavHeading } = useNavHeadingStore();

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('title')}</h1>);
    }, [setNavHeading, t]);

    return (
        <>
            <Helmet>
                <title>{t('title')}</title>
            </Helmet>
            <div className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
                <SalarySetupMain />
            </div>
        </>
    );
}
