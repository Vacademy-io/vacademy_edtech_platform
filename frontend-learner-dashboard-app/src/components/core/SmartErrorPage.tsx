import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isChunkLoadError, reloadForChunkError } from '@/lib/chunk-reload';
import { classifyError } from '@/lib/error-classifier';
import { GenericErrorPage } from './GenericErrorPage';
import { RuntimeErrorPage } from './RuntimeErrorPage';
import { NetworkErrorPage } from './NetworkErrorPage';
import { OfflineErrorPage } from './OfflineErrorPage';

interface Props {
    error?: unknown;
}

export function SmartErrorPage({ error }: Props) {
    const { t } = useTranslation('courseComponentsExtra');
    const chunkError = isChunkLoadError(error);

    useEffect(() => {
        if (chunkError) {
            reloadForChunkError(error);
        }
    }, [chunkError, error]);

    if (chunkError) {
        return (
            <div className="flex h-screen w-screen select-none items-center justify-center bg-gray-50 px-4 text-gray-700">
                <p className="text-lg font-semibold">{t('smartErrorPage.updatingApplication')}</p>
            </div>
        );
    }

    const category = classifyError(error);

    switch (category) {
        case 'offline':
            return <OfflineErrorPage />;
        case 'network':
            return <NetworkErrorPage />;
        case 'runtime':
            return <RuntimeErrorPage error={error} />;
        default:
            return <GenericErrorPage error={error} />;
    }
}
