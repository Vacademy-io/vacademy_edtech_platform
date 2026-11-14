import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet';
import { HandCoins, Percent } from '@phosphor-icons/react';
import { MyButton } from '@/components/design-system/button';
import { instituteTerms } from '@/components/shared/crm-enhance/institute-terms';
import { PayInstallmentsMain } from './-components/PayInstallmentsMain';

export const Route = createLazyFileRoute('/financial-management/pay-installments/')({
    component: () => (
        <LayoutContainer>
            <PayInstallmentsPage />
        </LayoutContainer>
    ),
});

function PayInstallmentsPage() {
    const { t } = useTranslation('financialManagementPayInstallmentsIndex');
    const terms = instituteTerms();
    const { setNavHeading } = useNavHeadingStore();

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('pageTitle')}</h1>);
    }, [setNavHeading, t]);

    return (
        <>
            <Helmet>
                <title>{t('pageTitle')}</title>
            </Helmet>
            <div className="mx-auto flex size-full min-h-0 max-w-screen-2xl flex-1 flex-col gap-6 p-6 duration-300 animate-in fade-in">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-500">
                            <HandCoins size={20} weight="duotone" />
                        </span>
                        <div>
                            <h1 className="text-h3 font-semibold text-neutral-900">
                                {t('pageTitle')}
                            </h1>
                            <p className="mt-0.5 text-body text-neutral-500">
                                {t('redesign.subtitle', { learner: terms.learner.toLowerCase() })}
                            </p>
                        </div>
                    </div>
                    <Link to="/financial-management/adjustment-approvals">
                        <MyButton buttonType="secondary" scale="medium">
                            <Percent className="mr-1 size-4" />
                            {t('redesign.adjustments')}
                        </MyButton>
                    </Link>
                </div>
                <PayInstallmentsMain />
            </div>
        </>
    );
}
