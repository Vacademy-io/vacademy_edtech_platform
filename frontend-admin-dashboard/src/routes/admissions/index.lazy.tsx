import { createLazyFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

function IndexComponent() {
    const { t } = useTranslation('admissionsIndexLazy');
    return <div>{t('placeholder')}</div>;
}

export const Route = createLazyFileRoute('/admissions/')({
    component: IndexComponent,
});
