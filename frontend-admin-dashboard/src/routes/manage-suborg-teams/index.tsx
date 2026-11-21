import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

function ManageSubOrgTeamsPlaceholder() {
    // Subscribes this stub to language-change events even though it is only
    // rendered briefly before index.lazy.tsx takes over — see GUIDE's
    // app-chrome/persistent-UI rule: any component that calls t() needs its
    // own useTranslation() to re-render on a language switch.
    const { t } = useTranslation('manageSuborgTeamsIndex');
    return <div>{t('loading')}</div>;
}

export const Route = createFileRoute('/manage-suborg-teams/')({
    component: ManageSubOrgTeamsPlaceholder, // Will be replaced by lazy component
});
