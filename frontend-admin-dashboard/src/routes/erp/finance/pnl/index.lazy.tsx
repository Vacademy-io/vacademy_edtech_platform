import { useEffect } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { PnlMain } from '../-components/PnlMain';

export const Route = createLazyFileRoute('/erp/finance/pnl/')({
    component: () => (
        <LayoutContainer>
            <PnlPage />
        </LayoutContainer>
    ),
});

function PnlPage() {
    const { t } = useTranslation('erpFinancePnlIndex');
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
            <PnlMain />
        </>
    );
}
