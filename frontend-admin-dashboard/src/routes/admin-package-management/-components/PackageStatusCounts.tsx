import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QuickViews, type QuickView } from '@/components/shared/crm-enhance';
import { fetchBatchesSummary } from '../-services/package-service';

const STATUSES: Array<[string, QuickView['tone']]> = [
    ['ACTIVE', 'success'],
    ['HIDDEN', 'warning'],
    ['INACTIVE', 'neutral'],
];

/**
 * Manage Packages: package count per status. Each count is the page's own
 * summary request for that status (same key, cached 5 minutes). The card for
 * the status the table is filtered to is outlined.
 */
export function PackageStatusCounts({ activeStatuses }: { activeStatuses?: string[] }) {
    const { t } = useTranslation('crmPages');
    const results = useQueries({
        queries: STATUSES.map(([s]) => ({
            queryKey: ['batches-summary', [s]],
            queryFn: () => fetchBatchesSummary([s]),
            staleTime: 300000,
        })),
    });
    return (
        <QuickViews
            caption={t('packages.captionStatic')}
            views={STATUSES.map(([s, tone], i) => ({
                key: s,
                label: t(`packages.${s}`),
                count: results[i]?.data?.total_batches,
                tone,
                active: activeStatuses?.length === 1 && activeStatuses[0] === s,
            }))}
        />
    );
}
