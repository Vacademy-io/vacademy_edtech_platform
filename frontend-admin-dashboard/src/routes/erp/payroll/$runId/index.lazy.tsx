import { useCallback, useEffect, useState } from 'react';
import { createLazyFileRoute, useParams } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { PayrollRunDetail } from '@/routes/erp/payroll/-components/PayrollRunDetail';

export const Route = createLazyFileRoute('/erp/payroll/$runId/')({
    component: () => (
        <LayoutContainer>
            <PayrollRunPage />
        </LayoutContainer>
    ),
});

function PayrollRunPage() {
    const { t } = useTranslation('erpPayrollRunIndexLazy');
    const { runId } = useParams({ from: '/erp/payroll/$runId/' });
    const { setNavHeading } = useNavHeadingStore();
    const [period, setPeriod] = useState('');

    const heading = period ? t('headingWithPeriod', { period }) : t('headingDefault');

    // The heading only becomes meaningful once the run is loaded, so it starts
    // generic and is upgraded to the period rather than flashing an id.
    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{heading}</h1>);
    }, [setNavHeading, heading]);

    const onPeriodResolved = useCallback((next: string) => setPeriod(next), []);

    return (
        <>
            <Helmet>
                <title>{heading}</title>
            </Helmet>
            <div className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
                <PayrollRunDetail runId={runId} onPeriodResolved={onPeriodResolved} />
            </div>
        </>
    );
}
