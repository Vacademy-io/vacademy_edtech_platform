import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QuickViews, type QuickView } from '@/components/shared/crm-enhance';
import { AnnouncementService } from '@/services/announcement';

const STATUSES: Array<[string | undefined, QuickView['tone']]> = [
    [undefined, 'neutral'],
    ['ACTIVE', 'success'],
    ['SCHEDULED', 'info'],
    ['PENDING_APPROVAL', 'warning'],
    ['DRAFT', 'neutral'],
    ['REJECTED', 'danger'],
];

/**
 * Announcement History: a count per status that also filters the list.
 * Each count is the list request itself with one row, cached for 5 minutes.
 */
export function AnnouncementCounts({
    status,
    onStatus,
}: {
    status: string | undefined;
    onStatus: (status: string | undefined) => void;
}) {
    const { t } = useTranslation('crmPages');
    const results = useQueries({
        queries: STATUSES.map(([s]) => ({
            queryKey: ['announcement-count', s ?? 'ALL'],
            queryFn: () => AnnouncementService.listByInstitute({ page: 0, size: 1, status: s }),
            staleTime: 5 * 60 * 1000,
            refetchOnWindowFocus: false,
        })),
    });
    return (
        <QuickViews
            caption={t('announcements.caption')}
            views={STATUSES.map(([s, tone], i) => ({
                key: s ?? 'all',
                label: t(`announcements.status.${s ?? 'ALL'}`),
                count: (results[i]?.data as { totalElements?: number } | undefined)?.totalElements,
                tone,
                active: status === s,
                onSelect: () => onStatus(s),
            }))}
        />
    );
}
