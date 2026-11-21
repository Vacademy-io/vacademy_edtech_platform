import { useTranslation } from 'react-i18next';
import { CommercePage } from '@/routes/commerce/-components/CommercePage';
import { SettingsCardGrid } from './SettingsCardGrid';

export function SettingsPage() {
    const { t } = useTranslation(['commerce', 'sidebar']);
    return (
        <CommercePage
            navId="commerce-settings"
            title={t('sidebar:commerceSettings')}
            description={t('commerce:settings.description')}
        >
            <SettingsCardGrid />
        </CommercePage>
    );
}
