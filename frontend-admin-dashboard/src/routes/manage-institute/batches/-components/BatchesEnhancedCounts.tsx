import { useTranslation } from 'react-i18next';
import { QuickViews } from '@/components/shared/crm-enhance';
import type { batchWithStudentDetails } from '../-types/manage-batches-types';
import { getBatchDisplayStatus, type BatchStatusFilter } from '../-utils/batch-filters';

/**
 * Batches: counts for the selected session that also set the page's status
 * filter. Computed from the batch list the page already loaded.
 */
export function BatchesEnhancedCounts({
    courses,
    status,
    onStatus,
}: {
    courses: batchWithStudentDetails[];
    status: BatchStatusFilter;
    onStatus: (status: BatchStatusFilter) => void;
}) {
    const { t } = useTranslation('crmPages');
    const batches = courses.flatMap((c) => c.batches);
    const by = (s: BatchStatusFilter) =>
        batches.filter((b) => getBatchDisplayStatus(b) === s).length;
    const empty = batches.filter((b) => (b.count_students ?? 0) === 0).length;
    const learners = batches.reduce((sum, b) => sum + (b.count_students ?? 0), 0);
    return (
        <QuickViews
            caption={t('batches.caption', { total: learners.toLocaleString('en-IN') })}
            views={[
                {
                    key: 'all',
                    label: t('batches.all'),
                    count: batches.length,
                    active: status === 'all',
                    onSelect: () => onStatus('all'),
                },
                {
                    key: 'active',
                    label: t('batches.active'),
                    count: by('active'),
                    tone: 'success',
                    active: status === 'active',
                    onSelect: () => onStatus('active'),
                },
                {
                    key: 'upcoming',
                    label: t('batches.upcoming'),
                    count: by('upcoming'),
                    tone: 'info',
                    active: status === 'upcoming',
                    onSelect: () => onStatus('upcoming'),
                },
                {
                    key: 'inactive',
                    label: t('batches.inactive'),
                    count: by('inactive'),
                    active: status === 'inactive',
                    onSelect: () => onStatus('inactive'),
                },
                {
                    key: 'empty',
                    label: t('batches.noLearners'),
                    count: empty,
                    tone: empty > 0 ? 'warning' : 'neutral',
                },
            ]}
        />
    );
}
