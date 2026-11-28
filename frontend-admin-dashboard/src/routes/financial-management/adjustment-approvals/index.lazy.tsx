import { createLazyFileRoute } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect } from 'react';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { AdjustmentApprovalsMain } from './-components/AdjustmentApprovalsMain';

export const Route = createLazyFileRoute('/financial-management/adjustment-approvals/')({
    component: () => (
        <LayoutContainer>
            <AdjustmentApprovalsPage />
        </LayoutContainer>
    ),
});

function AdjustmentApprovalsPage() {
    const { setNavHeading } = useNavHeadingStore();
    const { t } = useTranslation('financialManagementAdjustmentApprovalsIndex');

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('heading')}</h1>);
    }, [setNavHeading, t]);

    return (
        <>
            <Helmet>
                <title>{t('heading')}</title>
            </Helmet>
            <div className="flex flex-col gap-6 p-6 animate-in fade-in duration-300 w-full max-w-[1400px] mx-auto flex-1 min-h-0 h-full">
                <AdjustmentApprovalsMain />
            </div>
        </>
    );
}
