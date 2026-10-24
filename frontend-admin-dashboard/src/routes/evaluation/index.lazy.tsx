import { createLazyFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

export const Route = createLazyFileRoute('/evaluation/')({
    component: RouteComponent,
});

function RouteComponent() {
    const { t } = useTranslation('evaluationIndex');
    return <div className="m-2 w-full space-x-2 p-2">{t('greeting')}</div>;
}
