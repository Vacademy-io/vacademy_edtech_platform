import { useEffect } from 'react';
import { createLazyFileRoute } from '@tanstack/react-router';
import { Helmet } from 'react-helmet';
import { useTranslation } from 'react-i18next';
import { LayoutContainer } from '@/components/common/layout-container/layout-container';
import { useNavHeadingStore } from '@/stores/layout-container/useNavHeadingStore';
import { RegularizationsMain } from '@/routes/erp/attendance/-components/RegularizationsMain';

export const Route = createLazyFileRoute('/erp/attendance/regularizations/')({
    component: () => (
        <LayoutContainer>
            <RegularizationsPage />
        </LayoutContainer>
    ),
});

function RegularizationsPage() {
    const { t } = useTranslation('erpAttendanceRegularizationsIndex');
    const { setNavHeading } = useNavHeadingStore();

    useEffect(() => {
        setNavHeading(<h1 className="text-lg">{t('heading')}</h1>);
    }, [setNavHeading, t]);

    return (
        <>
            <Helmet>
                <title>{t('title')}</title>
                <meta name="description" content={t('description')} />
            </Helmet>
            <div className="mx-auto flex w-full max-w-screen-2xl flex-1 flex-col gap-6 p-4 sm:p-6">
                <RegularizationsMain />
            </div>
        </>
    );
}
