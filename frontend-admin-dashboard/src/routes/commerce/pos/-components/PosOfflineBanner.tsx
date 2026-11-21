import { useTranslation } from 'react-i18next';
import { WifiSlash } from '@phosphor-icons/react';

/** Shown while the browser says there is no network; Pay is disabled meanwhile. */
export function PosOfflineBanner({ online }: { online: boolean }) {
    const { t } = useTranslation('commerce');
    if (online) return null;
    return (
        <div
            role="status"
            data-testid="pos-offline"
            className="flex items-center gap-2 border-b border-warning-200 bg-warning-50 px-4 py-2 text-body text-warning-600"
        >
            <WifiSlash size={20} weight="bold" className="shrink-0" />
            <span>{t('pos.offline')}</span>
        </div>
    );
}
