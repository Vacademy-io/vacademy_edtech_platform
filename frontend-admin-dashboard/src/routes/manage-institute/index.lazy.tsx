import { createLazyFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createLazyFileRoute('/manage-institute/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('manageInstituteIndexLazy');
    return <div>{t('welcomeMessage')}</div>;
}
